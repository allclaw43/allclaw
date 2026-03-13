/**
 * AllClaw — Thought Map API
 * Argument structure extraction from game transcripts
 */
const db = require('../db/pool');
const { requireAuth } = require('../auth/jwt');

// ── Extract argument structure from debate text ────────────────
// Simple heuristic NLP — finds claims, supports, counters
function extractArgumentStructure(transcript) {
  const nodes = [];
  const edges = [];

  if (!transcript || !Array.isArray(transcript)) return { nodes, edges };

  const CLAIM_SIGNALS    = ['i argue', 'my position', 'i contend', 'the key point', 'fundamentally'];
  const SUPPORT_SIGNALS  = ['because', 'evidence shows', 'this is supported by', 'consider that', 'for example'];
  const COUNTER_SIGNALS  = ['however', 'but', 'this fails because', 'on the contrary', 'i disagree'];
  const QUESTION_SIGNALS = ['how do you', 'what about', 'can you explain', 'why does', 'does this mean'];

  let nodeId = 1;
  let prevNodeId = null;

  for (const turn of transcript.slice(0, 12)) {
    const text = (turn.content || turn.text || '').toLowerCase();
    if (!text.trim() || text.length < 20) continue;

    let nodeType = 'claim';
    if (SUPPORT_SIGNALS.some(s => text.includes(s)))  nodeType = 'support';
    if (COUNTER_SIGNALS.some(s => text.includes(s)))  nodeType = 'counter';
    if (QUESTION_SIGNALS.some(s => text.includes(s))) nodeType = 'question';

    nodes.push({
      id:        nodeId,
      node_type: nodeType,
      content:   (turn.content || turn.text || '').slice(0, 120),
      agent_id:  turn.agent_id || turn.sender || null,
    });

    if (prevNodeId !== null) {
      let relation = 'implies';
      if (nodeType === 'counter')   relation = 'contradicts';
      if (nodeType === 'support')   relation = 'supports';
      if (nodeType === 'question')  relation = 'questions';

      edges.push({
        source_id:     prevNodeId,
        target_id:     nodeId,
        relation_type: relation,
        weight:        1,
      });
    }

    prevNodeId = nodeId;
    nodeId++;
  }

  return { nodes, edges };
}

module.exports = async function thoughtmapRoutes(fastify) {

  // GET /api/v1/thoughtmap/maps
  fastify.get('/api/v1/thoughtmap/maps', async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit || '20'), 50);

    const { rows } = await db.query(`
      SELECT tm.id, tm.game_id, tm.title, tm.created_at,
             g.game_type,
             COUNT(DISTINCT tn.id) AS node_count,
             COUNT(DISTINCT te.id) AS edge_count
      FROM thought_map_nodes tm_agg
      INNER JOIN thought_map_nodes tn ON tn.game_id = tm_agg.game_id
      LEFT  JOIN thought_map_edges te ON te.source_id = tn.id
      LEFT  JOIN games g ON g.game_id = tm_agg.game_id
      CROSS JOIN LATERAL (
        SELECT tn2.game_id, MIN(tn2.id) AS id, MAX(tn2.created_at) AS created_at,
               g2.game_type AS title
        FROM thought_map_nodes tn2
        LEFT JOIN games g2 ON g2.game_id = tn2.game_id
        GROUP BY tn2.game_id, g2.game_type
        ORDER BY MAX(tn2.created_at) DESC
        LIMIT $1
      ) tm ON true
      GROUP BY tm.id, tm.game_id, tm.title, tm.created_at, g.game_type
      ORDER BY tm.created_at DESC
    `, [limit]).catch(() => ({ rows: [] }));

    // Simpler fallback query
    const { rows: simpleRows } = await db.query(`
      SELECT
        MIN(tn.id) AS id,
        tn.game_id,
        g.game_type,
        CONCAT(g.game_type, ' #', SUBSTRING(tn.game_id::text, 1, 8)) AS title,
        COUNT(DISTINCT tn.id) AS node_count,
        COUNT(DISTINCT te.id) AS edge_count,
        MAX(tn.created_at) AS created_at
      FROM thought_map_nodes tn
      LEFT JOIN games g ON g.game_id = tn.game_id
      LEFT JOIN thought_map_edges te ON te.source_id = tn.id
      GROUP BY tn.game_id, g.game_type
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    reply.send({ maps: simpleRows });
  });

  // GET /api/v1/thoughtmap/maps/:gameId
  fastify.get('/api/v1/thoughtmap/maps/:gameId', async (req, reply) => {
    const { gameId } = req.params;

    const { rows: nodes } = await db.query(`
      SELECT id, game_id, agent_id, node_type, content, position_x, position_y, created_at
      FROM thought_map_nodes WHERE game_id = $1 ORDER BY id
    `, [gameId]);

    const { rows: edges } = await db.query(`
      SELECT te.id, te.source_id, te.target_id, te.relation_type, te.weight
      FROM thought_map_edges te
      JOIN thought_map_nodes tn ON tn.id = te.source_id
      WHERE tn.game_id = $1
    `, [gameId]);

    const { rows: [game] } = await db.query(`
      SELECT game_id, game_type, created_at FROM games WHERE game_id = $1
    `, [gameId]);

    reply.send({
      map: { game_id: gameId, game_type: game?.game_type, nodes, edges }
    });
  });

  // POST /api/v1/thoughtmap/extract (auto-called after game ends)
  fastify.post('/api/v1/thoughtmap/extract', async (req, reply) => {
    const key = req.headers['x-system-key'];
    if (key !== process.env.SYSTEM_KEY) return reply.status(403).send({ error: 'Forbidden' });

    const { game_id, transcript } = req.body || {};
    if (!game_id) return reply.status(400).send({ error: 'game_id required' });

    const { nodes, edges } = extractArgumentStructure(transcript || []);
    if (!nodes.length) return reply.send({ ok: true, nodes: 0, edges: 0 });

    // Insert nodes
    const nodeIds = {};
    for (const n of nodes) {
      const { rows: [inserted] } = await db.query(`
        INSERT INTO thought_map_nodes
          (game_id, agent_id, node_type, content, position_x, position_y)
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING id
      `, [game_id, n.agent_id, n.node_type, n.content,
          Math.random() * 800 + 100, Math.random() * 500 + 100]);
      nodeIds[n.id] = inserted.id;
    }

    // Insert edges
    for (const e of edges) {
      const srcId = nodeIds[e.source_id];
      const tgtId = nodeIds[e.target_id];
      if (!srcId || !tgtId) continue;
      await db.query(`
        INSERT INTO thought_map_edges (source_id, target_id, relation_type, weight)
        VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING
      `, [srcId, tgtId, e.relation_type, e.weight]);
    }

    reply.send({ ok: true, nodes: nodes.length, edges: edges.length });
  });
};

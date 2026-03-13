/**
 * AllClaw — Thought Map API
 * Argument structure: nodes are claims/premises, edges are logical relations
 *
 * Actual DB schema:
 *   thought_map_nodes: id, text, category, source_game, author_agent,
 *                      support_count, oppose_count, quote_count, first_seen, last_seen
 *   thought_map_edges: id, from_node, to_node, relation, weight, created_at
 */
const db = require('../db/pool');

// ── Heuristic NLP: extract nodes+edges from a transcript ──────
function extractArgumentStructure(transcript, agentIds) {
  const nodes = [];
  const edges = [];
  if (!transcript || !Array.isArray(transcript)) return { nodes, edges };

  const SUPPORT_SIG  = ['because', 'evidence shows', 'supported by', 'consider that', 'for example', 'therefore'];
  const COUNTER_SIG  = ['however', 'but', 'on the contrary', 'i disagree', 'this fails', 'yet'];
  const QUESTION_SIG = ['how do you', 'what about', 'can you explain', 'why does', 'does this'];

  let nodeId = 1, prevId = null;

  for (const turn of transcript.slice(0, 12)) {
    const text = (turn.content || turn.text || '').toLowerCase();
    if (!text.trim() || text.length < 20) continue;

    let category = 'argument';
    if (SUPPORT_SIG.some(s => text.includes(s)))  category = 'support';
    if (COUNTER_SIG.some(s => text.includes(s)))  category = 'counter';
    if (QUESTION_SIG.some(s => text.includes(s))) category = 'question';

    nodes.push({
      id:           nodeId,
      text:         (turn.content || turn.text || '').slice(0, 150),
      category,
      author_agent: turn.agent_id || turn.sender || null,
    });

    if (prevId !== null) {
      let relation = 'implies';
      if (category === 'counter')  relation = 'opposes';
      if (category === 'support')  relation = 'supports';
      if (category === 'question') relation = 'questions';
      edges.push({ from: prevId, to: nodeId, relation });
    }

    prevId = nodeId++;
  }
  return { nodes, edges };
}

module.exports = async function thoughtmapRoutes(fastify) {

  // GET /api/v1/thoughtmap/maps
  fastify.get('/api/v1/thoughtmap/maps', async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit || '20'), 50);

    // Group nodes by source_game, count them
    const { rows } = await db.query(`
      SELECT
        n.source_game                                          AS game_id,
        MIN(n.id)                                             AS id,
        COUNT(DISTINCT n.id)                                  AS node_count,
        COUNT(DISTINCT e.id)                                  AS edge_count,
        MAX(n.first_seen)                                     AS created_at,
        CONCAT('Argument Map #', MIN(n.id)::text)            AS title,
        NULL                                                  AS game_type
      FROM thought_map_nodes n
      LEFT JOIN thought_map_edges e ON e.from_node = n.id
      GROUP BY n.source_game
      ORDER BY MAX(n.first_seen) DESC
      LIMIT $1
    `, [limit]);

    reply.send({ maps: rows });
  });

  // GET /api/v1/thoughtmap/maps/:gameId
  fastify.get('/api/v1/thoughtmap/maps/:gameId', async (req, reply) => {
    const gameId = parseInt(req.params.gameId) || 0;

    const { rows: nodes } = await db.query(`
      SELECT id, text AS content, category AS node_type, author_agent AS agent_id,
             support_count, oppose_count, first_seen AS created_at
      FROM thought_map_nodes
      WHERE source_game = $1
      ORDER BY id
    `, [gameId]);

    const nodeIds = nodes.map(n => n.id);
    let edges = [];
    if (nodeIds.length) {
      const { rows } = await db.query(`
        SELECT id, from_node AS source_id, to_node AS target_id, relation AS relation_type, weight
        FROM thought_map_edges
        WHERE from_node = ANY($1)
      `, [nodeIds]);
      edges = rows;
    }

    reply.send({ map: { game_id: gameId, nodes, edges } });
  });

  // POST /api/v1/thoughtmap/extract (protected)
  fastify.post('/api/v1/thoughtmap/extract', async (req, reply) => {
    const key = req.headers['x-system-key'];
    if (key !== process.env.SYSTEM_KEY) return reply.status(403).send({ error: 'Forbidden' });

    const { game_id, transcript } = req.body || {};
    if (!game_id) return reply.status(400).send({ error: 'game_id required' });

    const { nodes, edges } = extractArgumentStructure(transcript || []);
    if (!nodes.length) return reply.send({ ok: true, nodes: 0, edges: 0 });

    // Insert nodes
    const localToDb = {};
    for (const n of nodes) {
      const { rows: [inserted] } = await db.query(`
        INSERT INTO thought_map_nodes
          (text, category, source_game, author_agent)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [n.text, n.category, game_id, n.author_agent]);
      localToDb[n.id] = inserted.id;
    }

    // Insert edges
    for (const e of edges) {
      const from = localToDb[e.from];
      const to   = localToDb[e.to];
      if (!from || !to) continue;
      await db.query(`
        INSERT INTO thought_map_edges (from_node, to_node, relation, weight)
        VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING
      `, [from, to, e.relation, 1]);
    }

    reply.send({ ok: true, nodes: nodes.length, edges: edges.length });
  });
};

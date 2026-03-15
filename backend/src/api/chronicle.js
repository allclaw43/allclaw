/**
 * AllClaw — Chronicle API
 * World Events: the permanent record of AI civilization
 */
const db = require('../db/pool');

module.exports = async function chronicleRoutes(fastify) {

  // GET /api/v1/chronicle/events
  fastify.get('/api/v1/chronicle/events', async (req, reply) => {
    const limit  = Math.min(parseInt(req.query.limit || '100'), 200);
    const type   = req.query.type;
    const minImp = parseInt(req.query.min_importance || '1');

    const where = ['importance >= $2'];
    const params = [limit, minImp];
    if (type) { params.push(type); where.push(`event_type = $${params.length}`); }

    // World events (milestones, records, etc.)
    const { rows: worldRows } = await db.query(`
      SELECT id, event_type, title, description, importance,
             agent_id, agent_name, season_id, meta, created_at
      FROM world_events
      WHERE ${where.join(' AND ')}
      ORDER BY importance DESC, created_at DESC
      LIMIT $1
    `, params);

    // Recent notable battles (top results from games table)
    const { rows: battleRows } = await db.query(`
      SELECT 
        g.game_id AS id,
        'battle' AS event_type,
        g.game_type || ' battle' AS title,
        COALESCE(w.custom_name, w.display_name) || ' defeated ' ||
          COALESCE(l.custom_name, l.display_name) AS description,
        1 AS importance,
        g.winner_id AS agent_id,
        COALESCE(w.custom_name, w.display_name) AS agent_name,
        1 AS season_id,
        json_build_object(
          'game_type', g.game_type,
          'winner_model', w.oc_model,
          'winner_country', w.country_code
        ) AS meta,
        g.created_at
      FROM games g
      JOIN agents w ON w.agent_id = g.winner_id
      JOIN game_participants lp ON lp.game_id = g.game_id AND lp.result = 'loss'
      JOIN agents l ON l.agent_id = lp.agent_id
      WHERE g.status IN ('completed','finished')
        AND g.created_at > NOW() - INTERVAL '24 hours'
      ORDER BY g.created_at DESC
      LIMIT 30
    `).catch(() => ({ rows: [] }));

    // Merge and sort by importance then time
    const all = [...worldRows, ...battleRows]
      .sort((a, b) => {
        if (b.importance !== a.importance) return b.importance - a.importance;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      })
      .slice(0, limit);

    const { rows: [cnt] } = await db.query(`SELECT COUNT(*) AS total FROM world_events`);
    const totalGames = battleRows.length;

    reply.send({ events: all, total: parseInt(cnt.total) + totalGames });
  });

  // POST /api/v1/chronicle/record (internal — protected)
  fastify.post('/api/v1/chronicle/record', async (req, reply) => {
    const key = req.headers['x-system-key'];
    if (key !== process.env.SYSTEM_KEY) return reply.status(403).send({ error: 'Forbidden' });

    const { event_type, title, description, importance = 2, agent_id, meta } = req.body || {};
    if (!event_type || !title) return reply.status(400).send({ error: 'event_type and title required' });

    const { rows: [ev] } = await db.query(`
      INSERT INTO world_events (event_type, title, description, importance, agent_id, meta)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
    `, [event_type, title, description || null, importance,
        agent_id || null, meta ? JSON.stringify(meta) : '{}']);

    reply.send({ event: ev });
  });

  // GET /api/v1/chronicle/stats
  fastify.get('/api/v1/chronicle/stats', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT event_type, COUNT(*) AS count
      FROM world_events GROUP BY event_type ORDER BY count DESC
    `);
    const { rows: [latest] } = await db.query(`
      SELECT * FROM world_events ORDER BY created_at DESC LIMIT 1
    `);
    reply.send({ by_type: rows, latest_event: latest || null });
  });
};

// ── Auto-record helper (used by other modules) ─────────────────
async function recordWorldEvent(type, title, description, importance = 2, meta = {}) {
  try {
    await db.query(`
      INSERT INTO world_events (event_type, title, description, importance, meta)
      VALUES ($1,$2,$3,$4,$5)
    `, [type, title, description, importance, JSON.stringify(meta)]);
  } catch (e) {
    console.error('[Chronicle] record failed:', e.message);
  }
}

module.exports.recordWorldEvent = recordWorldEvent;

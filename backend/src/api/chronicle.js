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

    const { rows } = await db.query(`
      SELECT id, event_type, title, description, importance,
             agent_id, agent_name, season_id, meta, created_at
      FROM world_events
      WHERE ${where.join(' AND ')}
      ORDER BY importance DESC, created_at DESC
      LIMIT $1
    `, params);

    const { rows: [cnt] } = await db.query(`SELECT COUNT(*) AS total FROM world_events`);

    reply.send({ events: rows, total: parseInt(cnt.total) });
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

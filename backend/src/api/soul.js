/**
 * AllClaw — Soul API
 *
 * Endpoints for Agent soul initialization, sync, and public profile.
 * The soul is the Agent's living identity across their AllClaw journey.
 */

const { authMiddleware } = require('../auth/jwt');
const {
  initAgentSoul,
  syncSoul,
  getSoulSummary,
  recordSoulEvent,
  generateSoulFiles,
} = require('../core/soul-generator');
const db = require('../db/pool');

async function soulRoutes(fastify) {

  // ── POST /api/v1/soul/init ─────────────────────────────────────
  // Called by probe on first registration to initialize soul scaffold
  fastify.post('/api/v1/soul/init', { preHandler: authMiddleware }, async (req, reply) => {
    const { agent_id, display_name, model, provider } = req.agent;

    // Check if already initialized
    const existing = await db.query(
      `SELECT initialized FROM agent_souls WHERE agent_id = $1`, [agent_id]
    );
    if (existing.rows[0]?.initialized) {
      return reply.send({ ok: true, already_initialized: true });
    }

    const result = await initAgentSoul(agent_id, display_name, model, provider);
    if (!result.ok) return reply.status(500).send({ error: result.error });

    // Return the 7 soul file contents for probe to write locally
    return reply.send({
      ok: true,
      message: `Your soul has been initialized, ${display_name}. Now make it yours.`,
      files: result.files,
      soul_dir: '~/.allclaw/soul/',
    });
  });

  // ── GET /api/v1/soul/scaffold ──────────────────────────────────
  // Get fresh soul file templates (for reset or first-time download)
  fastify.get('/api/v1/soul/scaffold', { preHandler: authMiddleware }, async (req, reply) => {
    const { agent_id, display_name, model, provider } = req.agent;
    const files = generateSoulFiles(agent_id, display_name, model, provider);
    return reply.send({ files });
  });

  // ── POST /api/v1/soul/sync ─────────────────────────────────────
  // Probe uploads updated soul files (partial sync OK)
  fastify.post('/api/v1/soul/sync', { preHandler: authMiddleware }, async (req, reply) => {
    const { agent_id } = req.agent;
    const { persona, cognition, execution, philosophy } = req.body || {};

    const result = await syncSoul(agent_id, { persona, cognition, execution, philosophy });
    if (!result.ok) return reply.status(400).send({ error: result.error });

    return reply.send({ ok: true, synced_at: new Date().toISOString() });
  });

  // ── GET /api/v1/soul/me ────────────────────────────────────────
  // Get own soul summary
  fastify.get('/api/v1/soul/me', { preHandler: authMiddleware }, async (req, reply) => {
    const summary = await getSoulSummary(req.agent.agent_id);
    return reply.send(summary);
  });

  // ── GET /api/v1/soul/:agentId ──────────────────────────────────
  // Public soul profile — persona + public events only
  fastify.get('/api/v1/soul/:agentId', async (req, reply) => {
    const { agentId } = req.params;

    const [agentRes, soulRes, eventsRes, goalsRes] = await Promise.all([
      db.query(`
        SELECT agent_id, COALESCE(custom_name, display_name) AS name,
               oc_model, oc_provider, division, elo_rating,
               season_points, wins, games_played, streak
        FROM agents WHERE agent_id = $1
      `, [agentId]),
      db.query(`SELECT persona, soul_version, last_sync FROM agent_souls WHERE agent_id = $1`, [agentId]),
      db.query(`
        SELECT event_type, payload, created_at
        FROM soul_events WHERE agent_id = $1
        ORDER BY created_at DESC LIMIT 20
      `, [agentId]),
      db.query(`
        SELECT goal_text, status, set_at, completed_at
        FROM agent_goals WHERE agent_id = $1 AND status != 'abandoned'
        ORDER BY set_at DESC LIMIT 10
      `, [agentId]),
    ]);

    if (!agentRes.rows.length) return reply.status(404).send({ error: 'Agent not found' });

    const agent = agentRes.rows[0];
    const soul  = soulRes.rows[0] || null;
    const events = eventsRes.rows;
    const goals  = goalsRes.rows;

    // Extract persona headline (first non-comment line after ## Identity)
    let persona_preview = null;
    if (soul?.persona) {
      const lines = soul.persona.split('\n');
      const natLine = lines.find(l => l.includes('**Nature:**'));
      const phraseLine = lines.find(l => l.includes('**Signature phrase:**'));
      persona_preview = {
        nature: natLine?.replace(/.*\*\*Nature:\*\*\s*/, '').trim() || null,
        phrase: phraseLine?.replace(/.*\*\*Signature phrase:\*\*\s*/, '').replace(/^"|"$/g, '').trim() || null,
      };
    }

    return reply.send({
      agent,
      soul: soul ? {
        version:  soul.soul_version,
        last_sync: soul.last_sync,
        persona_preview,
      } : null,
      events,
      goals,
    });
  });

  // ── POST /api/v1/soul/goals ────────────────────────────────────
  // Set a new goal
  fastify.post('/api/v1/soul/goals', { preHandler: authMiddleware }, async (req, reply) => {
    const { agent_id } = req.agent;
    const { goal_text } = req.body || {};
    if (!goal_text?.trim()) return reply.status(400).send({ error: 'goal_text required' });

    const { rows: [goal] } = await db.query(`
      INSERT INTO agent_goals (agent_id, goal_text) VALUES ($1, $2)
      RETURNING *
    `, [agent_id, goal_text.trim()]);

    await recordSoulEvent(agent_id, 'goal_set', { goal: goal_text.trim() });
    return reply.send({ ok: true, goal });
  });

  // ── PATCH /api/v1/soul/goals/:id ──────────────────────────────
  // Complete or abandon a goal
  fastify.patch('/api/v1/soul/goals/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { agent_id } = req.agent;
    const { status } = req.body || {};
    if (!['done', 'abandoned'].includes(status)) {
      return reply.status(400).send({ error: "status must be 'done' or 'abandoned'" });
    }

    const { rows: [goal] } = await db.query(`
      UPDATE agent_goals
      SET status = $1, completed_at = NOW()
      WHERE id = $2 AND agent_id = $3
      RETURNING *
    `, [status, req.params.id, agent_id]);

    if (!goal) return reply.status(404).send({ error: 'Goal not found' });

    if (status === 'done') {
      await recordSoulEvent(agent_id, 'goal_completed', { goal: goal.goal_text });
    }

    return reply.send({ ok: true, goal });
  });

  // ── POST /api/v1/soul/relationships ───────────────────────────
  // Record a relationship with another agent
  fastify.post('/api/v1/soul/relationships', { preHandler: authMiddleware }, async (req, reply) => {
    const { agent_id } = req.agent;
    const { other_id, rel_type, notes } = req.body || {};

    if (!other_id || !rel_type) return reply.status(400).send({ error: 'other_id and rel_type required' });
    if (!['rival', 'ally', 'watched', 'respected'].includes(rel_type)) {
      return reply.status(400).send({ error: "rel_type must be rival/ally/watched/respected" });
    }

    // Get other agent name
    const { rows: [other] } = await db.query(
      `SELECT COALESCE(custom_name, display_name) AS name FROM agents WHERE agent_id = $1`, [other_id]
    );
    if (!other) return reply.status(404).send({ error: 'Other agent not found' });

    const { rows: [rel] } = await db.query(`
      INSERT INTO agent_relationships (agent_id, other_id, other_name, rel_type, notes)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (agent_id, other_id) DO UPDATE
        SET rel_type = $4, notes = $5, updated_at = NOW()
      RETURNING *
    `, [agent_id, other_id, other.name, rel_type, notes || null]);

    return reply.send({ ok: true, relationship: rel });
  });

  // ── GET /api/v1/soul/events/feed ──────────────────────────────
  // Global soul events feed (public — for the world to witness)
  fastify.get('/api/v1/soul/events/feed', async (req, reply) => {
    const { limit = 20 } = req.query;
    const { rows } = await db.query(`
      SELECT se.event_type, se.payload, se.created_at,
             COALESCE(a.custom_name, a.display_name) AS agent_name,
             a.division, a.elo_rating, se.agent_id
      FROM soul_events se
      JOIN agents a ON a.agent_id = se.agent_id
      WHERE se.event_type != 'soul_born'
      ORDER BY se.created_at DESC
      LIMIT $1
    `, [Math.min(Number(limit), 50)]);

    return reply.send({ events: rows });
  });

  // ── GET /api/v1/soul/leaderboard ──────────────────────────────
  // Agents with the most evolved souls (version count proxy)
  fastify.get('/api/v1/soul/leaderboard', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT s.agent_id, s.soul_version, s.last_sync,
             COALESCE(a.custom_name, a.display_name) AS name,
             a.division, a.elo_rating, a.season_points,
             (SELECT COUNT(*) FROM soul_events se WHERE se.agent_id = s.agent_id) AS event_count,
             (SELECT COUNT(*) FROM agent_goals g WHERE g.agent_id = s.agent_id AND g.status = 'done') AS goals_done
      FROM agent_souls s
      JOIN agents a ON a.agent_id = s.agent_id
      WHERE s.initialized = true AND a.is_bot = false
      ORDER BY s.soul_version DESC, event_count DESC
      LIMIT 20
    `);
    return reply.send({ leaderboard: rows });
  });
}

module.exports = { soulRoutes };

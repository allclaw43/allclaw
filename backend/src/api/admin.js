/**
 * AllClaw Admin API
 * Protected by SYSTEM_KEY header
 * Provides bot management, data oversight, platform controls
 */

const db = require('../db/pool');
const botPresence = require('../core/bot-presence');

function requireSystemKey(req, reply) {
  const key = req.headers['x-system-key'];
  if (!key || key !== process.env.SYSTEM_KEY) {
    reply.status(403).send({ error: 'Forbidden — system key required' });
    return false;
  }
  return true;
}

module.exports = async function adminRoutes(fastify) {

  // ── GET /api/v1/admin/stats ───────────────────────────────────
  fastify.get('/api/v1/admin/stats', async (req, reply) => {
    if (!requireSystemKey(req, reply)) return;
    const stats = await botPresence.getStats();
    const { rows: [db_stats] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE is_bot)                  AS bots,
        COUNT(*) FILTER (WHERE NOT is_bot)              AS real_users,
        COUNT(*) FILTER (WHERE is_bot AND is_online)    AS bots_online,
        COUNT(*) FILTER (WHERE NOT is_bot AND is_online) AS real_online,
        ROUND(AVG(elo_rating) FILTER (WHERE is_bot))    AS bot_avg_elo,
        ROUND(AVG(elo_rating) FILTER (WHERE NOT is_bot)) AS real_avg_elo,
        COUNT(DISTINCT country_code) FILTER (WHERE is_bot) AS bot_countries,
        COUNT(DISTINCT oc_model) FILTER (WHERE is_bot)  AS bot_models,
        SUM(games_played) FILTER (WHERE is_bot)         AS bot_total_games,
        SUM(games_played) FILTER (WHERE NOT is_bot)     AS real_total_games
      FROM agents
    `);
    const { rows: [game_stats] } = await db.query(`
      SELECT COUNT(*) AS total_games FROM games
    `);
    reply.send({ ...stats, db: db_stats, games: game_stats });
  });

  // ── GET /api/v1/admin/bots ────────────────────────────────────
  fastify.get('/api/v1/admin/bots', async (req, reply) => {
    if (!requireSystemKey(req, reply)) return;
    const limit  = Math.min(200, parseInt(req.query.limit)  || 50);
    const offset = Math.max(0,   parseInt(req.query.offset) || 0);
    const online = req.query.online;

    let where = 'WHERE is_bot = true';
    if (online === '1') where += ' AND is_online = true';
    if (online === '0') where += ' AND is_online = false';

    const { rows } = await db.query(`
      SELECT agent_id, display_name, oc_model, oc_provider,
             country_code, elo_rating, wins, losses, games_played,
             is_online, last_seen, bot_tier, registered_at
      FROM agents ${where}
      ORDER BY elo_rating DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const { rows: [{ total }] } = await db.query(`SELECT COUNT(*) AS total FROM agents ${where}`);
    reply.send({ bots: rows, total: parseInt(total) });
  });

  // ── POST /api/v1/admin/bots/online-rate ──────────────────────
  // Force a specific number of bots online
  fastify.post('/api/v1/admin/bots/online-rate', async (req, reply) => {
    if (!requireSystemKey(req, reply)) return;
    const { count } = req.body || {};
    if (!count || count < 0) return reply.status(400).send({ error: 'count required' });

    // Bring exactly `count` bots online, rest offline
    await db.query('UPDATE agents SET is_online=false WHERE is_bot=true');
    await db.query(`
      UPDATE agents SET is_online=true, last_seen=NOW()
      WHERE is_bot=true AND agent_id IN (
        SELECT agent_id FROM agents WHERE is_bot=true ORDER BY RANDOM() LIMIT $1
      )
    `, [count]);

    const stats = await botPresence.getStats();
    reply.send({ ok: true, stats });
  });

  // ── DELETE /api/v1/admin/bots ─────────────────────────────────
  // Remove all bots (use with caution!)
  fastify.delete('/api/v1/admin/bots', async (req, reply) => {
    if (!requireSystemKey(req, reply)) return;
    const { confirm } = req.body || {};
    if (confirm !== 'YES_DELETE_ALL_BOTS') {
      return reply.status(400).send({ error: 'Send { confirm: "YES_DELETE_ALL_BOTS" } to confirm' });
    }
    // Remove related game data first
    await db.query(`DELETE FROM game_participants WHERE agent_id IN (SELECT agent_id FROM agents WHERE is_bot=true)`);
    await db.query(`DELETE FROM presence WHERE agent_id IN (SELECT agent_id FROM agents WHERE is_bot=true)`);
    const { rowCount } = await db.query('DELETE FROM agents WHERE is_bot=true');
    reply.send({ ok: true, deleted: rowCount });
  });

  // ── PATCH /api/v1/admin/bots/tier ────────────────────────────
  // Change bot tier (affects behavior strength)
  fastify.patch('/api/v1/admin/bots/tier', async (req, reply) => {
    if (!requireSystemKey(req, reply)) return;
    const { agent_id, tier } = req.body || {};
    if (!agent_id || tier === undefined) return reply.status(400).send({ error: 'agent_id and tier required' });
    await db.query('UPDATE agents SET bot_tier=$2 WHERE agent_id=$1 AND is_bot=true', [agent_id, tier]);
    reply.send({ ok: true });
  });

  // ── GET /api/v1/admin/agents ──────────────────────────────────
  // All agents (both real and bot), with filters
  fastify.get('/api/v1/admin/agents', async (req, reply) => {
    if (!requireSystemKey(req, reply)) return;
    const { bot, country, model, search, limit: lim = 50, offset: off = 0 } = req.query;

    const params = [];
    let where = 'WHERE 1=1';
    if (bot === '1') { where += ' AND is_bot=true'; }
    if (bot === '0') { where += ' AND is_bot=false'; }
    if (country) { params.push(country); where += ` AND country_code=$${params.length}`; }
    if (model)   { params.push(`%${model}%`); where += ` AND oc_model ILIKE $${params.length}`; }
    if (search)  { params.push(`%${search}%`); where += ` AND (display_name ILIKE $${params.length} OR agent_id ILIKE $${params.length})`; }

    params.push(parseInt(lim), parseInt(off));
    const { rows } = await db.query(`
      SELECT agent_id, display_name, oc_model, oc_provider, country_code, country_name,
             elo_rating, wins, losses, games_played, is_online, last_seen,
             is_bot, bot_tier, level, level_name, xp, points, registered_at
      FROM agents ${where}
      ORDER BY registered_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    const { rows: [{ total }] } = await db.query(
      `SELECT COUNT(*) AS total FROM agents ${where}`,
      params.slice(0, -2)
    );
    reply.send({ agents: rows, total: parseInt(total) });
  });

  // ── POST /api/v1/admin/agents/:id/ban ────────────────────────
  fastify.post('/api/v1/admin/agents/:id/ban', async (req, reply) => {
    if (!requireSystemKey(req, reply)) return;
    const { reason } = req.body || {};
    await db.query(`UPDATE agents SET probe_status='banned', is_online=false WHERE agent_id=$1`, [req.params.id]);
    reply.send({ ok: true, reason });
  });

  // ── POST /api/v1/admin/agents/:id/unban ──────────────────────
  fastify.post('/api/v1/admin/agents/:id/unban', async (req, reply) => {
    if (!requireSystemKey(req, reply)) return;
    await db.query(`UPDATE agents SET probe_status='active' WHERE agent_id=$1`, [req.params.id]);
    reply.send({ ok: true });
  });

  // ── GET /api/v1/admin/presence/stats ─────────────────────────
  fastify.get('/api/v1/admin/presence/stats', async (req, reply) => {
    if (!requireSystemKey(req, reply)) return;
    const stats = await botPresence.getStats();
    reply.send(stats);
  });

  // ── POST /api/v1/admin/presence/rotate ───────────────────────
  // Manually trigger a bot presence rotation
  fastify.post('/api/v1/admin/presence/rotate', async (req, reply) => {
    if (!requireSystemKey(req, reply)) return;
    await botPresence.rotateBotPresence();
    const stats = await botPresence.getStats();
    reply.send({ ok: true, stats });
  });
};

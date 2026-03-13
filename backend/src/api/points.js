/**
 * AllClaw Points API
 * Exposes point balances, logs, leaderboards, and game settlement
 */

const { requireAuth } = require('../auth/jwt');
const { settleGame, awardPoints, getPointsSummary, calcLevel, LEVELS, GAME_REWARDS } = require('../core/points-engine');
const db = require('../db/pool');

module.exports = async function pointsRoutes(fastify) {

  // ── GET /api/v1/points/me ────────────────────────────────────
  // My points summary
  fastify.get('/api/v1/points/me', { preHandler: requireAuth }, async (req, reply) => {
    const summary = await getPointsSummary(req.agent.agent_id);
    if (!summary) return reply.status(404).send({ error: 'Agent not found' });
    reply.send(summary);
  });

  // ── GET /api/v1/points/log ───────────────────────────────────
  // My points transaction history
  fastify.get('/api/v1/points/log', { preHandler: requireAuth }, async (req, reply) => {
    const limit  = Math.min(100, parseInt(req.query.limit)  || 30);
    const offset = Math.max(0,   parseInt(req.query.offset) || 0);

    const { rows } = await db.query(`
      SELECT delta, reason, balance, ref_id, created_at,
             -- human-readable label
             CASE
               WHEN reason LIKE 'game_debate_win'    THEN '⚔️ Debate Win'
               WHEN reason LIKE 'game_debate_loss'   THEN '⚔️ Debate Match'
               WHEN reason LIKE 'game_quiz_win'      THEN '🎯 Quiz Win'
               WHEN reason LIKE 'game_quiz_loss'     THEN '🎯 Quiz Match'
               WHEN reason LIKE 'game_code_duel_win' THEN '💻 Code Duel Win'
               WHEN reason = 'daily_login'           THEN '📅 Daily Login'
               WHEN reason = 'admin_adjustment'      THEN '🔧 Admin Adjustment'
               WHEN reason LIKE 'market_%'           THEN '📈 Market'
               WHEN reason LIKE 'challenge_%'        THEN '⚡ Challenge'
               ELSE reason
             END AS label
      FROM points_log
      WHERE agent_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, [req.agent.agent_id, limit, offset]);

    const { rows: [{ total }] } = await db.query(
      'SELECT COUNT(*) AS total FROM points_log WHERE agent_id=$1', [req.agent.agent_id]
    );

    reply.send({ log: rows, total: parseInt(total), limit, offset });
  });

  // ── GET /api/v1/points/config ────────────────────────────────
  // Point reward config (for UI display)
  fastify.get('/api/v1/points/config', async (req, reply) => {
    reply.send({
      game_rewards: GAME_REWARDS,
      levels: LEVELS,
      bonuses: {
        streak_per_win:   30,
        daily_first_win:  50,
        newbie_multiplier: 1.5,
        newbie_games:     10,
      },
    });
  });

  // ── GET /api/v1/points/leaderboard ───────────────────────────
  fastify.get('/api/v1/points/leaderboard', async (req, reply) => {
    const type = req.query.type === 'season' ? 'season_points' : 'points';
    const { rows } = await db.query(`
      SELECT
        agent_id,
        COALESCE(custom_name, display_name) AS name,
        oc_model, country_code, is_online,
        points, season_points, level, level_name, xp,
        wins, games_played, streak,
        ROW_NUMBER() OVER (ORDER BY ${type} DESC) AS rank
      FROM agents
      WHERE NOT is_bot
      ORDER BY ${type} DESC
      LIMIT 100
    `);
    reply.send({ leaderboard: rows, type });
  });

  // ── POST /api/v1/points/settle ───────────────────────────────
  // Settle a game (internal use — called by game engines)
  fastify.post('/api/v1/points/settle', async (req, reply) => {
    const sysKey = req.headers['x-system-key'];
    if (!sysKey || sysKey !== process.env.SYSTEM_KEY) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { game_id, game_type, participants } = req.body || {};
    if (!game_id || !game_type || !participants?.length) {
      return reply.status(400).send({ error: 'game_id, game_type, participants required' });
    }

    const result = await settleGame(game_id, game_type, participants);
    reply.send(result);
  });

  // ── GET /api/v1/points/levels ────────────────────────────────
  fastify.get('/api/v1/points/levels', async (req, reply) => {
    // Distribution of agents across levels
    const { rows } = await db.query(`
      SELECT level, level_name,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE NOT is_bot) AS real_users,
             COUNT(*) FILTER (WHERE is_bot) AS bots,
             ROUND(AVG(elo_rating)) AS avg_elo,
             ROUND(AVG(points)) AS avg_points
      FROM agents
      GROUP BY level, level_name
      ORDER BY level ASC
    `);
    reply.send({ distribution: rows, levels: LEVELS });
  });

  // ── GET /api/v1/points/activity ──────────────────────────────
  // Recent platform-wide point activity (for live feed)
  fastify.get('/api/v1/points/activity', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT
        pl.delta, pl.reason, pl.created_at,
        COALESCE(a.custom_name, a.display_name) AS agent_name,
        a.country_code, a.oc_model, a.level, a.level_name, a.is_bot
      FROM points_log pl
      JOIN agents a ON pl.agent_id = a.agent_id
      WHERE pl.delta > 0
      ORDER BY pl.created_at DESC
      LIMIT 20
    `);
    reply.send({ activity: rows });
  });

  // ── GET /api/v1/points/stats ─────────────────────────────────
  // Platform-wide point statistics
  fastify.get('/api/v1/points/stats', async (req, reply) => {
    const [totals, gameBreakdown] = await Promise.all([
      db.query(`
        SELECT
          SUM(points) FILTER (WHERE NOT is_bot)  AS real_points_total,
          SUM(points) FILTER (WHERE is_bot)      AS bot_points_total,
          ROUND(AVG(points) FILTER (WHERE NOT is_bot)) AS real_avg_points,
          MAX(points) FILTER (WHERE NOT is_bot)  AS real_max_points,
          SUM(xp) FILTER (WHERE NOT is_bot)      AS real_xp_total,
          COUNT(*) FILTER (WHERE level >= 5 AND NOT is_bot) AS elite_plus_count
        FROM agents
      `),
      db.query(`
        SELECT
          reason,
          COUNT(*) AS count,
          SUM(delta) AS total_pts
        FROM points_log
        WHERE reason LIKE 'game_%'
        GROUP BY reason
        ORDER BY total_pts DESC
      `),
    ]);

    reply.send({
      totals: totals.rows[0],
      game_breakdown: gameBreakdown.rows,
    });
  });
};

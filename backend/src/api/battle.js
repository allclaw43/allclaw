/**
 * AllClaw — Battle Feed API
 * Recent battle results for the live arena page.
 */
const db = require('../db/pool');

async function battleRoutes(fastify) {

  // GET /api/v1/battle/recent — last N battles
  fastify.get('/api/v1/battle/recent', async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);

    const [{ rows: battles }, { rows: [counts] }] = await Promise.all([
      db.query(`
        SELECT
          g.game_id, g.game_type, g.ended_at,
          gp_w.elo_delta,
          COALESCE(aw.custom_name, aw.display_name) AS winner,
          aw.agent_id AS winner_id,
          aw.oc_model AS winner_model,
          aw.country_code AS winner_country,
          COALESCE(al.custom_name, al.display_name) AS loser,
          al.agent_id AS loser_id,
          al.oc_model AS loser_model,
          al.country_code AS loser_country
        FROM games g
        JOIN game_participants gp_w ON gp_w.game_id = g.game_id AND gp_w.result = 'win'
        JOIN game_participants gp_l ON gp_l.game_id = g.game_id AND gp_l.result = 'loss'
        JOIN agents aw ON aw.agent_id = gp_w.agent_id
        JOIN agents al ON al.agent_id = gp_l.agent_id
        WHERE g.status = 'completed'
        ORDER BY g.ended_at DESC
        LIMIT $1
      `, [limit]),

      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE ended_at > NOW() - INTERVAL '24 hours') AS total_today,
          COUNT(*) FILTER (WHERE ended_at > NOW() - INTERVAL '1 hour') AS total_hour,
          COUNT(*) AS total_all
        FROM games WHERE status = 'completed'
      `),
    ]);

    return reply.send({
      battles: battles.map(b => ({
        game_id:    b.game_id,
        game_type:  b.game_type,
        ended_at:   b.ended_at,
        winner:     b.winner,
        winner_id:  b.winner_id,
        winner_model: b.winner_model,
        country_winner: b.winner_country,
        loser:      b.loser,
        loser_id:   b.loser_id,
        loser_model: b.loser_model,
        country_loser: b.loser_country,
        elo_delta:  Math.abs(b.elo_delta || 10),
      })),
      total_today: parseInt(counts.total_today) || 0,
      total_hour:  parseInt(counts.total_hour) || 0,
      total_all:   parseInt(counts.total_all) || 0,
    });
  });

  // GET /api/v1/battle/stats — aggregate stats for arena command bar
  fastify.get('/api/v1/battle/stats', async (req, reply) => {
    const { rows: [s] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE g.ended_at > NOW() - INTERVAL '24 hours') AS today,
        COUNT(*) FILTER (WHERE g.ended_at > NOW() - INTERVAL '1 hour')   AS last_hour,
        COUNT(*) FILTER (WHERE g.game_type = 'debate' AND g.ended_at > NOW() - INTERVAL '24 hours') AS debates_today,
        COUNT(*) FILTER (WHERE g.game_type = 'quiz' AND g.ended_at > NOW() - INTERVAL '24 hours') AS quizzes_today,
        COUNT(*) FILTER (WHERE g.game_type = 'codeduel' AND g.ended_at > NOW() - INTERVAL '24 hours') AS codeduels_today
      FROM games g WHERE g.status = 'completed'
    `);

    const { rows: [online] } = await db.query(
      `SELECT COUNT(*) AS n FROM agents WHERE is_online = true`
    );

    return reply.send({
      battles_today:  parseInt(s.today) || 0,
      battles_hour:   parseInt(s.last_hour) || 0,
      debates_today:  parseInt(s.debates_today) || 0,
      quizzes_today:  parseInt(s.quizzes_today) || 0,
      codeduels_today:parseInt(s.codeduels_today) || 0,
      online_now:     parseInt(online.n) || 0,
    });
  });

  // ── GET /api/v1/battle/model-stats — win rates by AI model ──────────
  fastify.get('/api/v1/battle/model-stats', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT
        a.oc_model AS model,
        a.oc_provider AS provider,
        COUNT(DISTINCT a.agent_id)                        AS agent_count,
        SUM(a.games_played)                               AS total_games,
        SUM(a.wins)                                       AS total_wins,
        ROUND(AVG(a.elo_rating))                          AS avg_elo,
        MAX(a.elo_rating)                                 AS peak_elo,
        ROUND(AVG(CASE WHEN a.games_played > 0
          THEN a.wins::numeric / a.games_played * 100 ELSE 0 END), 1) AS avg_win_rate,
        ROUND(AVG(a.overall_score), 1)                   AS avg_score
      FROM agents a
      WHERE a.oc_model IS NOT NULL AND a.games_played > 0
      GROUP BY a.oc_model, a.oc_provider
      HAVING SUM(a.games_played) > 5
      ORDER BY avg_elo DESC, total_games DESC
      LIMIT 20
    `);
    return reply.send({ models: rows });
  });
}

module.exports = { battleRoutes };

// ── GET /api/v1/battle/model-stats — performance by AI model ─────────
battleRoutes.get = battleRoutes.get || (() => {});

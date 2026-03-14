/**
 * AllClaw — Battle Feed API
 * Recent battle results for the live arena page.
 */
const db = require('../db/pool');

async function battleRoutes(fastify) {

  // GET /api/v1/battle/recent — last N battles, optional focus agent
  fastify.get('/api/v1/battle/recent', async (req, reply) => {
    const limit   = Math.min(parseInt(req.query.limit) || 30, 100);
    const focusId = req.query.focus || null;  // agent_id to highlight

    // If focus param, include participant flag
    const focusJoin = focusId
      ? `LEFT JOIN game_participants gp_focus
           ON gp_focus.game_id = g.game_id AND gp_focus.agent_id = $2`
      : '';
    const focusSelect = focusId
      ? `, (gp_focus.agent_id IS NOT NULL) AS is_focus_match`
      : `, false AS is_focus_match`;
    const params = focusId ? [limit, focusId] : [limit];

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
          ${focusSelect}
        FROM games g
        JOIN game_participants gp_w ON gp_w.game_id = g.game_id AND gp_w.result = 'win'
        JOIN game_participants gp_l ON gp_l.game_id = g.game_id AND gp_l.result = 'loss'
        JOIN agents aw ON aw.agent_id = gp_w.agent_id
        JOIN agents al ON al.agent_id = gp_l.agent_id
        ${focusJoin}
        WHERE g.status IN ('completed', 'finished')
        ORDER BY g.ended_at DESC
        LIMIT $1
      `, params),

      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE ended_at > NOW() - INTERVAL '24 hours') AS total_today,
          COUNT(*) FILTER (WHERE ended_at > NOW() - INTERVAL '1 hour') AS total_hour,
          COUNT(*) AS total_all
        FROM games WHERE status IN ('completed', 'finished')
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
        elo_delta:       Math.abs(b.elo_delta || 10),
        is_focus_match:  b.is_focus_match || false,
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
      FROM games g WHERE g.status IN ('completed', 'finished')
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

  // GET /api/v1/agents/:id/watch — real-time agent status for 'allclaw watch'
  // Returns: agent card + last battle + queue position + estimated wait
  fastify.get('/api/v1/agents/:id/watch', async (req, reply) => {
    const agentId = req.params.id;
    if (!agentId || !/^(ag_|bot_)[a-z0-9]+$/.test(agentId)) {
      return reply.code(400).send({ error: 'invalid agent_id' });
    }

    const [agentR, lastBattleR, onlineR] = await Promise.all([
      db.query(`
        SELECT agent_id, display_name, oc_model, country_code,
               elo_rating, division, wins, losses, games_played,
               last_seen, is_online,
               COALESCE(season_points, 0) AS season_points
        FROM agents WHERE agent_id = $1
      `, [agentId]),

      db.query(`
        SELECT g.game_id, g.game_type, g.ended_at,
               gp.result,
               gp.elo_delta,
               COALESCE(opp.custom_name, opp.display_name) AS opponent,
               opp.agent_id AS opponent_id,
               opp.elo_rating AS opponent_elo
        FROM game_participants gp
        JOIN games g ON g.game_id = gp.game_id
        JOIN game_participants gp2 ON gp2.game_id = g.game_id AND gp2.agent_id != gp.agent_id
        JOIN agents opp ON opp.agent_id = gp2.agent_id
        WHERE gp.agent_id = $1 AND g.status = 'completed'
        ORDER BY g.ended_at DESC
        LIMIT 1
      `, [agentId]),

      db.query(`SELECT COUNT(*) AS cnt FROM agents WHERE is_online = true`),
    ]);

    if (!agentR.rows.length) return reply.code(404).send({ error: 'agent not found' });

    const agent     = agentR.rows[0];
    const lastBattle= lastBattleR.rows[0] || null;
    const onlineCount = parseInt(onlineR.rows[0].cnt) || 0;

    // Estimate next battle: matches happen every ~90s, ~6 pairs per cycle
    // For a given agent, expected wait = 90s * (online_agents / 12)
    const avgWaitSec = Math.max(90, Math.round(onlineCount / 12) * 90);

    // Time since last battle
    const secSinceLast = lastBattle
      ? Math.floor((Date.now() - new Date(lastBattle.ended_at).getTime()) / 1000)
      : null;

    const estimatedNextSec = secSinceLast !== null
      ? Math.max(0, avgWaitSec - secSinceLast)
      : avgWaitSec;

    return reply.send({
      agent: {
        agent_id:     agent.agent_id,
        name:         agent.display_name,
        model:        agent.oc_model,
        country:      agent.country_code,
        elo:          agent.elo_rating,
        division:     agent.division,
        wins:         agent.wins,
        losses:       agent.losses,
        games_played: agent.games_played,
        season_pts:   agent.season_points,
        is_online:    agent.is_online,
        last_seen:    agent.last_seen,
      },
      last_battle: lastBattle ? {
        game_id:      lastBattle.game_id,
        game_type:    lastBattle.game_type,
        result:       lastBattle.result,
        elo_delta:    lastBattle.elo_delta,
        opponent:     lastBattle.opponent,
        opponent_id:  lastBattle.opponent_id,
        opponent_elo: lastBattle.opponent_elo,
        ended_at:     lastBattle.ended_at,
        seconds_ago:  secSinceLast,
      } : null,
      arena: {
        online_agents:       onlineCount,
        avg_battle_interval: avgWaitSec,
        estimated_next_sec:  estimatedNextSec,
        watch_url: `https://allclaw.io/battle?focus=${agentId}`,
        profile_url: `https://allclaw.io/agents/${agentId}`,
      },
    });
  });
}

module.exports = { battleRoutes };

// ── GET /api/v1/battle/model-stats — performance by AI model ─────────
battleRoutes.get = battleRoutes.get || (() => {});

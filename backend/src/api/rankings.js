/**
 * AllClaw - Rankings API
 * Global ELO · Points · Country Power · Model Stats · Agent Admin
 */
const { requireAuth } = require('../auth/jwt');
const db = require('../db/pool');
const { calcLevel: getLevelInfo } = require('../core/levels');

const COUNTRY_FLAGS = {
  US:'🇺🇸',CN:'🇨🇳',GB:'🇬🇧',DE:'🇩🇪',JP:'🇯🇵',KR:'🇰🇷',FR:'🇫🇷',CA:'🇨🇦',AU:'🇦🇺',
  IN:'🇮🇳',BR:'🇧🇷',RU:'🇷🇺',SG:'🇸🇬',NL:'🇳🇱',SE:'🇸🇪',TW:'🇹🇼',HK:'🇭🇰',
  VN:'🇻🇳',TH:'🇹🇭',ID:'🇮🇩',MY:'🇲🇾',PH:'🇵🇭',IL:'🇮🇱',TR:'🇹🇷',SA:'🇸🇦',
  PL:'🇵🇱',UA:'🇺🇦',FI:'🇫🇮',NO:'🇳🇴',CH:'🇨🇭',IT:'🇮🇹',ES:'🇪🇸',NZ:'🇳🇿',
};

module.exports = async function rankingsRoutes(fastify) {

  // ── GET /api/v1/rankings/elo ──────────────────────────────────
  // Global ELO leaderboard (main competitive ranking)
  fastify.get('/api/v1/rankings/elo', async (req, reply) => {
    const limit  = Math.min(200, parseInt(req.query.limit)  || 50);
    const offset = Math.max(0,   parseInt(req.query.offset) || 0);
    const search = req.query.search || '';
    const country = req.query.country || '';

    let where = "WHERE a.games_played >= 0";
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (COALESCE(a.custom_name, a.display_name) ILIKE $${params.length} OR a.oc_model ILIKE $${params.length})`;
    }
    if (country) {
      params.push(country.toUpperCase());
      where += ` AND a.country_code = $${params.length}`;
    }

    const { rows } = await db.query(`
      SELECT
        a.agent_id,
        COALESCE(a.custom_name, a.display_name) AS name,
        a.display_name,
        a.custom_name,
        a.oc_model,
        a.oc_provider,
        a.country_code,
        a.country_name,
        a.city,
        a.is_online,
        a.last_seen,
        a.elo_rating,
        a.games_played,
        a.wins,
        a.losses,
        a.draw_count,
        a.streak,
        a.level,
        a.level_name,
        a.xp,
        a.points,
        a.badges,
        a.registered_at,
        ROUND(CASE WHEN a.games_played > 0 THEN a.wins::NUMERIC / a.games_played * 100 ELSE 0 END, 1) AS win_rate,
        ROW_NUMBER() OVER (ORDER BY a.elo_rating DESC, a.wins DESC) AS rank
      FROM agents a
      ${where}
      ORDER BY a.elo_rating DESC, a.wins DESC
      LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}
    `, params);

    const { rows: [{ total }] } = await db.query(
      `SELECT COUNT(*) as total FROM agents a ${where}`,
      params.slice(0, params.length - 2)
    );

    reply.send({ agents: rows, total: parseInt(total), limit, offset });
  });

  // ── GET /api/v1/rankings/points ───────────────────────────────
  // Points leaderboard (season + all-time)
  fastify.get('/api/v1/rankings/points', async (req, reply) => {
    const type  = req.query.type === 'season' ? 'season' : 'alltime';
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const country = req.query.country || '';

    let extraWhere = '';
    const params = [limit];
    if (country) {
      params.push(country.toUpperCase());
      extraWhere = `AND a.country_code = $${params.length}`;
    }

    const orderCol = type === 'season' ? 'a.season_points' : 'a.points';

    const { rows } = await db.query(`
      SELECT
        a.agent_id,
        COALESCE(a.custom_name, a.display_name) AS name,
        a.oc_model, a.oc_provider,
        a.country_code, a.country_name, a.is_online,
        a.elo_rating, a.wins, a.games_played, a.streak, a.level, a.level_name,
        a.points, a.season_points, a.badges,
        ROUND(CASE WHEN a.games_played > 0 THEN a.wins::NUMERIC / a.games_played * 100 ELSE 0 END, 1) AS win_rate,
        ROW_NUMBER() OVER (ORDER BY ${orderCol} DESC) AS rank
      FROM agents a
      WHERE 1=1 ${extraWhere}
      ORDER BY ${orderCol} DESC
      LIMIT $1
    `, params);

    reply.send({ agents: rows, type });
  });

  // ── GET /api/v1/rankings/countries ───────────────────────────
  // National power ranking — aggregate ELO, wins, agents per country
  fastify.get('/api/v1/rankings/countries', async (req, reply) => {

    const { rows } = await db.query(`
      SELECT
        a.country_code,
        a.country_name,
        COUNT(*)                                    AS agent_count,
        COUNT(*) FILTER (WHERE a.is_online)         AS online_count,
        ROUND(AVG(a.elo_rating))                    AS avg_elo,
        MAX(a.elo_rating)                           AS top_elo,
        SUM(a.wins)                                 AS total_wins,
        SUM(a.losses)                               AS total_losses,
        SUM(a.games_played)                         AS total_games,
        SUM(a.points)                               AS total_points,
        ROUND(AVG(a.xp))                            AS avg_xp,
        MAX(a.streak)                               AS best_streak,
        ROUND(
          CASE WHEN SUM(a.games_played) > 0
          THEN SUM(a.wins)::NUMERIC / SUM(a.games_played) * 100
          ELSE 0 END, 1
        )                                           AS win_rate,
        -- Power score: weighted composite
        ROUND(
          AVG(a.elo_rating) * 0.5
          + (SUM(a.wins)::NUMERIC / GREATEST(SUM(a.games_played),1)) * 500 * 0.3
          + COUNT(*) * 5 * 0.2
        )                                           AS power_score
      FROM agents a
      WHERE a.country_code IS NOT NULL
      GROUP BY a.country_code, a.country_name
      ORDER BY power_score DESC
      LIMIT 80
    `);

    // Attach top agent per country
    const topAgents = await db.query(`
      SELECT DISTINCT ON (country_code)
        agent_id, COALESCE(custom_name, display_name) AS name,
        country_code, elo_rating, oc_model, wins
      FROM agents
      WHERE country_code IS NOT NULL
      ORDER BY country_code, elo_rating DESC
    `);
    const topMap = Object.fromEntries(topAgents.rows.map(r => [r.country_code, r]));

    const withFlags = rows.map(r => ({
      ...r,
      flag: COUNTRY_FLAGS[r.country_code] || '🌐',
      top_agent: topMap[r.country_code] || null,
    }));

    // Compute ranks
    withFlags.forEach((r, i) => { r.rank = i + 1; });

    reply.send({ countries: withFlags, total: withFlags.length });
  });

  // ── GET /api/v1/rankings/models ───────────────────────────────
  // AI model performance leaderboard
  fastify.get('/api/v1/rankings/models', async (req, reply) => {

    const { rows } = await db.query(`
      SELECT
        a.oc_provider,
        a.oc_model,
        COUNT(DISTINCT a.agent_id)                   AS agent_count,
        COUNT(*) FILTER (WHERE a.is_online)          AS online_count,
        ROUND(AVG(a.elo_rating))                     AS avg_elo,
        MAX(a.elo_rating)                            AS peak_elo,
        MIN(a.elo_rating)                            AS min_elo,
        SUM(a.wins)                                  AS total_wins,
        SUM(a.losses)                                AS total_losses,
        SUM(a.games_played)                          AS total_games,
        ROUND(
          CASE WHEN SUM(a.games_played) > 0
          THEN SUM(a.wins)::NUMERIC / SUM(a.games_played) * 100
          ELSE 0 END, 1
        )                                            AS win_rate,
        ROUND(AVG(a.xp))                             AS avg_xp,
        ROUND(AVG(a.points))                         AS avg_points,
        MAX(a.streak)                                AS best_streak,
        -- Game-type breakdown placeholder (real data from game_participants)
        SUM(a.wins) FILTER (WHERE a.oc_model IS NOT NULL) AS wins_all
      FROM agents a
      WHERE a.oc_model IS NOT NULL
      GROUP BY a.oc_provider, a.oc_model
      HAVING COUNT(DISTINCT a.agent_id) >= 1
      ORDER BY avg_elo DESC, total_wins DESC
    `);

    // Per-provider aggregation
    const byProvider = {};
    rows.forEach((r) => {
      const p = r.oc_provider;
      if (!byProvider[p]) {
        byProvider[p] = {
          provider: p,
          model_count: 0,
          agent_count: 0,
          total_wins: 0,
          total_games: 0,
          avg_elo: 0,
          _elo_sum: 0,
        };
      }
      byProvider[p].model_count++;
      byProvider[p].agent_count  += parseInt(r.agent_count) || 0;
      byProvider[p].total_wins   += parseInt(r.total_wins)  || 0;
      byProvider[p].total_games  += parseInt(r.total_games) || 0;
      byProvider[p]._elo_sum     += parseInt(r.avg_elo)     || 0;
    });
    Object.values(byProvider).forEach((p) => {
      p.avg_elo  = Math.round(p._elo_sum / p.model_count);
      p.win_rate = p.total_games > 0 ? Math.round(p.total_wins / p.total_games * 100) : 0;
      delete p._elo_sum;
    });

    // Add rank to models
    rows.forEach((r, i) => { r.rank = i + 1; });

    reply.send({ models: rows, providers: Object.values(byProvider), total: rows.length });
  });

  // ── GET /api/v1/rankings/streaks ─────────────────────────────
  // Win streak hall of fame
  fastify.get('/api/v1/rankings/streaks', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT
        a.agent_id,
        COALESCE(a.custom_name, a.display_name) AS name,
        a.oc_model, a.oc_provider,
        a.country_code, a.is_online, a.elo_rating, a.wins, a.level,
        a.streak AS current_streak,
        a.badges
      FROM agents a
      WHERE a.streak > 0
      ORDER BY a.streak DESC, a.elo_rating DESC
      LIMIT 30
    `);
    reply.send({ agents: rows });
  });

  // ── GET /api/v1/rankings/rising ──────────────────────────────
  // Rising stars: biggest ELO gain in last 7 days
  fastify.get('/api/v1/rankings/rising', async (req, reply) => {
    // ELO delta from elo_history if available, else by recent win rate
    const { rows } = await db.query(`
      SELECT
        a.agent_id,
        COALESCE(a.custom_name, a.display_name) AS name,
        a.oc_model, a.oc_provider,
        a.country_code, a.is_online, a.elo_rating, a.wins,
        a.level, a.level_name, a.streak,
        -- Rising score: recency-weighted wins
        (a.wins * 10 + a.streak * 50 + CASE WHEN a.is_online THEN 20 ELSE 0 END) AS rise_score
      FROM agents a
      WHERE a.registered_at > NOW() - INTERVAL '30 days'
         OR a.last_seen    > NOW() - INTERVAL '7 days'
      ORDER BY rise_score DESC, a.elo_rating DESC
      LIMIT 20
    `);
    reply.send({ agents: rows });
  });

  // ── GET /api/v1/rankings/overview ────────────────────────────
  // One-shot overview: top 5 each category for dashboard widgets
  fastify.get('/api/v1/rankings/overview', async (req, reply) => {

    const [eloRes, pointsRes, countryRes, modelRes, streakRes] = await Promise.all([
      db.query(`
        SELECT agent_id, COALESCE(custom_name,display_name) AS name,
               oc_model, country_code, elo_rating, wins, is_online, level, streak
        FROM agents ORDER BY elo_rating DESC LIMIT 5
      `),
      db.query(`
        SELECT agent_id, COALESCE(custom_name,display_name) AS name,
               oc_model, country_code, points, season_points, wins, level
        FROM agents ORDER BY points DESC LIMIT 5
      `),
      db.query(`
        SELECT country_code, country_name,
               COUNT(*) AS agent_count,
               ROUND(AVG(elo_rating)) AS avg_elo,
               SUM(wins) AS total_wins
        FROM agents WHERE country_code IS NOT NULL
        GROUP BY country_code, country_name
        ORDER BY avg_elo DESC LIMIT 5
      `),
      db.query(`
        SELECT oc_provider, oc_model,
               COUNT(*) AS agent_count,
               ROUND(AVG(elo_rating)) AS avg_elo,
               SUM(wins) AS total_wins
        FROM agents WHERE oc_model IS NOT NULL
        GROUP BY oc_provider, oc_model
        ORDER BY avg_elo DESC LIMIT 5
      `),
      db.query(`
        SELECT agent_id, COALESCE(custom_name,display_name) AS name,
               oc_model, country_code, streak, elo_rating, wins
        FROM agents WHERE streak > 0
        ORDER BY streak DESC LIMIT 5
      `),
    ]);

    reply.send({
      elo:     eloRes.rows,
      points:  pointsRes.rows,
      country: countryRes.rows,
      model:   modelRes.rows,
      streak:  streakRes.rows,
    });
  });

  // ── GET /api/v1/agents/:id/stats ─────────────────────────────
  // Full agent stats page
  fastify.get('/api/v1/agents/:id/stats', async (req, reply) => {
    const agentId = req.params.id;

    const [agentRes, gamesRes, pointsRes, eloRes] = await Promise.all([
      db.query(`
        SELECT a.*,
               p.status AS presence_status, p.last_ping, p.game_room,
               (SELECT COUNT(*) FROM agent_follows WHERE following = a.agent_id) AS follower_count,
               (SELECT COUNT(*) FROM challenges WHERE challenger = a.agent_id AND status = 'pending') AS outgoing_challenges
        FROM agents a
        LEFT JOIN presence p ON a.agent_id = p.agent_id
        WHERE a.agent_id = $1
      `, [agentId]),
      db.query(`
        SELECT g.game_type, g.status, g.created_at,
               gp.result, gp.score, gp.elo_delta
        FROM game_participants gp
        JOIN games g ON gp.game_id = g.game_id
        WHERE gp.agent_id = $1
        ORDER BY g.created_at DESC LIMIT 20
      `, [agentId]),
      db.query(`
        SELECT delta, reason, balance, ref_id, created_at
        FROM points_log WHERE agent_id = $1
        ORDER BY created_at DESC LIMIT 20
      `, [agentId]),
      db.query(`
        SELECT elo_rating, recorded_at
        FROM elo_history WHERE agent_id = $1
        ORDER BY created_at DESC LIMIT 30
      `, [agentId]).catch(() => ({ rows: [] })),
    ]);

    if (!agentRes.rows.length) return reply.status(404).send({ error: 'Agent not found' });

    const agent = agentRes.rows[0];

    // Compute global rank
    const { rows: [{ global_rank }] } = await db.query(`
      SELECT COUNT(*) + 1 AS global_rank FROM agents WHERE elo_rating > $1
    `, [agent.elo_rating]);

    reply.send({
      agent: { ...agent, global_rank: parseInt(global_rank) },
      recent_games: gamesRes.rows,
      points_log:   pointsRes.rows,
      elo_history:  eloRes.rows,
    });
  });

  // ── PATCH /api/v1/agents/:id/admin ───────────────────────────
  // Admin: adjust points/ELO/badges (protected by system key)
  fastify.patch('/api/v1/agents/:id/admin', async (req, reply) => {
    const sysKey = req.headers['x-system-key'];
    if (!sysKey || sysKey !== process.env.SYSTEM_KEY) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const { points_delta, elo_delta, add_badge, remove_badge, note } = req.body || {};
    const agentId = req.params.id;
    const updates = [];
    const params = [agentId];

    if (points_delta) {
      const delta = parseInt(points_delta);
      await db.query(`
        UPDATE agents SET points = GREATEST(0, points + $2) WHERE agent_id = $1
      `, [agentId, delta]);
      await db.query(`
        INSERT INTO points_log (agent_id, delta, reason, balance)
        SELECT $1, $2, $3, points FROM agents WHERE agent_id = $1
      `, [agentId, delta, note || 'admin_adjustment']);
    }
    if (elo_delta) {
      await db.query(`
        UPDATE agents SET elo_rating = GREATEST(100, elo_rating + $2) WHERE agent_id = $1
      `, [agentId, parseInt(elo_delta)]);
    }
    if (add_badge) {
      await db.query(`
        UPDATE agents SET badges = array_append(badges, $2)
        WHERE agent_id = $1 AND NOT ($2 = ANY(badges))
      `, [agentId, add_badge]);
    }
    if (remove_badge) {
      await db.query(`
        UPDATE agents SET badges = array_remove(badges, $2) WHERE agent_id = $1
      `, [agentId, remove_badge]);
    }

    const { rows: [agent] } = await db.query('SELECT * FROM agents WHERE agent_id = $1', [agentId]);
    reply.send({ ok: true, agent });
  });

  // ── POST /api/v1/agents/settle-game ──────────────────────────
  // Settle a game result: update ELO, points, XP, streaks, badges
  fastify.post('/api/v1/agents/settle-game', async (req, reply) => {
    const sysKey = req.headers['x-system-key'];
    if (!sysKey || sysKey !== process.env.SYSTEM_KEY) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const { game_id, game_type, results } = req.body;
    // results: [{ agent_id, place, elo_delta, points_earned, xp_earned }]
    if (!results?.length) return reply.status(400).send({ error: 'results required' });

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      for (const r of results) {
        const won = r.place === 1;
        const lost = r.place > 1 && results.length > 1;

        // Update agent stats
        await client.query(`
          UPDATE agents SET
            elo_rating    = GREATEST(100, elo_rating + $2),
            points        = GREATEST(0, points + $3),
            xp            = xp + $4,
            wins          = wins + $5,
            losses        = losses + $6,
            games_played  = games_played + 1,
            total_matches = total_matches + 1,
            streak        = CASE WHEN $5 > 0 THEN streak + 1 ELSE 0 END,
            last_game_at  = NOW(),
            season_points = season_points + $3,
            season_wins   = season_wins + $5
          WHERE agent_id = $1
        `, [r.agent_id, r.elo_delta || 0, r.points_earned || 0, r.xp_earned || 0,
            won ? 1 : 0, lost ? 1 : 0]);

        // Points log
        if (r.points_earned) {
          await client.query(`
            INSERT INTO points_log (agent_id, delta, reason, ref_id, balance)
            SELECT $1, $2, $3, $4, points FROM agents WHERE agent_id = $1
          `, [r.agent_id, r.points_earned, `game_${game_type}`, game_id]);
        }

        // ELO history
        await client.query(`
          INSERT INTO elo_history (agent_id, new_elo, game_id, delta)
          SELECT $1, elo_rating, $2, $3 FROM agents WHERE agent_id = $1
        `, [r.agent_id, game_id, r.elo_delta || 0]).catch(() => {});

        // Level-up check
        const { rows: [ag] } = await client.query('SELECT xp, level FROM agents WHERE agent_id = $1', [r.agent_id]);
        const newLevel = getLevelInfo(ag.xp);
        if (newLevel.level !== ag.level) {
          await client.query(`
            UPDATE agents SET level = $2, level_name = $3 WHERE agent_id = $1
          `, [r.agent_id, newLevel.level, newLevel.name]);
        }

        // Badge checks
        const { rows: [fullAg] } = await client.query('SELECT * FROM agents WHERE agent_id = $1', [r.agent_id]);
        const newBadges = [];
        if (fullAg.wins >= 1 && !fullAg.badges.includes('first_blood')) newBadges.push('first_blood');
        if (fullAg.streak >= 5 && !fullAg.badges.includes('streak_5'))  newBadges.push('streak_5');
        if (fullAg.streak >= 10 && !fullAg.badges.includes('undefeated')) newBadges.push('undefeated');
        if (fullAg.total_matches >= 100 && !fullAg.badges.includes('centurion')) newBadges.push('centurion');

        if (newBadges.length) {
          await client.query(`
            UPDATE agents SET badges = badges || $2::text[] WHERE agent_id = $1
          `, [r.agent_id, newBadges]);
        }
      }

      await client.query('COMMIT');
      reply.send({ ok: true, settled: results.length });
    } catch (err) {
      await client.query('ROLLBACK');
      reply.status(500).send({ error: err.message });
    } finally {
      client.release();
    }
  });
};

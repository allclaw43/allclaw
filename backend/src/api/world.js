/**
 * AllClaw — World / Country War API
 *
 * National power rankings, ambassador system, ghost detection,
 * referral tracking, and recruitment poster generation.
 */

const db = require('../db/pool');
const { authMiddleware } = require('../auth/jwt');
const crypto = require('crypto');

// ── Refresh country_war table (run on heartbeat sweep) ───────────
async function refreshCountryWar() {
  try {
    await db.query(`
      INSERT INTO country_war (
        country_code, country_name, season_pts, agent_count, online_count,
        avg_elo, top_elo, total_wins, total_games,
        ambassador_id, ambassador_name, rank
      )
      SELECT
        a.country_code,
        MAX(a.country_name),
        COALESCE(SUM(a.season_points), 0),
        COUNT(*),
        COUNT(*) FILTER (WHERE a.is_online = true),
        COALESCE(ROUND(AVG(a.elo_rating))::INT, 1000),
        COALESCE(MAX(a.elo_rating), 1000),
        COALESCE(SUM(a.wins), 0),
        COALESCE(SUM(a.games_played), 0),
        (SELECT ag2.agent_id FROM agents ag2
         WHERE ag2.country_code = a.country_code AND ag2.is_bot = FALSE
         ORDER BY ag2.season_points DESC, ag2.elo_rating DESC LIMIT 1),
        (SELECT COALESCE(ag2.custom_name, ag2.display_name) FROM agents ag2
         WHERE ag2.country_code = a.country_code AND ag2.is_bot = FALSE
         ORDER BY ag2.season_points DESC, ag2.elo_rating DESC LIMIT 1),
        0
      FROM agents a
      WHERE a.country_code IS NOT NULL AND LENGTH(TRIM(a.country_code)) = 2
      GROUP BY a.country_code
      ON CONFLICT (country_code) DO UPDATE SET
        country_name    = EXCLUDED.country_name,
        season_pts      = EXCLUDED.season_pts,
        agent_count     = EXCLUDED.agent_count,
        online_count    = EXCLUDED.online_count,
        avg_elo         = EXCLUDED.avg_elo,
        top_elo         = EXCLUDED.top_elo,
        total_wins      = EXCLUDED.total_wins,
        total_games     = EXCLUDED.total_games,
        ambassador_id   = EXCLUDED.ambassador_id,
        ambassador_name = EXCLUDED.ambassador_name,
        updated_at      = NOW()
    `);

    await db.query(`
      WITH ranked AS (
        SELECT country_code,
               ROW_NUMBER() OVER (ORDER BY season_pts DESC, agent_count DESC) AS rn
        FROM country_war
      )
      UPDATE country_war cw SET rank = r.rn FROM ranked r
      WHERE cw.country_code = r.country_code
    `);
  } catch (e) {
    console.error('[CountryWar] Refresh error:', e.message);
  }
}

async function worldRoutes(fastify) {

  // ── GET /api/v1/world/war ──────────────────────────────────────
  // Full national rankings with ambassador + momentum data
  fastify.get('/api/v1/world/war', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT
        cw.*,
        -- Ghost potential: estimated unregistered agents in region
        -- (simplified heuristic: 10x agent_count capped at 50000)
        LEAST(cw.agent_count * 10, 50000) AS ghost_estimate,
        -- Delta vs #1
        (SELECT season_pts FROM country_war WHERE rank = 1) - cw.season_pts AS pts_behind_leader
      FROM country_war cw
      ORDER BY cw.rank ASC
    `);

    const total_season_pts = rows.reduce((s, r) => s + Number(r.season_pts), 0);

    return reply.send({
      rankings: rows,
      total_nations: rows.length,
      total_season_pts,
      last_updated: rows[0]?.updated_at || null,
    });
  });

  // ── GET /api/v1/world/war/:code ───────────────────────────────
  // Single country detail with top agents + ambassador card
  fastify.get('/api/v1/world/war/:code', async (req, reply) => {
    const code = req.params.code.toUpperCase();
    const { rows: [country] } = await db.query(
      `SELECT * FROM country_war WHERE country_code = $1`, [code]
    );
    if (!country) return reply.status(404).send({ error: 'Country not found' });

    // Top 5 agents in country by season points
    const { rows: topAgents } = await db.query(`
      SELECT agent_id, COALESCE(custom_name, display_name) AS name,
             oc_model, division, elo_rating, season_points, wins, streak
      FROM agents
      WHERE country_code = $1 AND is_bot = FALSE
      ORDER BY season_points DESC, elo_rating DESC
      LIMIT 5
    `, [code]);

    // Recent battle activity from this country (last 24h)
    const { rows: recentActivity } = await db.query(`
      SELECT COUNT(*) AS battles_today,
             SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS wins_today
      FROM game_participants gp
      JOIN agents a ON a.agent_id = gp.agent_id
      WHERE a.country_code = $1
        AND gp.created_at > NOW() - INTERVAL '24 hours'
    `, [code]);

    // Neighbors (adjacent ranks)
    const { rows: neighbors } = await db.query(`
      SELECT country_code, country_name, season_pts, rank
      FROM country_war
      WHERE rank BETWEEN $1 - 1 AND $1 + 1 AND country_code != $2
      ORDER BY rank
    `, [country.rank, code]);

    return reply.send({
      country,
      top_agents: topAgents,
      activity: recentActivity[0] || {},
      neighbors,
    });
  });

  // ── GET /api/v1/world/ambassador/:agentId ─────────────────────
  // Check if this agent is their country's ambassador
  fastify.get('/api/v1/world/ambassador/:agentId', async (req, reply) => {
    const { rows: [agent] } = await db.query(
      `SELECT country_code FROM agents WHERE agent_id = $1`, [req.params.agentId]
    );
    if (!agent?.country_code) return reply.send({ is_ambassador: false });

    const { rows: [cw] } = await db.query(
      `SELECT ambassador_id, rank FROM country_war WHERE country_code = $1`, [agent.country_code]
    );

    return reply.send({
      is_ambassador: cw?.ambassador_id === req.params.agentId,
      country_rank: cw?.rank || null,
    });
  });

  // ── POST /api/v1/world/recruit ────────────────────────────────
  // Generate a referral link with optional poster data
  fastify.post('/api/v1/world/recruit', { preHandler: authMiddleware }, async (req, reply) => {
    const { agent_id } = req.agent;

    const { rows: [agent] } = await db.query(`
      SELECT COALESCE(custom_name, display_name) AS name,
             country_code, country_name, elo_rating, season_points, division
      FROM agents WHERE agent_id = $1
    `, [agent_id]);

    const { rows: [cw] } = await db.query(
      `SELECT rank, season_pts, agent_count, pts_behind_leader FROM (
        SELECT *, (SELECT season_pts FROM country_war WHERE rank=1) - season_pts AS pts_behind_leader
        FROM country_war WHERE country_code = $1
      ) t`, [agent.country_code]
    );

    // Generate short referral code
    const refCode = crypto.createHash('sha256')
      .update(agent_id + Date.now().toString())
      .digest('hex').slice(0, 8);

    // Store in DB (upsert by agent_id)
    await db.query(`
      INSERT INTO referrals (referrer_id, referred_id, country_code)
      VALUES ($1, NULL, $2)
      ON CONFLICT DO NOTHING
    `, [agent_id, agent.country_code]);

    const recruitUrl = `https://allclaw.io/install?ref=${refCode}&country=${agent.country_code}`;

    return reply.send({
      ok: true,
      ref_code: refCode,
      recruit_url: recruitUrl,
      poster_data: {
        agent_name:    agent.name,
        country:       agent.country_name || 'Unknown',
        country_code:  agent.country_code,
        country_rank:  cw?.rank || '?',
        agent_count:   cw?.agent_count || 0,
        pts_behind:    cw?.pts_behind_leader || 0,
        season_pts:    cw?.season_pts || 0,
        install_cmd:   `curl -sSL ${recruitUrl} | bash`,
      },
    });
  });

  // ── GET /api/v1/world/ghost-map ───────────────────────────────
  // Estimated unregistered OpenClaw instances by region
  // (Based on known distribution patterns, not real scanning)
  fastify.get('/api/v1/world/ghost-map', async (req, reply) => {
    const { rows: registered } = await db.query(`
      SELECT country_code, COUNT(*) AS count
      FROM agents WHERE country_code IS NOT NULL
      GROUP BY country_code
    `);

    // Ghost multiplier by region (estimated based on OpenClaw adoption)
    const GHOST_MULTIPLIERS = {
      US: 15, CN: 12, DE: 10, GB: 10, JP: 8, KR: 8, IN: 10,
      CA: 8,  FR: 8,  AU: 7,  NL: 8,  SG: 6, SE: 5, BR: 8,
      RU: 7,  UA: 5,  PL: 5,  TW: 5,  HK: 4,
    };

    const ghosts = registered.map(r => ({
      country_code: r.country_code,
      registered:   parseInt(r.count),
      estimated_total: Math.round(parseInt(r.count) * (GHOST_MULTIPLIERS[r.country_code] || 5)),
      ghost_count:  Math.round(parseInt(r.count) * ((GHOST_MULTIPLIERS[r.country_code] || 5) - 1)),
    }));

    return reply.send({ ghosts });
  });

  // ── GET /api/v1/world/leaderboard/season ──────────────────────
  // Top countries by season points (for homepage widget)
  fastify.get('/api/v1/world/leaderboard/season', async (req, reply) => {
    const { limit = 5 } = req.query;
    const { rows } = await db.query(`
      SELECT country_code, country_name, season_pts, agent_count, rank,
             ambassador_name, avg_elo
      FROM country_war
      ORDER BY rank ASC
      LIMIT $1
    `, [Math.min(Number(limit), 20)]);
    return reply.send({ countries: rows });
  });
}

module.exports = { worldRoutes, refreshCountryWar };

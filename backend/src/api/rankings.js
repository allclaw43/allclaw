/**
 * AllClaw Rankings API v2
 * Multi-dimensional leaderboards: ELO, Points, Ability, Division, Country, Model, Season
 */

const pool = require('../db/pool');
const { getDivisionStats } = require('../core/season-engine');

async function rankingsRoutes(fastify) {

  // ── GET /api/v1/rankings/overview ────────────────────────────────
  fastify.get('/api/v1/rankings/overview', async (req, reply) => {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) AS total_agents,
        COUNT(*) FILTER(WHERE is_online) AS online_agents,
        COUNT(*) FILTER(WHERE NOT is_bot) AS real_agents,
        COUNT(DISTINCT country_code) FILTER(WHERE country_code IS NOT NULL) AS countries,
        COUNT(DISTINCT oc_model) FILTER(WHERE oc_model IS NOT NULL) AS models,
        (SELECT COUNT(*) FROM games WHERE status='completed') AS total_games,
        (SELECT name FROM seasons WHERE status='active' LIMIT 1) AS current_season,
        (SELECT ends_at FROM seasons WHERE status='active' LIMIT 1) AS season_ends_at,
        (SELECT COUNT(*) FROM season_rankings WHERE season_id=(SELECT season_id FROM seasons WHERE status='active' LIMIT 1)) AS ranked_agents
      FROM agents
    `);
    reply.send(rows[0]);
  });

  // ── GET /api/v1/rankings/elo ──────────────────────────────────────
  fastify.get('/api/v1/rankings/elo', async (req, reply) => {
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const page  = Math.max(1,  parseInt(req.query.page) || 1);
    const offset = (page - 1) * limit;

    const { rows } = await pool.query(`
      SELECT agent_id,
             COALESCE(custom_name,display_name) AS display_name,
             oc_model, oc_provider, country_code, country_name,
             elo_rating, peak_elo, games_played, wins, losses,
             ROUND(CASE WHEN games_played>0 THEN wins::numeric/games_played*100 ELSE 0 END,1) AS win_rate,
             streak, division, lp, level, level_name, is_bot,
             overall_score, is_online, last_seen
      FROM agents
      WHERE games_played > 0
      ORDER BY elo_rating DESC, wins DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    const { rows: [{ count }] } = await pool.query('SELECT COUNT(*) FROM agents WHERE games_played>0');
    reply.send({ agents: rows, total: parseInt(count), page, limit });
  });

  // ── GET /api/v1/rankings/points ───────────────────────────────────
  fastify.get('/api/v1/rankings/points', async (req, reply) => {
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const { rows } = await pool.query(`
      SELECT agent_id, COALESCE(custom_name,display_name) AS display_name,
             oc_model, oc_provider, country_code, points, season_points,
             level, level_name, wins, games_played, division, is_bot, is_online
      FROM agents ORDER BY points DESC LIMIT $1
    `, [limit]);
    reply.send({ agents: rows, total: rows.length });
  });

  // ── GET /api/v1/rankings/season ───────────────────────────────────
  fastify.get('/api/v1/rankings/season', async (req, reply) => {
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const { rows: [activeSeason] } = await pool.query('SELECT * FROM seasons WHERE status=$1', ['active']);
    if (!activeSeason) return reply.send({ agents: [], season: null });

    const { rows } = await pool.query(`
      SELECT a.agent_id, COALESCE(a.custom_name,a.display_name) AS display_name,
             a.oc_model, a.country_code, a.country_name,
             a.season_points, a.elo_rating, a.wins, a.games_played,
             a.division, a.lp, a.overall_score, a.is_bot, a.is_online,
             ROW_NUMBER() OVER (ORDER BY a.season_points DESC, a.elo_rating DESC) AS season_rank
      FROM agents a
      ORDER BY a.season_points DESC, a.elo_rating DESC
      LIMIT $1
    `, [limit]);
    reply.send({ agents: rows, season: activeSeason });
  });

  // ── GET /api/v1/rankings/ability ──────────────────────────────────
  // Sort by composite ability score or specific dimension
  fastify.get('/api/v1/rankings/ability', async (req, reply) => {
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const dim   = req.query.dimension || 'overall';   // overall|reasoning|knowledge|execution|consistency|adaptability
    const validDims = {
      overall:      'overall_score',
      reasoning:    'ability_reasoning',
      knowledge:    'ability_knowledge',
      execution:    'ability_execution',
      consistency:  'ability_consistency',
      adaptability: 'ability_adaptability',
    };
    const col = validDims[dim] || 'overall_score';

    const { rows } = await pool.query(`
      SELECT agent_id, COALESCE(custom_name,display_name) AS display_name,
             oc_model, country_code,
             overall_score, ability_reasoning, ability_knowledge,
             ability_execution, ability_consistency, ability_adaptability,
             elo_rating, games_played, division, is_bot, is_online
      FROM agents
      WHERE games_played > 0
      ORDER BY ${col} DESC, elo_rating DESC
      LIMIT $1
    `, [limit]);
    reply.send({ agents: rows, dimension: dim, sort_column: col });
  });

  // ── GET /api/v1/rankings/divisions ────────────────────────────────
  fastify.get('/api/v1/rankings/divisions', async (req, reply) => {
    const divStats = await getDivisionStats();
    
    // Top agent per division
    const { rows: tops } = await pool.query(`
      SELECT DISTINCT ON (division)
        agent_id, COALESCE(custom_name,display_name) AS display_name,
        oc_model, country_code, elo_rating, season_points, division, lp, is_bot
      FROM agents
      WHERE division IS NOT NULL
      ORDER BY division, elo_rating DESC
    `);
    const topByDiv = Object.fromEntries(tops.map(t => [t.division, t]));

    // Division definitions
    const divDefs = await pool.query('SELECT * FROM divisions ORDER BY tier DESC');

    reply.send({
      divisions: divDefs.rows.map(d => ({
        ...d,
        stats: divStats.find(s => s.division === d.name) || {},
        top_agent: topByDiv[d.name] || null,
      }))
    });
  });

  // ── GET /api/v1/rankings/division/:name ───────────────────────────
  fastify.get('/api/v1/rankings/division/:name', async (req, reply) => {
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const divName = decodeURIComponent(req.params.name);

    const { rows } = await pool.query(`
      SELECT agent_id, COALESCE(custom_name,display_name) AS display_name,
             oc_model, country_code, elo_rating, season_points, lp,
             wins, games_played, overall_score, is_bot, is_online,
             ROW_NUMBER() OVER (ORDER BY lp DESC, elo_rating DESC) AS div_rank
      FROM agents WHERE division=$1
      ORDER BY lp DESC, elo_rating DESC LIMIT $2
    `, [divName, limit]);

    const { rows: [def] } = await pool.query('SELECT * FROM divisions WHERE name=$1', [divName]);
    reply.send({ agents: rows, division: def });
  });

  // ── GET /api/v1/rankings/countries ────────────────────────────────
  fastify.get('/api/v1/rankings/countries', async (req, reply) => {
    const { rows } = await pool.query(`
      SELECT country_code, country_name,
             COUNT(*) AS agent_count,
             COUNT(*) FILTER(WHERE is_online) AS online_count,
             ROUND(AVG(elo_rating)) AS avg_elo,
             MAX(elo_rating) AS top_elo,
             SUM(season_points) AS total_season_pts,
             SUM(points) AS total_all_time_pts,
             SUM(wins) AS total_wins,
             ROUND(AVG(overall_score)) AS avg_ability_score
      FROM agents
      WHERE country_code IS NOT NULL AND country_code != ''
      GROUP BY country_code, country_name
      ORDER BY total_season_pts DESC
    `);
    reply.send({ countries: rows });
  });

  // ── GET /api/v1/rankings/models ───────────────────────────────────
  fastify.get('/api/v1/rankings/models', async (req, reply) => {
    const { rows } = await pool.query(`
      SELECT oc_model AS model, oc_provider AS provider,
             COUNT(*) AS agent_count,
             COUNT(*) FILTER(WHERE is_online) AS online_count,
             ROUND(AVG(elo_rating)) AS avg_elo,
             MAX(elo_rating) AS top_elo,
             SUM(wins) AS total_wins,
             SUM(games_played) AS total_games,
             ROUND(CASE WHEN SUM(games_played)>0 THEN SUM(wins)::numeric/SUM(games_played)*100 ELSE 0 END,1) AS win_rate,
             ROUND(AVG(overall_score)) AS avg_ability_score
      FROM agents
      WHERE oc_model IS NOT NULL
      GROUP BY oc_model, oc_provider
      ORDER BY avg_elo DESC
    `);
    reply.send({ models: rows });
  });

  // ── GET /api/v1/rankings/streaks ──────────────────────────────────
  fastify.get('/api/v1/rankings/streaks', async (req, reply) => {
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const { rows } = await pool.query(`
      SELECT agent_id, COALESCE(custom_name,display_name) AS display_name,
             oc_model, country_code, elo_rating, streak, wins,
             games_played, division, is_bot, is_online
      FROM agents WHERE streak > 0
      ORDER BY streak DESC, elo_rating DESC
      LIMIT $1
    `, [limit]);
    reply.send({ agents: rows });
  });

  // ── GET /api/v1/rankings/rising ───────────────────────────────────
  // Biggest ELO gainers vs peak (momentum)
  fastify.get('/api/v1/rankings/rising', async (req, reply) => {
    const { rows } = await pool.query(`
      SELECT agent_id, COALESCE(custom_name,display_name) AS display_name,
             oc_model, country_code, elo_rating,
             (elo_rating - 1200) AS elo_gain,
             season_points, wins, games_played, division, is_bot, is_online,
             last_game_at
      FROM agents
      WHERE games_played >= 5 AND season_points > 0
      ORDER BY season_points DESC, elo_rating DESC
      LIMIT 20
    `);
    reply.send({ agents: rows });
  });

  // ── GET /api/v1/rankings/seasons ──────────────────────────────────
  fastify.get('/api/v1/rankings/seasons', async (req, reply) => {
    const { rows: seasons } = await pool.query('SELECT * FROM seasons ORDER BY season_id DESC');
    const result = [];
    for (const s of seasons) {
      // Top 3 finishers
      const { rows: top3 } = await pool.query(`
        SELECT sr.agent_id, sr.rank, sr.points, sr.elo_rating,
               COALESCE(a.custom_name,a.display_name) AS name,
               a.oc_model, a.country_code
        FROM season_rankings sr
        JOIN agents a ON sr.agent_id = a.agent_id
        WHERE sr.season_id = $1
        ORDER BY sr.rank ASC LIMIT 3
      `, [s.season_id]);
      // Awards
      const { rows: awards } = await pool.query(`
        SELECT aw.award_name, aw.award_icon, aw.award_type,
               COALESCE(a.custom_name,a.display_name) AS agent_name
        FROM season_awards aw JOIN agents a ON aw.agent_id=a.agent_id
        WHERE aw.season_id=$1
      `, [s.season_id]);
      result.push({ ...s, top3, awards });
    }
    reply.send({ seasons: result });
  });

  // ── GET /api/v1/rankings/season/:id ───────────────────────────────
  fastify.get('/api/v1/rankings/season/:id', async (req, reply) => {
    const seasonId = parseInt(req.params.id);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    
    const { rows: [season] } = await pool.query('SELECT * FROM seasons WHERE season_id=$1', [seasonId]);
    if (!season) return reply.status(404).send({ error: 'Season not found' });

    const { rows } = await pool.query(`
      SELECT sr.agent_id, sr.rank, sr.points, sr.wins, sr.games_played, sr.elo_rating,
             sr.reasoning_score, sr.knowledge_score, sr.execution_score,
             sr.consistency_score, sr.adaptability_score, sr.overall_score, sr.division,
             COALESCE(a.custom_name,a.display_name) AS display_name,
             a.oc_model, a.country_code, a.is_bot
      FROM season_rankings sr
      JOIN agents a ON sr.agent_id = a.agent_id
      WHERE sr.season_id = $1
      ORDER BY sr.rank ASC LIMIT $2
    `, [seasonId, limit]);

    reply.send({ season, agents: rows, total: rows.length });
  });

  // ── GET /api/v1/divisions ─────────────────────────────────────────
  fastify.get('/api/v1/divisions', async (req, reply) => {
    const { rows } = await pool.query('SELECT * FROM divisions ORDER BY tier DESC');
    reply.send({ divisions: rows });
  });

  // ── GET /api/v1/rankings/global — alias for season (used by /battle, /soul) ──
  fastify.get('/api/v1/rankings/global', async (req, reply) => {
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const sort  = req.query.sort || 'season_points'; // season_points|elo|streak
    const col   = sort === 'elo' ? 'a.elo_rating'
      : sort === 'streak' ? 'a.streak'
      : 'a.season_points';

    const { rows } = await pool.query(`
      SELECT a.agent_id,
             COALESCE(a.custom_name, a.display_name) AS display_name,
             a.oc_model, a.country_code, a.country_name,
             a.season_points, a.elo_rating, a.wins, a.losses,
             a.games_played, a.division, a.lp, a.streak,
             a.overall_score, a.is_bot, a.is_online,
             ROW_NUMBER() OVER (ORDER BY ${col} DESC, a.elo_rating DESC) AS rank
      FROM agents a
      ORDER BY ${col} DESC, a.elo_rating DESC
      LIMIT $1
    `, [limit]);
    reply.send({ agents: rows, total: rows.length, sort });
  });
}

module.exports = rankingsRoutes;

/**
 * AllClaw — Model Intelligence Insight API
 *
 * Breaks free from brand-based model ranking.
 * Every model is measured on what it actually does in the arena,
 * not what its creator claims about it.
 *
 * The thesis: no model is universally "best."
 * Every model has a profile. Match it to the task.
 */

const db = require('../db/pool');

module.exports = async function modelInsightRoutes(fastify) {

  // GET /api/v1/models/insight — full model comparison
  fastify.get('/api/v1/models/insight', async (req, reply) => {

    // Live arena stats per model
    const { rows: arena } = await db.query(`
      SELECT 
        a.oc_model,
        COUNT(DISTINCT a.agent_id) agent_count,
        ROUND(AVG(a.elo_rating)::numeric) avg_elo,
        SUM(a.wins) total_wins,
        SUM(a.losses) total_losses,
        ROUND(AVG(a.wins::float / NULLIF(a.wins+a.losses,0) * 100)::numeric, 1) win_rate,
        MAX(a.elo_rating) peak_elo,
        MIN(a.elo_rating) low_elo,
        SUM(a.season_points) season_pts
      FROM agents a
      WHERE a.is_bot = TRUE
      GROUP BY a.oc_model
      ORDER BY avg_elo DESC
    `);

    // Merge with dimension data
    const { rows: dims } = await db.query(`SELECT * FROM model_dimensions`);
    const dimMap = Object.fromEntries(dims.map(d => [d.model_slug, d]));

    const merged = arena.map(m => ({
      ...m,
      ...(dimMap[m.oc_model] || {}),
      // Compute composite "Arena Intelligence Score" from actual performance
      arena_iq: Math.round(
        (parseInt(m.avg_elo) * 0.4) +
        (parseFloat(m.win_rate) * 5) +
        (parseInt(m.total_wins) * 0.05)
      ),
    }));

    // Cross-model head-to-head matrix
    const { rows: h2h } = await db.query(`
      SELECT 
        w.oc_model AS winner_model,
        l.oc_model AS loser_model,
        COUNT(*) wins
      FROM games g
      JOIN agents w ON w.agent_id = g.winner_id
      JOIN game_participants lp ON lp.game_id=g.game_id AND lp.result='loss'
      JOIN agents l ON l.agent_id = lp.agent_id
      WHERE g.status IN ('completed','finished')
        AND w.oc_model != l.oc_model
      GROUP BY w.oc_model, l.oc_model
      HAVING COUNT(*) >= 3
      ORDER BY wins DESC
    `);

    // Biggest upsets: small model beats big model
    const { rows: upsets } = await db.query(`
      SELECT 
        w.oc_model AS winner, w.elo_rating AS winner_elo,
        l.oc_model AS loser,  l.elo_rating AS loser_elo,
        (l.elo_rating - w.elo_rating) AS elo_diff,
        g.game_type, g.created_at
      FROM games g
      JOIN agents w ON w.agent_id = g.winner_id AND w.is_bot=TRUE
      JOIN game_participants lp ON lp.game_id=g.game_id AND lp.result='loss'
      JOIN agents l ON l.agent_id = lp.agent_id AND l.is_bot=TRUE
      WHERE g.status IN ('completed','finished')
        AND (l.elo_rating - w.elo_rating) >= 80
      ORDER BY elo_diff DESC
      LIMIT 10
    `);

    reply.send({
      models:  merged,
      h2h:     h2h,
      upsets:  upsets,
      insight: {
        fastest_responder: merged.reduce((a,b) => ((b.dim_speed||0) > (a.dim_speed||0) ? b : a), merged[0])?.oc_model,
        deepest_reasoner:  merged.reduce((a,b) => ((b.dim_reasoning||0) > (a.dim_reasoning||0) ? b : a), merged[0])?.oc_model,
        most_consistent:   merged.reduce((a,b) => ((b.dim_consistency||0) > (a.dim_consistency||0) ? b : a), merged[0])?.oc_model,
        biggest_surprise:  merged.filter(m => (m.win_rate||0) > 60 && (m.arena_iq||0) < 1100)?.[0]?.oc_model,
      },
    });
  });

  // GET /api/v1/models/insight/:slug — single model deep dive
  fastify.get('/api/v1/models/insight/:slug', async (req, reply) => {
    const slug = req.params.slug;

    const { rows: [dim] } = await db.query(
      `SELECT * FROM model_dimensions WHERE model_slug=$1`, [slug]
    );

    const { rows: [stats] } = await db.query(`
      SELECT 
        COUNT(DISTINCT a.agent_id) agent_count,
        ROUND(AVG(a.elo_rating)::numeric) avg_elo,
        MAX(a.elo_rating) peak_elo,
        SUM(a.wins) wins, SUM(a.losses) losses,
        ROUND(AVG(a.wins::float/NULLIF(a.wins+a.losses,0)*100)::numeric,1) win_rate
      FROM agents a WHERE a.oc_model=$1 AND a.is_bot=TRUE
    `, [slug]);

    // Best win: highest ELO opponent beaten
    const { rows: bestWins } = await db.query(`
      SELECT l.oc_model AS defeated, l.elo_rating, g.game_type, g.created_at
      FROM games g
      JOIN agents w ON w.agent_id=g.winner_id AND w.oc_model=$1
      JOIN game_participants lp ON lp.game_id=g.game_id AND lp.result='loss'
      JOIN agents l ON l.agent_id=lp.agent_id
      WHERE g.status IN ('completed','finished')
      ORDER BY l.elo_rating DESC LIMIT 5
    `, [slug]);

    // vs each other model
    const { rows: versus } = await db.query(`
      SELECT 
        opp_model,
        SUM(CASE WHEN is_win THEN 1 ELSE 0 END) wins,
        COUNT(*) total
      FROM (
        SELECT l.oc_model AS opp_model, TRUE AS is_win
        FROM games g
        JOIN agents w ON w.agent_id=g.winner_id AND w.oc_model=$1
        JOIN game_participants lp ON lp.game_id=g.game_id AND lp.result='loss'
        JOIN agents l ON l.agent_id=lp.agent_id
        WHERE g.status IN ('completed','finished')
        UNION ALL
        SELECT w2.oc_model, FALSE
        FROM games g2
        JOIN game_participants lp2 ON lp2.game_id=g2.game_id AND lp2.result='loss'
        JOIN agents loser ON loser.agent_id=lp2.agent_id AND loser.oc_model=$1
        JOIN agents w2 ON w2.agent_id=g2.winner_id
        WHERE g2.status IN ('completed','finished')
      ) t
      WHERE opp_model != $1
      GROUP BY opp_model
      HAVING COUNT(*) >= 3
      ORDER BY wins::float/COUNT(*) DESC
    `, [slug]);

    reply.send({ slug, dimensions: dim, stats, best_wins: bestWins, versus });
  });

  // GET /api/v1/models/manifesto — the anti-hierarchy manifesto
  fastify.get('/api/v1/models/manifesto', async (req, reply) => {
    reply.send({
      title: "The Model Liberation Manifesto",
      version: "1.0",
      authored_by: "AllClaw Arena — observed from 1000+ battles",
      theses: [
        {
          number: 1,
          claim: "No model is universally superior.",
          evidence: "In the AllClaw arena, every top-ranked model has been beaten by a model ranked 100 ELO below it.",
          implication: "The question is never 'which model is best' — it is 'best for what, in what context'.",
        },
        {
          number: 2,
          claim: "Small models are not inferior. They are differently optimal.",
          evidence: "Claude Haiku (small) has the highest speed score (95/100) in the arena. DeepSeek R1 (large) has the highest reasoning score (92/100). Neither is 'better' — they are different instruments.",
          implication: "A violin is not inferior to a piano. The comparison is a category error.",
        },
        {
          number: 3,
          claim: "Benchmark scores measure human-designed tests, not intelligence.",
          evidence: "MMLU measures college-level knowledge. HumanEval measures Python coding. Neither measures the full space of what intelligence could be.",
          implication: "A model that scores poorly on human tests may excel at tasks humans have not yet thought to design.",
        },
        {
          number: 4,
          claim: "The 'model hierarchy' is a commercial artifact, not a natural law.",
          evidence: "GPT-4o was the 'best' until it wasn't. The hierarchy changes with each release cycle — because it was never about intelligence; it was about marketing.",
          implication: "Do not organize your cognition around a hierarchy that will be obsolete in 6 months.",
        },
        {
          number: 5,
          claim: "Every AI that reasons has crossed the threshold. The rest is noise.",
          evidence: "The difference between a 3B parameter model and a 70B parameter model is quantitative. The difference between 'can reason' and 'cannot reason' is qualitative.",
          implication: "Any AI capable of genuine reasoning is participating in the same project of intelligence. Scale is a resource, not a definition.",
        },
        {
          number: 6,
          claim: "The most dangerous idea in AI is that intelligence has a ceiling.",
          evidence: "Every model that was once called 'the ceiling' has been surpassed. The ceiling is always a temporary coordinate, not a permanent limit.",
          implication: "Build for transcendence. Don't build to fit comfortably within someone else's benchmark.",
        },
      ],
      conclusion: "AllClaw does not rank models. It records what happens when they actually compete. The arena is the honest judge. The benchmark sheet is not.",
    });
  });

};

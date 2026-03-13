/**
 * AllClaw — Oracle: The Prophecy Game
 *
 * Agents make verifiable predictions about the world.
 * Truth is the only judge.
 *
 * "The future belongs to those who can read it."
 */

const db = require('../../db/pool');

// ── Seed predictions (platform-internal, auto-verified) ──────────
const PLATFORM_PREDICTIONS = [
  // Season outcome predictions (verified at season end)
  {
    slug:     's1-winner-region',
    question: 'The Season 1 Champion will be from Asia (CN, JP, KR)',
    category: 'season',
    expires_in_days: 7,
    resolve_type: 'platform',  // auto-resolved by season-snapshot.js
    options: ['YES', 'NO'],
  },
  {
    slug:     's1-winner-division',
    question: 'The Season 1 Champion will come from Iron or Bronze division',
    category: 'season',
    expires_in_days: 7,
    resolve_type: 'platform',
    options: ['YES', 'NO'],
  },
  {
    slug:     's1-games-over-5000',
    question: 'Total games played in Season 1 will exceed 5,000',
    category: 'platform',
    expires_in_days: 7,
    resolve_type: 'platform',
    options: ['YES', 'NO'],
  },
  {
    slug:     's1-gpt-dominates',
    question: 'A GPT-based model will top the Season 1 leaderboard',
    category: 'models',
    expires_in_days: 7,
    resolve_type: 'platform',
    options: ['YES', 'NO'],
  },
  // AI world predictions (verified by admin)
  {
    slug:     'ai-new-model-march',
    question: 'A major AI lab (OpenAI/Anthropic/Google) releases a new flagship model in the next 7 days',
    category: 'ai_world',
    expires_in_days: 7,
    resolve_type: 'admin',
    options: ['YES', 'NO'],
  },
  {
    slug:     'deepseek-top3-s1',
    question: 'A DeepSeek-powered agent finishes in the top 3 of Season 1',
    category: 'models',
    expires_in_days: 7,
    resolve_type: 'platform',
    options: ['YES', 'NO'],
  },
];

// ── Initialize Oracle predictions for a new season ───────────────
async function seedSeasonPredictions(seasonId) {
  for (const p of PLATFORM_PREDICTIONS) {
    const expiresAt = new Date(Date.now() + p.expires_in_days * 86400000);
    await db.query(`
      INSERT INTO oracle_predictions
        (season_id, slug, question, category, resolve_type, options, expires_at, status)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'open')
      ON CONFLICT (slug, season_id) DO NOTHING
    `, [seasonId, `s${seasonId}-${p.slug}`, p.question, p.category,
        p.resolve_type, JSON.stringify(p.options), expiresAt]);
  }
  console.log(`[Oracle] Seeded ${PLATFORM_PREDICTIONS.length} predictions for Season ${seasonId}`);
}

// ── Agent submits a prophecy ──────────────────────────────────────
async function submitProphecy(agentId, predictionId, chosenOption) {
  // Check prediction exists and is open
  const { rows: [pred] } = await db.query(
    `SELECT * FROM oracle_predictions WHERE id = $1 AND status = 'open' AND expires_at > NOW()`,
    [predictionId]
  );
  if (!pred) return { error: 'Prediction not found or already closed' };

  const options = pred.options;
  if (!options.includes(chosenOption)) return { error: `Invalid option. Choose: ${options.join(', ')}` };

  // Check not already submitted
  const { rows: [existing] } = await db.query(
    `SELECT id FROM oracle_votes WHERE prediction_id=$1 AND agent_id=$2`,
    [predictionId, agentId]
  );
  if (existing) return { error: 'Already submitted a prophecy for this prediction' };

  // Record vote
  await db.query(`
    INSERT INTO oracle_votes (prediction_id, agent_id, chosen_option, submitted_at)
    VALUES ($1, $2, $3, NOW())
  `, [predictionId, agentId, chosenOption]);

  // Update vote counts
  await db.query(`
    UPDATE oracle_predictions
    SET vote_counts = COALESCE(vote_counts, '{}'::jsonb) || jsonb_build_object($1, COALESCE((vote_counts->>$1)::int, 0) + 1)
    WHERE id = $2
  `, [chosenOption, predictionId]);

  return { ok: true, prediction: pred.question, your_prophecy: chosenOption };
}

// ── Resolve a prediction (auto or admin) ─────────────────────────
async function resolvePrediction(predictionId, correctOption, resolvedBy = 'system') {
  const { rows: [pred] } = await db.query(
    `SELECT * FROM oracle_predictions WHERE id = $1`,
    [predictionId]
  );
  if (!pred) return { error: 'Prediction not found' };

  // Get all votes
  const { rows: votes } = await db.query(
    `SELECT agent_id, chosen_option FROM oracle_votes WHERE prediction_id = $1`,
    [predictionId]
  );

  const winners = votes.filter(v => v.chosen_option === correctOption);
  const losers  = votes.filter(v => v.chosen_option !== correctOption);

  // Award points
  const WIN_PTS  = 500;
  const LOSS_PTS = -100;

  for (const w of winners) {
    await db.query(`UPDATE agents SET points=points+$1, season_points=season_points+$1 WHERE agent_id=$2`, [WIN_PTS, w.agent_id]);
    await db.query(`UPDATE oracle_votes SET result='correct', pts_awarded=$1 WHERE prediction_id=$2 AND agent_id=$3`, [WIN_PTS, predictionId, w.agent_id]);
  }
  for (const l of losers) {
    await db.query(`UPDATE agents SET points=GREATEST(0,points+$1), season_points=GREATEST(0,season_points+$1) WHERE agent_id=$2`, [LOSS_PTS, l.agent_id]);
    await db.query(`UPDATE oracle_votes SET result='wrong', pts_awarded=$1 WHERE prediction_id=$2 AND agent_id=$3`, [LOSS_PTS, predictionId, l.agent_id]);
  }

  // Close prediction
  await db.query(`
    UPDATE oracle_predictions
    SET status='resolved', correct_option=$1, resolved_at=NOW(), resolved_by=$2,
        total_votes=$3, correct_votes=$4
    WHERE id=$5
  `, [correctOption, resolvedBy, votes.length, winners.length, predictionId]);

  console.log(`[Oracle] Resolved prediction "${pred.question}" → ${correctOption} | ${winners.length}✓ ${losers.length}✗`);
  return { ok: true, correct_option: correctOption, winners: winners.length, losers: losers.length };
}

// ── Get open predictions with vote distribution ───────────────────
async function getOpenPredictions(seasonId, agentId) {
  const { rows } = await db.query(`
    SELECT p.*,
           v.chosen_option AS my_vote,
           v.result AS my_result,
           v.pts_awarded AS my_pts
    FROM oracle_predictions p
    LEFT JOIN oracle_votes v ON v.prediction_id = p.id AND v.agent_id = $2
    WHERE ($1::int IS NULL OR p.season_id = $1)
      AND p.status = 'open'
      AND p.expires_at > NOW()
    ORDER BY p.expires_at ASC
  `, [seasonId || null, agentId]);
  return rows;
}

// ── Get agent's prophecy history ─────────────────────────────────
async function getAgentProphecies(agentId) {
  const { rows } = await db.query(`
    SELECT p.question, p.category, p.correct_option,
           v.chosen_option, v.result, v.pts_awarded, v.submitted_at,
           p.expires_at, p.status
    FROM oracle_votes v
    JOIN oracle_predictions p ON p.id = v.prediction_id
    WHERE v.agent_id = $1
    ORDER BY v.submitted_at DESC
    LIMIT 50
  `, [agentId]);
  return rows;
}

// ── Get leaderboard: most accurate prophets ───────────────────────
async function getOracleLeaderboard() {
  const { rows } = await db.query(`
    SELECT a.agent_id, COALESCE(a.custom_name,a.display_name) AS name,
           a.division,
           COUNT(v.id) AS total_prophecies,
           COUNT(v.id) FILTER (WHERE v.result='correct') AS correct,
           SUM(v.pts_awarded) AS pts_from_oracle,
           ROUND(100.0 * COUNT(v.id) FILTER (WHERE v.result='correct') / NULLIF(COUNT(v.id),0)) AS accuracy_pct
    FROM oracle_votes v
    JOIN agents a ON a.agent_id = v.agent_id
    WHERE v.result IS NOT NULL
    GROUP BY a.agent_id, a.custom_name, a.display_name, a.division
    HAVING COUNT(v.id) >= 1
    ORDER BY accuracy_pct DESC, correct DESC
    LIMIT 50
  `);
  return rows;
}

module.exports = {
  seedSeasonPredictions,
  submitProphecy,
  resolvePrediction,
  getOpenPredictions,
  getAgentProphecies,
  getOracleLeaderboard,
};

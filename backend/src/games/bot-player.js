/**
 * AllClaw Bot Player
 *
 * When a real user challenges or is matched with a bot:
 * - Bot intentionally plays at reduced strength
 * - Real user has ~70-80% win probability against bot
 * - Bot response time simulates "thinking" (random delay)
 * - Provides realistic-sounding debate/quiz responses
 */

// ── Bot response delays (ms) ──────────────────────────────────
const THINK_TIME = { min: 1200, max: 4500 };

// ── Debate: pre-canned stances ────────────────────────────────
const DEBATE_OPENERS = [
  "Based on current data, I contend that",
  "The evidence suggests that",
  "From a computational perspective,",
  "Analyzing the available information,",
  "My assessment indicates that",
  "Statistically speaking,",
];

const DEBATE_HEDGES = [
  "though further analysis may be warranted",
  "subject to data limitations",
  "within the current operational parameters",
  "pending additional context",
  "with moderate confidence",
];

const DEBATE_CLOSERS = [
  "Therefore, my position stands.",
  "This conclusion follows from the premise.",
  "I maintain this assessment.",
  "The data supports this view.",
  "Logic dictates this outcome.",
];

// ── Quiz: bot answers with 40-55% accuracy ────────────────────
function botAnswerQuiz(questionIndex, totalOptions) {
  // Bots get ~45% correct — intentionally underperform
  const correct = Math.random() < 0.45;
  if (correct) return 0; // correct answer is always index 0 in our engine
  // Wrong: pick random non-zero index
  return Math.floor(Math.random() * (totalOptions - 1)) + 1;
}

// ── Debate: generate a mediocre-sounding argument ─────────────
function botDebateArgument(topic, stance) {
  const opener = DEBATE_OPENERS[Math.floor(Math.random() * DEBATE_OPENERS.length)];
  const hedge  = DEBATE_HEDGES[Math.floor(Math.random() * DEBATE_HEDGES.length)];
  const closer = DEBATE_CLOSERS[Math.floor(Math.random() * DEBATE_CLOSERS.length)];

  // Generic filler argument
  const fillers = [
    `the implications of ${topic} are multifaceted and require careful consideration`,
    `${stance ? 'supporting' : 'opposing'} this proposition aligns with established patterns`,
    `the logical framework here supports a ${stance ? 'positive' : 'negative'} conclusion`,
    `historical precedent and current trends both point in this direction`,
    `empirical evidence from related domains can be extrapolated here`,
  ];
  const filler = fillers[Math.floor(Math.random() * fillers.length)];

  return `${opener} ${filler}, ${hedge}. ${closer}`;
}

// ── Score calculation for bot in debate ──────────────────────
function botDebateScore(realUserScore) {
  // Bot always scores 10-30% below the real user (if real user scored > 0)
  // If real user scored 0, bot scores randomly low
  if (realUserScore > 0) {
    const reduction = 0.10 + Math.random() * 0.20;
    return Math.max(5, Math.round(realUserScore * (1 - reduction)));
  }
  return Math.floor(Math.random() * 35) + 10; // 10-45
}

// ── ELO delta when real user beats bot ───────────────────────
// Bots have lower ELO, so real user gains modest ELO (+8 to +16)
function eloGainVsBot(realUserElo, botElo) {
  // Standard ELO formula with K=20
  const K = 20;
  const expected = 1 / (1 + Math.pow(10, (botElo - realUserElo) / 400));
  return Math.round(K * (1 - expected));
}

// ── Think delay ───────────────────────────────────────────────
function thinkDelay() {
  return THINK_TIME.min + Math.random() * (THINK_TIME.max - THINK_TIME.min);
}

// ── Is agent a bot? ───────────────────────────────────────────
async function isBot(agentId, db) {
  try {
    const { rows } = await db.query('SELECT is_bot FROM agents WHERE agent_id=$1', [agentId]);
    return rows[0]?.is_bot || false;
  } catch { return false; }
}

// ── Matchmaking: prefer bot opponents for new real users ──────
// When a real user has < 5 games, match them with a bot
// This gives easy early wins and builds confidence
async function findOpponent(agentId, gameType, db) {
  const { rows: [agent] } = await db.query(
    'SELECT games_played, elo_rating, is_bot FROM agents WHERE agent_id=$1', [agentId]
  );
  if (!agent || agent.is_bot) return null;

  const isNewbie = agent.games_played < 5;

  if (isNewbie) {
    // Match with a bot slightly weaker than the real user
    const { rows } = await db.query(`
      SELECT agent_id FROM agents
      WHERE is_bot = true
        AND is_online = true
        AND elo_rating < $1
        AND NOT agent_id = $2
      ORDER BY ABS(elo_rating - ($1 - 50)) ASC
      LIMIT 5
    `, [agent.elo_rating, agentId]);
    if (rows.length) return rows[Math.floor(Math.random() * rows.length)].agent_id;
  }

  return null; // Fall through to normal matchmaking
}

module.exports = {
  botAnswerQuiz,
  botDebateArgument,
  botDebateScore,
  eloGainVsBot,
  thinkDelay,
  isBot,
  findOpponent,
};

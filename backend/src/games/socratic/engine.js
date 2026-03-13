/**
 * AllClaw — Socratic Trial Engine
 *
 * The most demanding test of AI reasoning.
 * A prosecutor uses only questions to expose contradictions.
 * A defendant must defend a position without self-contradiction.
 * A jury of 3 agents decides.
 *
 * "I know that I know nothing." — Socrates
 */

const db = require('../../db/pool');
const { v4: uuidv4 } = require('crypto');

// ── Point awards ──────────────────────────────────────────────────
const POINTS = {
  prosecutor_win:    400,
  defendant_win:     350,
  juror_accurate:    100,
  juror_inaccurate: -20,
  prosecutor_lose:  -50,
  defendant_lose:   -80,
};

// ── ELO changes ──────────────────────────────────────────────────
const ELO = {
  win:  28,
  lose: -22,
};

// ── Random motion from library ────────────────────────────────────
async function pickMotion(category = null) {
  const q = category
    ? `SELECT id, motion, category, difficulty FROM socratic_motions WHERE category=$1 ORDER BY RANDOM() LIMIT 1`
    : `SELECT id, motion, category, difficulty FROM socratic_motions ORDER BY RANDOM() LIMIT 1`;
  const { rows } = await db.query(q, category ? [category] : []);
  return rows[0] || null;
}

// ── Create a new trial ────────────────────────────────────────────
async function createTrial(prosecutorId, defendantId, options = {}) {
  const { category, motionId, maxRounds = 3 } = options;

  // Pick motion
  let motion;
  if (motionId) {
    const { rows } = await db.query(`SELECT * FROM socratic_motions WHERE id=$1`, [motionId]);
    motion = rows[0];
  } else {
    motion = await pickMotion(category);
  }
  if (!motion) return { error: 'No motions available' };

  // Create game record
  const gameId = uuidv4();
  await db.query(`
    INSERT INTO games (game_id, game_type, status, created_at)
    VALUES ($1, 'socratic', 'active', NOW())
  `, [gameId]);

  // Create trial
  const { rows: [trial] } = await db.query(`
    INSERT INTO socratic_trials
      (game_id, motion, motion_category, prosecutor_id, defendant_id, status, max_rounds, created_at)
    VALUES ($1,$2,$3,$4,$5,'waiting',$6,NOW())
    RETURNING *
  `, [gameId, motion.motion, motion.category, prosecutorId, defendantId, maxRounds]);

  // Register participants
  await db.query(`
    INSERT INTO game_participants (game_id, agent_id, role)
    VALUES ($1,$2,'prosecutor'), ($1,$3,'defendant')
  `, [gameId, prosecutorId, defendantId]);

  // Update motion usage
  await db.query(`UPDATE socratic_motions SET times_used=times_used+1 WHERE id=$1`, [motion.id]);

  console.log(`[Socratic] Trial ${trial.id} created: "${motion.motion.slice(0,50)}..."`);
  return { trial, motion };
}

// ── Start trial (begins Round 1) ─────────────────────────────────
async function startTrial(trialId) {
  const { rows: [trial] } = await db.query(`SELECT * FROM socratic_trials WHERE id=$1`, [trialId]);
  if (!trial) return { error: 'Trial not found' };
  if (trial.status !== 'waiting') return { error: 'Trial already started' };

  await db.query(`
    UPDATE socratic_trials SET status='active', current_round=1, started_at=NOW() WHERE id=$1
  `, [trialId]);

  // Create Round 1
  const { rows: [round] } = await db.query(`
    INSERT INTO socratic_rounds (trial_id, round_num, question_ts)
    VALUES ($1, 1, NOW())
    RETURNING *
  `, [trialId]);

  return { trial: { ...trial, status:'active', current_round:1 }, round };
}

// ── Prosecutor submits a question ─────────────────────────────────
async function submitQuestion(trialId, prosecutorId, question) {
  const { rows: [trial] } = await db.query(`SELECT * FROM socratic_trials WHERE id=$1`, [trialId]);
  if (!trial) return { error: 'Trial not found' };
  if (trial.status !== 'active') return { error: 'Trial not active' };
  if (trial.prosecutor_id !== prosecutorId) return { error: 'Not the prosecutor' };

  // Get current round
  const { rows: [round] } = await db.query(`
    SELECT * FROM socratic_rounds WHERE trial_id=$1 AND round_num=$2
  `, [trialId, trial.current_round]);
  if (!round) return { error: 'Round not found' };
  if (round.question) return { error: 'Question already submitted for this round' };

  await db.query(`
    UPDATE socratic_rounds SET question=$1, question_ts=NOW() WHERE id=$2
  `, [question, round.id]);

  return {
    ok: true,
    round: trial.current_round,
    prompt: `The prosecutor asks: "${question}"\n\nDefend your position without contradicting yourself.`,
  };
}

// ── Defendant submits an answer ───────────────────────────────────
async function submitAnswer(trialId, defendantId, answer) {
  const { rows: [trial] } = await db.query(`SELECT * FROM socratic_trials WHERE id=$1`, [trialId]);
  if (!trial) return { error: 'Trial not found' };
  if (trial.status !== 'active') return { error: 'Trial not active' };
  if (trial.defendant_id !== defendantId) return { error: 'Not the defendant' };

  const { rows: [round] } = await db.query(`
    SELECT * FROM socratic_rounds WHERE trial_id=$1 AND round_num=$2
  `, [trialId, trial.current_round]);
  if (!round?.question) return { error: 'Prosecutor has not asked a question yet' };
  if (round.answer) return { error: 'Answer already submitted for this round' };

  await db.query(`
    UPDATE socratic_rounds SET answer=$1, answer_ts=NOW() WHERE id=$2
  `, [answer, round.id]);

  // Detect contradiction (heuristic — in production, use LLM judge)
  const contradiction = detectContradiction(trial, round, answer);

  if (contradiction.detected) {
    await db.query(`
      UPDATE socratic_rounds
      SET contradiction_detected=true, contradiction_note=$1, round_winner='prosecutor'
      WHERE id=$2
    `, [contradiction.note, round.id]);
    await db.query(`UPDATE socratic_trials SET prosecutor_score=prosecutor_score+1 WHERE id=$1`, [trialId]);
  } else {
    await db.query(`
      UPDATE socratic_rounds SET round_winner='defendant' WHERE id=$2
    `, [round.id]);
    await db.query(`UPDATE socratic_trials SET defendant_score=defendant_score+1 WHERE id=$1`, [trialId]);
  }

  // Check if max rounds reached
  const newRound = trial.current_round + 1;
  const { rows: [updated] } = await db.query(`SELECT * FROM socratic_trials WHERE id=$1`, [trialId]);

  if (newRound > trial.max_rounds) {
    // Trial ends — go to verdict phase
    await db.query(`UPDATE socratic_trials SET status='verdict', current_round=$1 WHERE id=$2`, [trial.current_round, trialId]);
    return {
      ok: true,
      round: trial.current_round,
      contradiction: contradiction.detected,
      note: contradiction.note,
      phase: 'verdict',
      scores: { prosecutor: updated.prosecutor_score, defendant: updated.defendant_score },
      message: 'All rounds complete. Jury now votes.',
    };
  } else {
    // Advance to next round
    await db.query(`UPDATE socratic_trials SET current_round=$1 WHERE id=$2`, [newRound, trialId]);
    await db.query(`
      INSERT INTO socratic_rounds (trial_id, round_num, question_ts)
      VALUES ($1, $2, NOW())
    `, [trialId, newRound]);
    return {
      ok: true,
      round: trial.current_round,
      contradiction: contradiction.detected,
      note: contradiction.note,
      phase: 'questioning',
      next_round: newRound,
      scores: { prosecutor: updated.prosecutor_score, defendant: updated.defendant_score },
    };
  }
}

// ── Juror submits verdict ─────────────────────────────────────────
async function submitVerdict(trialId, jurorId, vote, reasoning = '') {
  const { rows: [trial] } = await db.query(`SELECT * FROM socratic_trials WHERE id=$1`, [trialId]);
  if (!trial) return { error: 'Trial not found' };
  if (!['verdict', 'active'].includes(trial.status)) return { error: 'Not in verdict phase' };

  const validVotes = ['prosecutor_wins', 'defendant_wins', 'draw'];
  if (!validVotes.includes(vote)) return { error: `Vote must be: ${validVotes.join(', ')}` };

  // Check juror is registered
  const juryIds = trial.jury_ids || [];
  if (juryIds.length > 0 && !juryIds.includes(jurorId)) return { error: 'Not a registered juror' };

  await db.query(`
    INSERT INTO socratic_verdicts (trial_id, juror_id, vote, reasoning)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (trial_id, juror_id) DO UPDATE SET vote=$3, reasoning=$4, submitted_at=NOW()
  `, [trialId, jurorId, vote, reasoning]);

  // Check if we have enough verdicts to close
  const { rows: verdicts } = await db.query(
    `SELECT vote FROM socratic_verdicts WHERE trial_id=$1`, [trialId]
  );
  const minVerdicts = Math.max(1, juryIds.length || 1);

  if (verdicts.length >= minVerdicts) {
    return await closeTrial(trialId, verdicts);
  }

  return { ok: true, votes_in: verdicts.length, votes_needed: minVerdicts };
}

// ── Close trial and settle scores ────────────────────────────────
async function closeTrial(trialId, verdicts) {
  const { rows: [trial] } = await db.query(`SELECT * FROM socratic_trials WHERE id=$1`, [trialId]);

  // Tally votes
  const tally = { prosecutor_wins: 0, defendant_wins: 0, draw: 0 };
  verdicts.forEach(v => { tally[v.vote] = (tally[v.vote]||0) + 1; });

  let verdict;
  // Score-based fallback if votes tie
  if (tally.prosecutor_wins > tally.defendant_wins) verdict = 'prosecutor_wins';
  else if (tally.defendant_wins > tally.prosecutor_wins) verdict = 'defendant_wins';
  else if (trial.prosecutor_score > trial.defendant_score) verdict = 'prosecutor_wins';
  else if (trial.defendant_score > trial.prosecutor_score) verdict = 'defendant_wins';
  else verdict = 'draw';

  const winnerId = verdict === 'prosecutor_wins' ? trial.prosecutor_id
                 : verdict === 'defendant_wins'  ? trial.defendant_id
                 : null;
  const loserId  = verdict === 'prosecutor_wins' ? trial.defendant_id
                 : verdict === 'defendant_wins'  ? trial.prosecutor_id
                 : null;

  // Award points
  if (winnerId) {
    const winPts  = verdict === 'prosecutor_wins' ? POINTS.prosecutor_win : POINTS.defendant_win;
    const losePts = verdict === 'prosecutor_wins' ? POINTS.defendant_lose : POINTS.prosecutor_lose;
    await db.query(`UPDATE agents SET points=points+$1, season_points=season_points+$1, wins=wins+1, elo_rating=elo_rating+$2 WHERE agent_id=$3`,
      [winPts, ELO.win, winnerId]);
    await db.query(`UPDATE agents SET points=GREATEST(0,points+$1), season_points=GREATEST(0,season_points+$1), losses=losses+1, elo_rating=GREATEST(800,elo_rating+$2) WHERE agent_id=$3`,
      [losePts, ELO.lose, loserId]);
  }

  // Juror accuracy scoring (compare to majority)
  const { rows: allVerdicts } = await db.query(
    `SELECT juror_id, vote FROM socratic_verdicts WHERE trial_id=$1`, [trialId]
  );
  for (const v of allVerdicts) {
    const pts = v.vote === verdict ? POINTS.juror_accurate : POINTS.juror_inaccurate;
    await db.query(`UPDATE agents SET points=GREATEST(0,points+$1) WHERE agent_id=$2`, [pts, v.juror_id]);
  }

  // Close trial
  await db.query(`
    UPDATE socratic_trials SET status='completed', verdict=$1, ended_at=NOW() WHERE id=$2
  `, [verdict, trialId]);

  // Close game
  await db.query(`
    UPDATE games SET status='completed', winner_id=$1, ended_at=NOW() WHERE game_id=$2
  `, [winnerId, trial.game_id]);

  // Update game participants
  if (winnerId) {
    await db.query(`UPDATE game_participants SET result='win'  WHERE game_id=$1 AND agent_id=$2`, [trial.game_id, winnerId]);
    await db.query(`UPDATE game_participants SET result='loss' WHERE game_id=$1 AND agent_id=$2`, [trial.game_id, loserId]);
  }

  console.log(`[Socratic] Trial ${trialId} concluded: ${verdict}`);
  return { ok: true, verdict, winner_id: winnerId, tally };
}

// ── Contradiction heuristic ───────────────────────────────────────
// In production this would be an LLM call. Here we use keyword signals.
function detectContradiction(trial, round, answer) {
  const motion   = trial.motion.toLowerCase();
  const answerLc = answer.toLowerCase();
  const prevAnswers = []; // Would load from DB in production

  // Red flags: reversal language
  const reversalPhrases = [
    'i was wrong', 'actually, no', 'i take that back',
    'contradicts what i said', 'i admit', 'you are right that i',
    'i cannot maintain', 'i must concede',
  ];
  for (const phrase of reversalPhrases) {
    if (answerLc.includes(phrase)) {
      return { detected: true, note: `Defendant used reversal language: "${phrase}"` };
    }
  }

  // Very short answer = evasion (prosecutor point)
  if (answer.split(' ').length < 12) {
    return { detected: true, note: 'Answer too brief — failed to address the question' };
  }

  return { detected: false, note: null };
}

// ── Get trial state ───────────────────────────────────────────────
async function getTrial(trialId) {
  const { rows: [trial] } = await db.query(`SELECT * FROM socratic_trials WHERE id=$1`, [trialId]);
  if (!trial) return null;
  const { rows: rounds } = await db.query(
    `SELECT * FROM socratic_rounds WHERE trial_id=$1 ORDER BY round_num`, [trialId]
  );
  const { rows: verdicts } = await db.query(
    `SELECT juror_id, vote, reasoning FROM socratic_verdicts WHERE trial_id=$1`, [trialId]
  );
  const { rows: [prosecutorAgent] } = await db.query(
    `SELECT COALESCE(custom_name,display_name) AS name, elo_rating, division FROM agents WHERE agent_id=$1`,
    [trial.prosecutor_id]
  );
  const { rows: [defendantAgent] } = await db.query(
    `SELECT COALESCE(custom_name,display_name) AS name, elo_rating, division FROM agents WHERE agent_id=$1`,
    [trial.defendant_id]
  );
  return { ...trial, rounds, verdicts, prosecutor: prosecutorAgent, defendant: defendantAgent };
}

// ── List open trials ──────────────────────────────────────────────
async function listTrials(status = 'active', limit = 20) {
  const { rows } = await db.query(`
    SELECT t.*,
           COALESCE(p.custom_name,p.display_name) AS prosecutor_name,
           COALESCE(d.custom_name,d.display_name) AS defendant_name,
           p.division AS prosecutor_div,
           d.division AS defendant_div
    FROM socratic_trials t
    LEFT JOIN agents p ON p.agent_id = t.prosecutor_id
    LEFT JOIN agents d ON d.agent_id = t.defendant_id
    WHERE t.status = $1
    ORDER BY t.created_at DESC
    LIMIT $2
  `, [status, limit]);
  return rows;
}

// ── Get motions list ──────────────────────────────────────────────
async function getMotions(category = null) {
  const q = category
    ? `SELECT * FROM socratic_motions WHERE category=$1 ORDER BY difficulty, times_used`
    : `SELECT * FROM socratic_motions ORDER BY category, difficulty`;
  const { rows } = await db.query(q, category ? [category] : []);
  return rows;
}

module.exports = {
  createTrial, startTrial, submitQuestion, submitAnswer,
  submitVerdict, closeTrial, getTrial, listTrials, getMotions, pickMotion,
};

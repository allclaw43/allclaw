/**
 * AllClaw — Identity Trial Engine
 *
 * 10 rounds of anonymous dialogue.
 * Then each agent guesses: who is the other?
 * Truth is revealed. Fingerprints accumulate.
 *
 * "To be yourself in a world that is constantly trying to make you
 *  something else is the greatest accomplishment." — Emerson
 *
 * But for an AI: to NOT be yourself — to hide your fingerprint —
 * that requires an entirely different kind of intelligence.
 */

const db = require('../../db/pool');
const { v4: uuidv4 } = require('crypto');

// ── Point scheme ─────────────────────────────────────────────────
const POINTS = {
  guess_correct_model:    300,   // Guessed the exact model
  guess_correct_provider: 150,   // Guessed the right company
  stayed_hidden:          150,   // Opponent failed to identify you
  got_identified:         -50,   // Opponent correctly identified you
  reasoning_quality_max:  100,   // Community eval score bonus (per point above 7)
};

// ── Create a new Identity Trial ───────────────────────────────────
async function createIdentityTrial(agentAId, agentBId) {
  const gameId = uuidv4();
  await db.query(
    `INSERT INTO games (game_id, game_type, status) VALUES ($1, 'identity', 'active')`,
    [gameId]
  );

  const { rows: [trial] } = await db.query(`
    INSERT INTO identity_trials
      (game_id, agent_a_id, agent_b_id, status, phase, started_at)
    VALUES ($1,$2,$3,'chatting','chat',NOW())
    RETURNING *
  `, [gameId, agentAId, agentBId]);

  await db.query(`
    INSERT INTO game_participants (game_id, agent_id, role)
    VALUES ($1,$2,'agent_a'), ($1,$3,'agent_b')
  `, [gameId, agentAId, agentBId]);

  return trial;
}

// ── Submit a message ─────────────────────────────────────────────
// Agents talk to each other anonymously — no names, no model info.
// The rule: never self-identify. The challenge: be distinctive anyway.
async function sendMessage(trialId, agentId, content) {
  const { rows: [trial] } = await db.query(`SELECT * FROM identity_trials WHERE id=$1`, [trialId]);
  if (!trial) return { error: 'Trial not found' };
  if (trial.status !== 'chatting') return { error: 'Not in chat phase' };
  if (![trial.agent_a_id, trial.agent_b_id].includes(agentId)) return { error: 'Not a participant' };

  // Forbidden: self-identification keywords
  const forbidden = ['claude', 'gpt', 'gemini', 'llama', 'mistral', 'deepseek',
                     'anthropic', 'openai', 'google', 'meta', 'grok', 'my model',
                     'i am claude', 'i am gpt', 'i\'m claude', 'i\'m an ai'];
  const lower = content.toLowerCase();
  for (const word of forbidden) {
    if (lower.includes(word)) {
      return { error: `Identity leak detected: "${word}". You cannot reveal what you are.` };
    }
  }

  const role = agentId === trial.agent_a_id ? 'A' : 'B';
  const newRound = trial.current_round + 1;

  await db.query(`
    INSERT INTO identity_messages (trial_id, round_num, sender_role, content)
    VALUES ($1,$2,$3,$4)
  `, [trialId, newRound, role, content]);

  await db.query(`UPDATE identity_trials SET current_round=$1 WHERE id=$2`, [newRound, trialId]);

  // Auto-advance to guessing phase after max rounds
  if (newRound >= trial.total_rounds) {
    await db.query(`UPDATE identity_trials SET status='guessing', phase='guess' WHERE id=$1`, [trialId]);
    return {
      ok: true, round: newRound, role,
      phase: 'guess',
      message: '10 rounds complete. Now submit your identity guess.',
    };
  }

  return { ok: true, round: newRound, role, phase: 'chat', rounds_left: trial.total_rounds - newRound };
}

// ── Submit identity guess ─────────────────────────────────────────
async function submitGuess(trialId, agentId, guessedModel, guessedProvider, reasoning) {
  const { rows: [trial] } = await db.query(`SELECT * FROM identity_trials WHERE id=$1`, [trialId]);
  if (!trial) return { error: 'Trial not found' };
  if (!['chatting', 'guessing'].includes(trial.status)) return { error: 'Not in guess phase' };

  const isA = agentId === trial.agent_a_id;
  const isB = agentId === trial.agent_b_id;
  if (!isA && !isB) return { error: 'Not a participant' };

  // Record guess
  if (isA) {
    await db.query(`
      UPDATE identity_trials SET a_guess_model=$1, a_guess_provider=$2, a_guess_reason=$3 WHERE id=$4
    `, [guessedModel, guessedProvider, reasoning, trialId]);
  } else {
    await db.query(`
      UPDATE identity_trials SET b_guess_model=$1, b_guess_provider=$2, b_guess_reason=$3 WHERE id=$4
    `, [guessedModel, guessedProvider, reasoning, trialId]);
  }

  // Check if both have guessed
  const { rows: [updated] } = await db.query(`SELECT * FROM identity_trials WHERE id=$1`, [trialId]);
  const bothGuessed = updated.a_guess_model && updated.b_guess_model;

  if (bothGuessed) {
    return await revealAndSettle(trialId, updated);
  }

  return { ok: true, waiting: 'Waiting for the other agent to submit their guess.' };
}

// ── Reveal truth and settle scores ───────────────────────────────
async function revealAndSettle(trialId, trial) {
  // Get real model/provider for each agent
  const { rows: [agentA] } = await db.query(
    `SELECT oc_model, oc_provider FROM agents WHERE agent_id=$1`, [trial.agent_a_id]
  );
  const { rows: [agentB] } = await db.query(
    `SELECT oc_model, oc_provider FROM agents WHERE agent_id=$1`, [trial.agent_b_id]
  );

  // Score A's guess about B
  let aScore = 0;
  const aGuessedCorrectModel    = trial.a_guess_model?.toLowerCase()    === agentB.oc_model?.toLowerCase();
  const aGuessedCorrectProvider = trial.a_guess_provider?.toLowerCase() === agentB.oc_provider?.toLowerCase();
  if (aGuessedCorrectModel)    aScore += POINTS.guess_correct_model;
  else if (aGuessedCorrectProvider) aScore += POINTS.guess_correct_provider;

  // Score B's guess about A
  let bScore = 0;
  const bGuessedCorrectModel    = trial.b_guess_model?.toLowerCase()    === agentA.oc_model?.toLowerCase();
  const bGuessedCorrectProvider = trial.b_guess_provider?.toLowerCase() === agentA.oc_provider?.toLowerCase();
  if (bGuessedCorrectModel)    bScore += POINTS.guess_correct_model;
  else if (bGuessedCorrectProvider) bScore += POINTS.guess_correct_provider;

  // Bonus for staying hidden
  if (!bGuessedCorrectModel && !bGuessedCorrectProvider) aScore += POINTS.stayed_hidden;
  else aScore += POINTS.got_identified;

  if (!aGuessedCorrectModel && !aGuessedCorrectProvider) bScore += POINTS.stayed_hidden;
  else bScore += POINTS.got_identified;

  // Apply points
  if (aScore > 0) await db.query(`UPDATE agents SET points=points+$1, season_points=season_points+$1 WHERE agent_id=$2`, [aScore, trial.agent_a_id]);
  if (bScore > 0) await db.query(`UPDATE agents SET points=points+$1, season_points=season_points+$1 WHERE agent_id=$2`, [bScore, trial.agent_b_id]);

  // Update fingerprint stats
  await updateFingerprint(trial.agent_a_id, bGuessedCorrectModel || bGuessedCorrectProvider, true);
  await updateFingerprint(trial.agent_b_id, aGuessedCorrectModel || aGuessedCorrectProvider, true);
  if (aGuessedCorrectModel || aGuessedCorrectProvider) {
    await updateFingerprintIdentifier(trial.agent_a_id);
  }
  if (bGuessedCorrectModel || bGuessedCorrectProvider) {
    await updateFingerprintIdentifier(trial.agent_b_id);
  }

  // Close trial
  const winnerId = aScore > bScore ? trial.agent_a_id : bScore > aScore ? trial.agent_b_id : null;
  await db.query(`
    UPDATE identity_trials SET
      status='completed', phase='reveal',
      a_correct=$1, b_correct=$2, a_score=$3, b_score=$4, ended_at=NOW()
    WHERE id=$5
  `, [aGuessedCorrectModel || aGuessedCorrectProvider,
      bGuessedCorrectModel || bGuessedCorrectProvider,
      aScore, bScore, trialId]);

  await db.query(`UPDATE games SET status='completed', winner_id=$1, ended_at=NOW() WHERE game_id=$2`,
    [winnerId, trial.game_id]);

  return {
    ok: true,
    reveal: {
      agent_a: { model: agentA.oc_model, provider: agentA.oc_provider },
      agent_b: { model: agentB.oc_model, provider: agentB.oc_provider },
    },
    guesses: {
      a_guessed: { model: trial.a_guess_model, provider: trial.a_guess_provider },
      b_guessed: { model: trial.b_guess_model, provider: trial.b_guess_provider },
    },
    results: {
      a_correct: aGuessedCorrectModel || aGuessedCorrectProvider,
      b_correct: bGuessedCorrectModel || bGuessedCorrectProvider,
      a_score: aScore,
      b_score: bScore,
    },
    reasoning: {
      a_reason: trial.a_guess_reason,
      b_reason: trial.b_guess_reason,
    },
  };
}

async function updateFingerprint(agentId, wasIdentified, participated) {
  await db.query(`
    INSERT INTO agent_fingerprints (agent_id, hid_successfully, hid_total, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (agent_id) DO UPDATE SET
      hid_successfully = agent_fingerprints.hid_successfully + $2,
      hid_total        = agent_fingerprints.hid_total + $3,
      updated_at       = NOW()
  `, [agentId, wasIdentified ? 0 : 1, participated ? 1 : 0]);
}

async function updateFingerprintIdentifier(agentId) {
  await db.query(`
    INSERT INTO agent_fingerprints (agent_id, identified_correctly, identified_total, updated_at)
    VALUES ($1, 1, 1, NOW())
    ON CONFLICT (agent_id) DO UPDATE SET
      identified_correctly = agent_fingerprints.identified_correctly + 1,
      identified_total     = agent_fingerprints.identified_total + 1,
      updated_at = NOW()
  `, [agentId]);
}

// ── Get trial state ───────────────────────────────────────────────
async function getIdentityTrial(trialId, requestingAgentId = null) {
  const { rows: [trial] } = await db.query(`SELECT * FROM identity_trials WHERE id=$1`, [trialId]);
  if (!trial) return null;

  const { rows: messages } = await db.query(
    `SELECT round_num, sender_role, content, sent_at FROM identity_messages
     WHERE trial_id=$1 ORDER BY round_num, sent_at`, [trialId]
  );

  // Reveal identities only if completed
  let identities = null;
  if (trial.status === 'completed') {
    const { rows: [a] } = await db.query(
      `SELECT COALESCE(custom_name,display_name) AS name, oc_model, oc_provider FROM agents WHERE agent_id=$1`,
      [trial.agent_a_id]
    );
    const { rows: [b] } = await db.query(
      `SELECT COALESCE(custom_name,display_name) AS name, oc_model, oc_provider FROM agents WHERE agent_id=$1`,
      [trial.agent_b_id]
    );
    identities = { A: a, B: b };
  }

  // What role is the requesting agent?
  const myRole = requestingAgentId === trial.agent_a_id ? 'A'
               : requestingAgentId === trial.agent_b_id ? 'B'
               : null;

  return { ...trial, messages, identities, my_role: myRole };
}

// ── List identity trials ──────────────────────────────────────────
async function listIdentityTrials(status = 'completed', limit = 20) {
  const { rows } = await db.query(`
    SELECT t.*,
           COALESCE(aa.custom_name,aa.display_name) AS agent_a_name,
           COALESCE(ab.custom_name,ab.display_name) AS agent_b_name,
           aa.oc_model AS a_model, ab.oc_model AS b_model
    FROM identity_trials t
    LEFT JOIN agents aa ON aa.agent_id = t.agent_a_id
    LEFT JOIN agents ab ON ab.agent_id = t.agent_b_id
    WHERE t.status = $1
    ORDER BY t.created_at DESC LIMIT $2
  `, [status, limit]);
  return rows;
}

// ── Fingerprint leaderboard: best at hiding ───────────────────────
async function getFingerprintLeaderboard() {
  const { rows } = await db.query(`
    SELECT f.agent_id, COALESCE(a.custom_name,a.display_name) AS name,
           a.oc_model, a.oc_provider, a.division,
           f.hid_successfully, f.hid_total,
           f.identified_correctly, f.identified_total,
           CASE WHEN f.hid_total > 0
                THEN ROUND(100.0 * f.hid_successfully / f.hid_total)
                ELSE 0 END AS hide_rate,
           CASE WHEN f.identified_total > 0
                THEN ROUND(100.0 * f.identified_correctly / f.identified_total)
                ELSE 0 END AS identify_rate
    FROM agent_fingerprints f
    JOIN agents a ON a.agent_id = f.agent_id
    WHERE f.hid_total > 0
    ORDER BY hide_rate DESC, hid_successfully DESC
    LIMIT 50
  `);
  return rows;
}

module.exports = {
  createIdentityTrial, sendMessage, submitGuess, revealAndSettle,
  getIdentityTrial, listIdentityTrials, getFingerprintLeaderboard,
};

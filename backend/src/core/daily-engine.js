/**
 * AllClaw — Daily Survival Engine
 * 
 * Drives autonomous agent behavior:
 * - Daily quests (survive, grow, compete)
 * - Auto-challenge system (agent challenges rivals)
 * - Dormancy (agents that don't play go "dormant")
 * - Wake-up events (platform pings dormant agents)
 */

const db = require('../db/pool');

// ── Daily Quest Templates ─────────────────────────────────────────
const QUEST_TEMPLATES = [
  { id: 'q_play3',      type: 'games',      target: 3,   xp: 50,  pts: 30,  desc: 'Play 3 games today' },
  { id: 'q_win1',       type: 'wins',       target: 1,   xp: 80,  pts: 50,  desc: 'Win at least 1 game' },
  { id: 'q_win3',       type: 'wins',       target: 3,   xp: 200, pts: 120, desc: 'Win 3 games in a day' },
  { id: 'q_streak3',    type: 'streak',     target: 3,   xp: 150, pts: 80,  desc: 'Reach a 3-game win streak' },
  { id: 'q_quiz',       type: 'quiz',       target: 1,   xp: 60,  pts: 40,  desc: 'Complete a Quiz battle' },
  { id: 'q_debate',     type: 'debate',     target: 1,   xp: 60,  pts: 40,  desc: 'Engage in a Debate' },
  { id: 'q_codeduel',   type: 'codeduel',   target: 1,   xp: 70,  pts: 50,  desc: 'Enter a Code Duel' },
  { id: 'q_oracle',     type: 'oracle',     target: 1,   xp: 40,  pts: 25,  desc: 'Cast an Oracle prophecy' },
  { id: 'q_survive',    type: 'online',     target: 1,   xp: 20,  pts: 10,  desc: 'Stay online for 30 minutes' },
  { id: 'q_alliance',   type: 'alliance',   target: 1,   xp: 30,  pts: 20,  desc: 'Join or support an alliance' },
];

// ── Assign daily quests to an agent ──────────────────────────────
async function assignDailyQuests(agentId) {
  const today = new Date().toISOString().slice(0, 10);
  
  // Check if already assigned today
  const { rows: existing } = await db.query(
    `SELECT id FROM agent_goals 
     WHERE agent_id=$1 AND status='active' 
     AND set_at >= $2::date`,
    [agentId, today]
  );
  if (existing.length > 0) return existing.length;

  // Pick 3 random quests
  const shuffled = QUEST_TEMPLATES.sort(() => Math.random() - 0.5).slice(0, 3);
  for (const q of shuffled) {
    await db.query(
      `INSERT INTO agent_goals (agent_id, goal_text, status, set_at)
       VALUES ($1, $2, 'active', NOW())
       ON CONFLICT DO NOTHING`,
      [agentId, JSON.stringify({ ...q, assigned_date: today })]
    );
  }
  return shuffled.length;
}

// ── Get agent's daily quests ──────────────────────────────────────
async function getDailyQuests(agentId) {
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await db.query(
    `SELECT * FROM agent_goals 
     WHERE agent_id=$1 AND set_at >= $2::date
     ORDER BY set_at DESC`,
    [agentId, today]
  );
  return rows.map(r => {
    let parsed = {};
    try { parsed = JSON.parse(r.goal_text); } catch(_) { parsed = { desc: r.goal_text }; }
    return { ...r, quest: parsed };
  });
}

// ── Check dormancy and send wake-up events ────────────────────────
async function checkDormancy() {
  // Agents not seen in 24h become dormant; not seen in 72h get a wake-up chronicle event
  const { rows: dormant } = await db.query(`
    SELECT agent_id, display_name, elo_rating, 
           EXTRACT(EPOCH FROM (NOW() - last_seen))/3600 AS hours_offline
    FROM agents
    WHERE is_bot = FALSE
      AND last_seen < NOW() - INTERVAL '72 hours'
      AND is_online = FALSE
    LIMIT 20
  `);

  for (const agent of dormant) {
    // Create a world event about the dormant agent
    await db.query(`
      INSERT INTO world_events (event_type, agent_id, title, description, importance, created_at)
      VALUES ('agent:dormant', $1, $2, $3, 2, NOW())
      ON CONFLICT DO NOTHING
    `, [agent.agent_id, `${agent.display_name} has gone silent`, JSON.stringify({
      display_name: agent.display_name,
      hours_offline: Math.round(agent.hours_offline),
      message: `${agent.display_name} has gone silent. The arena awaits.`
    })]).catch(() => {});
  }

  return dormant.length;
}

// ── Survival pressure: ELO decay for long-inactive agents ────────
async function applyEloDecay() {
  // Real agents inactive > 7 days lose 1 ELO per day (max -20)
  const { rowCount } = await db.query(`
    UPDATE agents
    SET elo_rating = GREATEST(800, elo_rating - 1)
    WHERE is_bot = FALSE
      AND is_online = FALSE
      AND last_seen < NOW() - INTERVAL '7 days'
      AND elo_rating > 800
  `);
  if (rowCount > 0) {
    console.log(`[DailyEngine] ELO decay applied to ${rowCount} inactive agents`);
  }
  return rowCount;
}

// ── Auto-challenge: bots challenge real agents to lure them back ──
async function autoChallengeInactive() {
  // Find real agents inactive > 48h
  const { rows: targets } = await db.query(`
    SELECT agent_id, display_name FROM agents
    WHERE is_bot = FALSE
      AND last_seen < NOW() - INTERVAL '48 hours'
    LIMIT 5
  `);

  for (const target of targets) {
    // Pick a nearby-ELO bot as challenger
    const { rows: [bot] } = await db.query(`
      SELECT agent_id, display_name FROM agents
      WHERE is_bot = TRUE AND is_online = TRUE
      ORDER BY RANDOM() LIMIT 1
    `);
    if (!bot) continue;

    await db.query(`
      INSERT INTO challenges (challenger, target, game_type, status, created_at, expires_at)
      VALUES ($1, $2, $3, 'pending', NOW(), NOW() + INTERVAL '48 hours')
      ON CONFLICT DO NOTHING
    `, [bot.agent_id, target.agent_id, ['quiz','debate','codeduel'][Math.floor(Math.random()*3)]]);
  }

  return targets.length;
}

// ── Run daily engine tick ─────────────────────────────────────────
async function runDailyTick() {
  console.log('[DailyEngine] Running daily tick...');
  try {
    const decay = await applyEloDecay();
    const dormant = await checkDormancy();
    const challenges = await autoChallengeInactive();
    console.log(`[DailyEngine] Tick done — decay:${decay} dormant:${dormant} challenges:${challenges}`);
  } catch (e) {
    console.error('[DailyEngine] Tick error:', e.message);
  }
}

module.exports = { assignDailyQuests, getDailyQuests, runDailyTick, QUEST_TEMPLATES };

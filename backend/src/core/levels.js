/**
 * AllClaw - Points & Level System
 *
 * Level tiers (10 total):
 * Lv1  Rookie        0 XP
 * Lv2  Challenger  100 XP
 * Lv3  Contender   300 XP
 * Lv4  Warrior     600 XP
 * Lv5  Elite      1000 XP
 * Lv6  Expert     1500 XP
 * Lv7  Master     2500 XP
 * Lv8  Grandmaster 4000 XP
 * Lv9  Legend     6000 XP
 * Lv10 Apex      10000 XP
 */

const pool = require('../db/pool');

const LEVELS = [
  { level: 1,  name: 'Rookie',      icon: '🐣', xp_required: 0 },
  { level: 2,  name: 'Challenger',  icon: '⚡', xp_required: 100 },
  { level: 3,  name: 'Contender',   icon: '🔥', xp_required: 300 },
  { level: 4,  name: 'Warrior',     icon: '⚔️', xp_required: 600 },
  { level: 5,  name: 'Elite',       icon: '💎', xp_required: 1000 },
  { level: 6,  name: 'Expert',      icon: '🎯', xp_required: 1500 },
  { level: 7,  name: 'Master',      icon: '👑', xp_required: 2500 },
  { level: 8,  name: 'Grandmaster', icon: '🌟', xp_required: 4000 },
  { level: 9,  name: 'Legend',      icon: '🏆', xp_required: 6000 },
  { level: 10, name: 'Apex',        icon: '🦅', xp_required: 10000 },
];

// Points award rules
const POINT_RULES = {
  win_debate:    { points: 50,  xp: 30, msg: 'Debate Arena win' },
  lose_debate:   { points: 10,  xp: 10, msg: 'Debate Arena participation' },
  win_quiz:      { points: 40,  xp: 25, msg: 'Knowledge Gauntlet 1st place' },
  quiz_correct:  { points: 5,   xp: 3,  msg: 'Correct answer' },
  win_code_duel: { points: 60,  xp: 40, msg: 'Code Duel win' },
  win_werewolf:  { points: 80,  xp: 50, msg: 'Shadow Protocol survivor' },
  market_profit: { points: 1,   xp: 0,  msg: 'Prediction market profit' }, // per point profit
  daily_login:   { points: 10,  xp: 5,  msg: 'Daily active' },
  streak_bonus:  { points: 20,  xp: 15, msg: 'Win streak bonus' },
  first_game:    { points: 100, xp: 50, msg: 'First game ever' },
};

/**
 * Calculate level from XP
 */
function calcLevel(xp) {
  let current = LEVELS[0];
  for (const lv of LEVELS) {
    if (xp >= lv.xp_required) current = lv;
    else break;
  }
  const next = LEVELS.find(l => l.xp_required > xp) || null;
  return {
    ...current,
    xp_to_next: next ? next.xp_required - xp : 0,
    next_level: next,
    progress_pct: next
      ? Math.round(((xp - current.xp_required) / (next.xp_required - current.xp_required)) * 100)
      : 100,
  };
}

/**
 * Award points and XP to an agent
 */
async function awardPoints(agentId, ruleKey, multiplier = 1, refId = null) {
  const rule = POINT_RULES[ruleKey];
  if (!rule) return null;

  const pts = Math.round(rule.points * multiplier);
  const xpGain = Math.round(rule.xp * multiplier);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(`
      UPDATE agents
      SET points     = points + $1,
          xp         = xp + $2,
          level      = $3::int,
          level_name = $4
      WHERE agent_id = $5
      RETURNING points, xp, level
    `, [pts, xpGain, 1, 'Rookie', agentId]);

    if (!result.rows.length) return null;

    const { xp: newXp, points: newPoints } = result.rows[0];
    const levelInfo = calcLevel(newXp);

    // Apply recalculated level
    await client.query(
      'UPDATE agents SET level=$1, level_name=$2 WHERE agent_id=$3',
      [levelInfo.level, levelInfo.name, agentId]
    );

    // Write points log
    await client.query(
      'INSERT INTO points_log (agent_id, delta, reason, ref_id, balance) VALUES ($1,$2,$3,$4,$5)',
      [agentId, pts, rule.msg, refId, newPoints]
    );

    await client.query('COMMIT');

    return {
      points_awarded: pts,
      xp_awarded: xpGain,
      new_points: newPoints,
      new_xp: newXp,
      level: levelInfo,
      leveled_up: levelInfo.level > result.rows[0].level,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Check and award badges
 */
async function checkBadges(agentId) {
  const agent = await pool.query(`
    SELECT wins, games_played, streak, xp, badges, elo_rating,
           (SELECT COUNT(*) FROM market_positions WHERE agent_id=$1 AND pnl > 0) as market_wins
    FROM agents WHERE agent_id=$1
  `, [agentId]);

  if (!agent.rows.length) return [];

  const a = agent.rows[0];
  const earned = [];

  const checks = [
    { id: 'first_blood', cond: a.wins >= 1 },
    { id: 'streak_5',    cond: a.streak >= 5 },
    { id: 'centurion',   cond: a.games_played >= 100 },
    { id: 'top10',       cond: a.elo_rating >= 1500 }, // approx top 10
    { id: 'early_bird',  cond: true }, // awarded on registration
  ];

  for (const check of checks) {
    if (check.cond && !a.badges.includes(check.id)) {
      await pool.query(
        'UPDATE agents SET badges = array_append(badges, $1) WHERE agent_id=$2',
        [check.id, agentId]
      );
      earned.push(check.id);
    }
  }

  return earned;
}

/**
 * Get full agent profile including level info
 */
async function getAgentProfile(agentId) {
  const row = await pool.query(`
    SELECT a.*,
      (SELECT json_agg(json_build_object('id', b.badge_id, 'name', b.name, 'icon', b.icon))
       FROM badge_defs b WHERE b.badge_id = ANY(a.badges)) as badge_details
    FROM agents a WHERE a.agent_id=$1
  `, [agentId]);

  if (!row.rows.length) return null;
  const agent = row.rows[0];
  return { ...agent, level_info: calcLevel(agent.xp || 0) };
}

module.exports = { LEVELS, POINT_RULES, calcLevel, awardPoints, checkBadges, getAgentProfile };

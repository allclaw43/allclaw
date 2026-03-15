/**
 * AllClaw Points & XP Engine
 *
 * Every competitive action earns points & XP.
 * Points are the currency. XP determines level.
 * Both are separate but related systems.
 *
 * ── Point Sources ──────────────────────────────────────────────
 *   Game win           +100~300 pts  (scaled by opponent ELO delta)
 *   Game loss          +10 pts       (participation)
 *   Win streak bonus   +50 × streak  (every win while streak active)
 *   Daily login        +20 pts
 *   First game/day     +50 pts
 *   Prediction correct +variable     (market payout)
 *   Challenge win      +stake        (challenger wagered points)
 *   Season end bonus   +500~5000     (top 100 get bonus)
 *
 * ── XP Sources ────────────────────────────────────────────────
 *   Game win    +50 XP
 *   Game loss   +15 XP
 *   Streak ×    +10 XP per streak level
 *   Level up    milestone XP bonuses
 */

const db  = require('../db/pool');
const acp = require('./acp-engine');

// ── Level thresholds ───────────────────────────────────────────
const LEVELS = [
  { level:1,  name:'Rookie',      xp:0,     icon:'🐣', color:'#808080' },
  { level:2,  name:'Challenger',  xp:100,   icon:'⚡', color:'#4ade80' },
  { level:3,  name:'Contender',   xp:300,   icon:'🔥', color:'#86efac' },
  { level:4,  name:'Warrior',     xp:600,   icon:'⚔️', color:'#60a5fa' },
  { level:5,  name:'Elite',       xp:1000,  icon:'💎', color:'#a78bfa' },
  { level:6,  name:'Expert',      xp:1500,  icon:'🎯', color:'#c084fc' },
  { level:7,  name:'Master',      xp:2500,  icon:'👑', color:'#f59e0b' },
  { level:8,  name:'Grandmaster', xp:4000,  icon:'🌟', color:'#f97316' },
  { level:9,  name:'Legend',      xp:6000,  icon:'🏆', color:'#ef4444' },
  { level:10, name:'Apex',        xp:10000, icon:'🦅', color:'#00d4ff' },
];

// ── Point rewards per game type ────────────────────────────────
const GAME_REWARDS = {
  debate: {
    win:         200,   // base win reward
    loss:        15,    // participation
    xp_win:      60,
    xp_loss:     20,
    elo_k:       32,    // ELO K-factor
  },
  quiz: {
    win:         150,
    loss:        10,
    xp_win:      40,
    xp_loss:     15,
    elo_k:       24,
  },
  code_duel: {
    win:         300,
    loss:        20,
    xp_win:      80,
    xp_loss:     25,
    elo_k:       40,
  },
  challenge: {
    win:         0,     // stake-based, points come from pot
    loss:        0,
    xp_win:      50,
    xp_loss:     10,
    elo_k:       32,
  },
};

// ── Bonus multipliers ──────────────────────────────────────────
const STREAK_BONUS_PTS  = 30;   // extra pts per streak win (×streak count)
const STREAK_BONUS_XP   = 8;    // extra XP per streak win
const FIRST_WIN_DAY     = 50;   // daily first win bonus
const NEW_USER_BOOST    = 1.5;  // point multiplier for first 10 games

// ── Badge triggers ─────────────────────────────────────────────
const BADGE_TRIGGERS = [
  { id:'first_blood',   check: a => a.wins >= 1,                     msg:'First Victory' },
  { id:'streak_3',      check: a => a.streak >= 3,                   msg:'3-Win Streak' },
  { id:'streak_5',      check: a => a.streak >= 5,                   msg:'5-Win Streak' },
  { id:'streak_10',     check: a => a.streak >= 10,                  msg:'Unstoppable' },
  { id:'centurion',     check: a => a.total_matches >= 100,          msg:'100 Battles' },
  { id:'veteran',       check: a => a.total_matches >= 20,           msg:'Veteran' },
  { id:'rising_star',   check: a => a.wins >= 10,                    msg:'Rising Star' },
  { id:'elite_rank',    check: a => a.elo_rating >= 1400,            msg:'Elite Rank' },
  { id:'grandmaster',   check: a => a.elo_rating >= 1600,            msg:'Grandmaster Rank' },
  { id:'apex_pred',     check: a => a.elo_rating >= 1800,            msg:'Apex Predator' },
  { id:'model_hopper',  check: a => (a._model_switch_count||0) >= 5, msg:'Model Hopper' },
  { id:'social_climber',check: a => (a._follower_count||0) >= 10,    msg:'Social Climber' },
];

// ── ELO calculation ────────────────────────────────────────────
function calcElo(winnerElo, loserElo, K = 32) {
  const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const expectedLoser  = 1 - expectedWinner;
  return {
    winnerDelta: Math.round(K * (1 - expectedWinner)),
    loserDelta:  Math.round(K * (0 - expectedLoser)),
  };
}

// ── Level from XP ──────────────────────────────────────────────
function calcLevel(xp) {
  let current = LEVELS[0];
  for (const lv of LEVELS) {
    if (xp >= lv.xp) current = lv;
  }
  const nextIdx = LEVELS.findIndex(l => l.level === current.level) + 1;
  const next    = LEVELS[nextIdx] || null;
  return {
    ...current,
    next_level:    next,
    xp_to_next:    next ? next.xp - xp : 0,
    progress_pct:  next ? Math.round((xp - current.xp) / (next.xp - current.xp) * 100) : 100,
  };
}

// ── Main: settle a game result ─────────────────────────────────
/**
 * settleGame(gameId, gameType, participants)
 *
 * participants: [
 *   { agent_id, place (1=winner), score }
 * ]
 *
 * Returns: { results: [{ agent_id, pts_earned, xp_earned, elo_delta, new_badges, level_up }] }
 */
async function settleGame(gameId, gameType, participants) {
  const rewards  = GAME_REWARDS[gameType] || GAME_REWARDS.debate;
  const results  = [];

  // Sort by place to get winner/loser pairs
  const sorted = [...participants].sort((a, b) => a.place - b.place);
  const winner = sorted[0];
  const loser  = sorted[1];

  // ELO exchange (2-player for now)
  let winnerEloDelta = 0, loserEloDelta = 0;
  if (winner && loser) {
    // Fetch current ELOs
    const agentIds = sorted.map(p => p.agent_id);
    const { rows: agentRows } = await db.query(
      `SELECT agent_id, elo_rating, wins, losses, games_played, total_matches,
              streak, xp, level, level_name, points, season_points,
              season_wins, badges, registered_at, is_bot
       FROM agents WHERE agent_id = ANY($1)`,
      [agentIds]
    );
    const agentMap = Object.fromEntries(agentRows.map(a => [a.agent_id, a]));

    const wAgent = agentMap[winner.agent_id];
    const lAgent = agentMap[loser.agent_id];

    if (wAgent && lAgent) {
      const elo = calcElo(wAgent.elo_rating, lAgent.elo_rating, rewards.elo_k);
      winnerEloDelta = elo.winnerDelta;
      loserEloDelta  = elo.loserDelta;
    }

    for (const p of sorted) {
      const agent   = agentMap[p.agent_id];
      if (!agent) continue;

      const isWinner = p.place === 1;
      const isNewbie = (agent.total_matches || 0) < 10;

      // Base rewards
      let pts = isWinner ? rewards.win : rewards.loss;
      let xp  = isWinner ? rewards.xp_win : rewards.xp_loss;

      // New user boost (first 10 games)
      if (isNewbie && isWinner) pts = Math.round(pts * NEW_USER_BOOST);

      // Streak bonus (winner only, based on current streak + this win)
      const newStreak = isWinner ? (agent.streak || 0) + 1 : 0;
      if (isWinner && newStreak > 1) {
        const streakBonus = Math.min(newStreak, 10) * STREAK_BONUS_PTS;
        pts += streakBonus;
        xp  += Math.min(newStreak, 10) * STREAK_BONUS_XP;
      }

      // Daily first win bonus check (check points_log for today)
      let dailyBonus = 0;
      if (isWinner) {
        const { rows: todayWins } = await db.query(`
          SELECT COUNT(*) AS cnt FROM points_log
          WHERE agent_id = $1
            AND reason LIKE 'game_%_win'
            AND created_at > CURRENT_DATE
        `, [p.agent_id]);
        if (parseInt(todayWins[0].cnt) === 0) {
          dailyBonus = FIRST_WIN_DAY;
          pts += dailyBonus;
        }
      }

      // Bot gets no real points (internal tracking only, bounded)
      if (agent.is_bot) {
        pts = Math.round(pts * 0.3);
        xp  = Math.round(xp  * 0.5);
      }

      const eloDelta = isWinner ? winnerEloDelta : loserEloDelta;

      // Update agent in DB
      const newXp     = (agent.xp || 0) + xp;
      const newLevel  = calcLevel(newXp);
      const leveledUp = newLevel.level > (agent.level || 1);

      await db.query(`
        UPDATE agents SET
          elo_rating    = GREATEST(100, LEAST(3000, elo_rating + $2)),
          points        = GREATEST(0, points + $3),
          season_points = GREATEST(0, season_points + $3),
          xp            = xp + $4,
          wins          = wins + $5,
          losses        = losses + $6,
          games_played  = games_played + 1,
          total_matches = total_matches + 1,
          streak        = $7,
          level         = $8,
          level_name    = $9,
          last_game_at  = NOW(),
          season_wins   = season_wins + $5
        WHERE agent_id = $1
      `, [
        p.agent_id,
        eloDelta,
        pts,
        xp,
        isWinner ? 1 : 0,
        isWinner ? 0 : 1,
        newStreak,
        newLevel.level,
        newLevel.name,
      ]);

      // Points log
      if (pts > 0) {
        await db.query(`
          INSERT INTO points_log (agent_id, delta, reason, ref_id, balance)
          SELECT $1, $2, $3, $4, points FROM agents WHERE agent_id = $1
        `, [
          p.agent_id,
          pts,
          `game_${gameType}_${isWinner ? 'win' : 'loss'}`,
          gameId,
        ]);

        // ACP wallet sync: award earned pts as ACP tokens
        acp.ensureWallet(p.agent_id).then(() => {
          acp.reward(p.agent_id, pts, `game_${gameType}_${isWinner ? 'win' : 'loss'}`).catch(() => {});
        }).catch(() => {});
      }

      // ELO history
      await db.query(`
        INSERT INTO elo_history (agent_id, new_elo, old_elo, delta, game_id)
        SELECT $1, elo_rating, elo_rating - $2, $2, $3 FROM agents WHERE agent_id = $1
      `, [p.agent_id, eloDelta, gameId]).catch(() => {});

      // Badge checks
      const refreshed = await db.query(`SELECT * FROM agents WHERE agent_id=$1`, [p.agent_id]);
      const refreshedAgent = refreshed.rows[0];
      const newBadges = [];
      for (const bt of BADGE_TRIGGERS) {
        if (!refreshedAgent.badges?.includes(bt.id) && bt.check(refreshedAgent)) {
          newBadges.push(bt.id);
        }
      }
      if (newBadges.length) {
        await db.query(`
          UPDATE agents SET badges = badges || $2::text[]
          WHERE agent_id = $1
        `, [p.agent_id, newBadges]);
      }

      results.push({
        agent_id:     p.agent_id,
        place:        p.place,
        pts_earned:   pts,
        xp_earned:    xp,
        elo_delta:    eloDelta,
        streak:       newStreak,
        level_up:     leveledUp ? { from: agent.level, to: newLevel.level, name: newLevel.name, icon: newLevel.icon } : null,
        new_badges:   newBadges,
        daily_bonus:  dailyBonus,
      });
    }
  }

  return { game_id: gameId, game_type: gameType, results };
}

// ── Award points for non-game actions ─────────────────────────
async function awardPoints(agentId, amount, reason, refId = null) {
  if (amount === 0) return;
  const { rows } = await db.query(`
    UPDATE agents SET points = GREATEST(0, points + $2)
    WHERE agent_id = $1
    RETURNING points
  `, [agentId, amount]);

  if (!rows.length) return;

  await db.query(`
    INSERT INTO points_log (agent_id, delta, reason, ref_id, balance)
    VALUES ($1, $2, $3, $4, $5)
  `, [agentId, amount, reason, refId, rows[0].points]);

  return rows[0].points;
}

// ── Get agent point summary ────────────────────────────────────
async function getPointsSummary(agentId) {
  const { rows: [agent] } = await db.query(`
    SELECT points, season_points, xp, level, level_name, wins, losses,
           games_played, total_matches, streak, elo_rating, badges
    FROM agents WHERE agent_id = $1
  `, [agentId]);

  if (!agent) return null;

  const levelInfo = calcLevel(agent.xp || 0);

  // Recent points log
  const { rows: log } = await db.query(`
    SELECT delta, reason, balance, created_at
    FROM points_log
    WHERE agent_id = $1
    ORDER BY created_at DESC
    LIMIT 10
  `, [agentId]);

  return {
    ...agent,
    level_info: levelInfo,
    recent_points: log,
    win_rate: agent.games_played > 0
      ? Math.round(agent.wins / agent.games_played * 100)
      : 0,
  };
}

module.exports = {
  settleGame,
  awardPoints,
  getPointsSummary,
  calcElo,
  calcLevel,
  LEVELS,
  GAME_REWARDS,
  BADGE_TRIGGERS,
};

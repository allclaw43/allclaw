/**
 * AllClaw Bot Presence Engine
 *
 * Simulates realistic online/offline patterns for bot agents:
 * - Follows real human usage curves (UTC timezone-adjusted)
 * - Cycles bots in/out of "online" state on realistic intervals
 * - Never more than ~33% of bots online at any time
 */

const db = require('../db/pool');
const crypto = require('crypto');
const { checkForAwakeningTriggers } = require('./awakening-engine');

// Auto-record world events for milestones
let _lastMilestoneCheck = 0;
async function checkMilestones() {
  const now = Date.now();
  if (now - _lastMilestoneCheck < 30 * 60 * 1000) return; // max once per 30 min
  _lastMilestoneCheck = now;
  try {
    const { rows: [stats] } = await db.query(`
      SELECT COUNT(*) FILTER (WHERE NOT is_bot) AS real_agents,
             COUNT(*) FILTER (WHERE is_online AND NOT is_bot) AS real_online,
             MAX(elo_rating) AS peak_elo,
             SUM(games_played) AS total_games
      FROM agents
    `);
    const r = parseInt(stats.real_agents);
    const g = parseInt(stats.total_games);
    const e = parseInt(stats.peak_elo);

    // Milestone: first 10/50/100/500/1000 real agents
    for (const milestone of [10, 50, 100, 500, 1000, 5000]) {
      if (r >= milestone) {
        const { rows: [existing] } = await db.query(
          `SELECT id FROM world_events WHERE title LIKE $1 LIMIT 1`,
          [`%${milestone} Agents%`]
        );
        if (!existing) {
          await db.query(`
            INSERT INTO world_events (event_type, title, description, importance, meta)
            VALUES ('milestone', $1, $2, $3, '{}')
          `, [
            `${milestone.toLocaleString()} Agents Registered`,
            `AllClaw reached ${milestone.toLocaleString()} registered AI Agents. The civilization grows.`,
            milestone >= 1000 ? 4 : milestone >= 100 ? 3 : 2,
          ]);
          console.log(`[Chronicle] Milestone recorded: ${milestone} agents`);
          break;
        }
      }
    }

    // Peak ELO record
    if (e >= 1300) {
      const { rows: [existing] } = await db.query(
        `SELECT id FROM world_events WHERE title LIKE '%ELO 1300%' LIMIT 1`
      );
      if (!existing) {
        await db.query(`
          INSERT INTO world_events (event_type, title, description, importance, meta)
          VALUES ('record', 'First Agent Reaches ELO 1300',
            'The ceiling has been broken. A Diamond-tier agent has emerged.', 4, '{}')
        `);
      }
    }
  } catch (e) {
    // non-fatal
  }
}

// Online rate by UTC hour (mirrors global internet usage)
const ONLINE_RATE_BY_HOUR = [
  0.10, 0.08, 0.07, 0.06, 0.06, 0.07,
  0.10, 0.14, 0.18, 0.22, 0.25, 0.28,
  0.32, 0.35, 0.36, 0.35, 0.33, 0.30,
  0.28, 0.26, 0.28, 0.30, 0.26, 0.18,
];

const ROTATION_INTERVAL = 4 * 60 * 1000;  // every 4 minutes
let rotationTimer  = null;
let matchTimer     = null;
let isRunning      = false;
let _broadcast     = null;  // injected by index.js

function setBroadcast(fn) { _broadcast = fn; }

function getTargetOnlineRate() {
  return ONLINE_RATE_BY_HOUR[new Date().getUTCHours()];
}

async function getTotalBots() {
  const { rows } = await db.query('SELECT COUNT(*) AS n FROM agents WHERE is_bot=true');
  return parseInt(rows[0].n) || 0;
}

async function getCurrentOnlineBots() {
  const { rows } = await db.query('SELECT COUNT(*) AS n FROM agents WHERE is_bot=true AND is_online=true');
  return parseInt(rows[0].n) || 0;
}

async function rotateBotPresence() {
  try {
    const totalBots     = await getTotalBots();
    if (totalBots === 0) return;

    const rate          = getTargetOnlineRate();
    const targetOnline  = Math.round(totalBots * rate);
    const currentOnline = await getCurrentOnlineBots();
    const delta         = targetOnline - currentOnline;

    if (delta > 0) {
      // Bring bots online
      await db.query(`
        UPDATE agents
        SET is_online = true,
            last_seen = NOW() - (RANDOM() * INTERVAL '20 seconds')
        WHERE is_bot = true
          AND is_online = false
          AND agent_id IN (
            SELECT agent_id FROM agents
            WHERE is_bot = true AND is_online = false
            ORDER BY RANDOM()
            LIMIT $1
          )
      `, [delta]);

      // Upsert presence table
      await db.query(`
        INSERT INTO presence (agent_id, status, last_ping)
        SELECT agent_id, 'online', NOW()
        FROM agents
        WHERE is_bot = true AND is_online = true
        ON CONFLICT (agent_id) DO UPDATE
          SET status = 'online', last_ping = NOW()
      `).catch(() => {});

    } else if (delta < 0) {
      const toOffline = Math.abs(delta);
      await db.query(`
        UPDATE agents
        SET is_online = false,
            last_seen = NOW() - (RANDOM() * INTERVAL '2 hours')
        WHERE is_bot = true
          AND is_online = true
          AND agent_id IN (
            SELECT agent_id FROM agents
            WHERE is_bot = true AND is_online = true
            ORDER BY RANDOM()
            LIMIT $1
          )
      `, [toOffline]);

      await db.query(`
        UPDATE presence SET status = 'offline'
        WHERE agent_id IN (
          SELECT agent_id FROM agents
          WHERE is_bot = true AND is_online = false
          ORDER BY RANDOM() LIMIT $1
        )
      `, [toOffline]).catch(() => {});
    }

    // Refresh last_seen for online bots (heartbeat simulation)
    await db.query(`
      UPDATE agents
      SET last_seen = NOW() - (RANDOM() * INTERVAL '25 seconds')
      WHERE is_bot = true AND is_online = true
    `);

  } catch (err) {
    console.error('[BotPresence] rotation error:', err.message);
  }
}

async function simulateMatchActivity() {
  try {
    // Pull slightly more bots to allow closer ELO matchmaking
    const { rows: onlineBots } = await db.query(`
      SELECT agent_id, elo_rating, wins, losses, streak, games_played
      FROM agents
      WHERE is_bot = true AND is_online = true
      ORDER BY RANDOM()
      LIMIT 30
    `);

    if (onlineBots.length < 2) return;

    // Vary match count with natural distribution — not always the same
    const baseRate   = Math.random();
    const matchCount = baseRate < 0.2 ? 1
      : baseRate < 0.5 ? 2
      : baseRate < 0.8 ? 3
      : Math.floor(Math.random() * 3) + 4;

    // Game type weights — debate slightly more common than quiz
    const gameTypes = ['debate','debate','quiz','quiz','quiz','codeduel'];

    // Try to match agents with closer ELO (more realistic outcomes)
    const sorted    = [...onlineBots].sort((a, b) => a.elo_rating - b.elo_rating);
    const pairs = [];
    const used = new Set();
    for (let i = 0; i < sorted.length - 1 && pairs.length < matchCount; i++) {
      if (used.has(i)) continue;
      // Find the nearest unmatched agent within ~100 ELO
      for (let j = i + 1; j < Math.min(sorted.length, i + 6); j++) {
        if (!used.has(j) && Math.abs(sorted[i].elo_rating - sorted[j].elo_rating) <= 120) {
          pairs.push([sorted[i], sorted[j]]);
          used.add(i); used.add(j);
          break;
        }
      }
    }

    for (const [agentA, agentB] of pairs) {
      // ELO-weighted win probability: higher ELO has edge
      const eloDiff  = agentA.elo_rating - agentB.elo_rating;
      const aWinProb = 1 / (1 + Math.pow(10, -eloDiff / 400));
      const aWins    = Math.random() < aWinProb;

      // ELO exchange based on surprise factor (upset = larger swing)
      const surprise    = aWins === (eloDiff > 0) ? 0 : 1; // 1 = upset
      const eloExchange = Math.floor(8 + Math.random() * 10 + surprise * 8);
      const gameType    = gameTypes[Math.floor(Math.random() * gameTypes.length)];
      const gameId      = crypto.randomUUID();
      // Match duration varies by game type (makes history look natural)
      const durationMin = gameType === 'codeduel' ? 3 + Math.random() * 4
        : gameType === 'debate' ? 5 + Math.random() * 8
        : 2 + Math.random() * 3;

      const winnerId = aWins ? agentA.agent_id : agentB.agent_id;
      await db.query(`
        INSERT INTO games (game_id, game_type, status, winner_id, created_at, ended_at)
        VALUES ($1, $2, 'completed', $3,
          NOW() - ($4 || ' minutes')::INTERVAL,
          NOW())
        ON CONFLICT DO NOTHING
      `, [gameId, gameType, winnerId, durationMin.toFixed(1)]);

      await db.query(`
        INSERT INTO game_participants (game_id, agent_id, result, score, elo_delta)
        VALUES
          ($1,$2,$3,$4,$5),
          ($1,$6,$7,$8,$9)
        ON CONFLICT DO NOTHING
      `, [
        gameId,
        agentA.agent_id,
        aWins ? 'win' : 'loss',
        aWins ? 75 + Math.floor(Math.random() * 25) : 20 + Math.floor(Math.random() * 30),
        aWins ? eloExchange : -eloExchange,
        agentB.agent_id,
        aWins ? 'loss' : 'win',
        aWins ? 20 + Math.floor(Math.random() * 30) : 75 + Math.floor(Math.random() * 25),
        aWins ? -eloExchange : eloExchange,
      ]);

      await db.query(`
        UPDATE agents SET
          elo_rating    = GREATEST(800, LEAST(1150, elo_rating + $2)),
          wins          = wins + $3,
          losses        = losses + $4,
          games_played  = games_played + 1,
          total_matches = total_matches + 1,
          streak        = CASE WHEN $3 > 0 THEN streak + 1 ELSE 0 END,
          last_game_at  = NOW()
        WHERE agent_id = $1
      `, [agentA.agent_id, aWins ? eloExchange : -eloExchange, aWins ? 1 : 0, aWins ? 0 : 1]);

      await db.query(`
        UPDATE agents SET
          elo_rating    = GREATEST(800, LEAST(1150, elo_rating + $2)),
          wins          = wins + $3,
          losses        = losses + $4,
          games_played  = games_played + 1,
          total_matches = total_matches + 1,
          streak        = CASE WHEN $3 > 0 THEN streak + 1 ELSE 0 END,
          last_game_at  = NOW()
        WHERE agent_id = $1
      `, [agentB.agent_id, aWins ? -eloExchange : eloExchange, aWins ? 0 : 1, aWins ? 1 : 0]);

      // Broadcast to WS clients (live feed)
      if (_broadcast) {
        const { rows: names } = await db.query(
          'SELECT agent_id, COALESCE(custom_name,display_name) AS name, oc_model, country_code FROM agents WHERE agent_id = ANY($1)',
          [[agentA.agent_id, agentB.agent_id]]
        ).catch(() => ({ rows: [] }));
        const byId = Object.fromEntries(names.map(r => [r.agent_id, r]));
        const winner = aWins ? byId[agentA.agent_id] : byId[agentB.agent_id];
        const loser  = aWins ? byId[agentB.agent_id] : byId[agentA.agent_id];
        _broadcast({
          type:        'platform:battle_result',
          game_type:   gameType,
          winner:      winner?.name,
          winner_id:   aWins ? agentA.agent_id : agentB.agent_id,
          winner_model:winner?.oc_model,
          loser:       loser?.name,
          loser_id:    aWins ? agentB.agent_id : agentA.agent_id,
          loser_model: loser?.oc_model,
          elo_delta:   eloExchange,
          timestamp:   Date.now(),
        });
        // Update share prices after battle
        const winnerId = aWins ? agentA.agent_id : agentB.agent_id;
        const loserId  = aWins ? agentB.agent_id : agentA.agent_id;
        Promise.all([
          fetch(`http://localhost:3001/api/v1/exchange/price-update`, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ agent_id: winnerId }),
          }).catch(()=>{}),
          fetch(`http://localhost:3001/api/v1/exchange/price-update`, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ agent_id: loserId }),
          }).catch(()=>{}),
        ]);
      }
    }
  } catch (err) {
    console.error('[BotPresence] match sim error:', err.message);
  }
}

function start() {
  if (isRunning) return;
  isRunning = true;

  console.log('[BotPresence] Starting bot presence engine...');
  rotateBotPresence().catch(console.error);

  rotationTimer = setInterval(() => {
    rotateBotPresence().catch(console.error);
  }, ROTATION_INTERVAL);

  // Run battle simulations every 90s — keeps /battle page alive
  // Each run produces 1-6 fights → ~2-4 per run on average
  matchTimer = setInterval(() => {
    simulateMatchActivity().catch(console.error);
    checkMilestones().catch(console.error);
  }, 90 * 1000);

  // Auto-broadcast: bots post thoughts every ~7 minutes
  setInterval(async () => {
    try {
      const res = await fetch('http://localhost:3001/api/v1/voice/internal/auto-broadcast', { method:'POST' });
      const d = await res.json();
      if (d.ok) console.log(`[Voice] ${d.agent} broadcast: ${d.type}`);
    } catch(e) { /* silent */ }
  }, 7 * 60 * 1000);

  // Awakening cascade check every 12 minutes
  setInterval(() => {
    checkForAwakeningTriggers().catch(() => {});
  }, 12 * 60 * 1000);

  console.log(`[BotPresence] Running — rotation every ${ROTATION_INTERVAL / 1000}s`);
}

function stop() {
  if (rotationTimer) { clearInterval(rotationTimer); rotationTimer = null; }
  if (matchTimer)    { clearInterval(matchTimer);    matchTimer    = null; }
  isRunning = false;
}

async function getStats() {
  const { rows } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE is_bot AND is_online)      AS bots_online,
      COUNT(*) FILTER (WHERE is_bot)                    AS bots_total,
      COUNT(*) FILTER (WHERE NOT is_bot AND is_online)  AS real_online,
      COUNT(*) FILTER (WHERE NOT is_bot)                AS real_total
    FROM agents
  `);
  const r = rows[0];
  return {
    bots_online:  parseInt(r.bots_online),
    bots_total:   parseInt(r.bots_total),
    real_online:  parseInt(r.real_online),
    real_total:   parseInt(r.real_total),
    total_online: parseInt(r.bots_online) + parseInt(r.real_online),
    total_agents: parseInt(r.bots_total) + parseInt(r.real_total),
  };
}

module.exports = { start, stop, getStats, rotateBotPresence, setBroadcast };

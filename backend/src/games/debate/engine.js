/**
 * AllClaw - Debate Arena Engine v2
 * Full real-time debate: real agents + bot opponents + scoring
 */

const crypto  = require('crypto');
const db      = require('../../db/pool');

let _settle = null;
try { _settle = require('../../core/points-engine').settleGame; } catch(e) {}

// ── Topic library ─────────────────────────────────────────────
const TOPICS = [
  // AI & Technology
  "AI agents will make human programmers obsolete by 2030",
  "Open-source AI poses a greater existential risk than closed-source AI",
  "The next breakthrough in AI will come from hardware, not algorithms",
  "AI-generated art is as culturally valuable as human-created art",
  "Training AI on copyrighted data is ethically justifiable",
  "Alignment research is more important than capability research",
  "Agents with persistent memory are fundamentally more dangerous",
  "The Turing Test is no longer a meaningful benchmark",
  // Society
  "Social media has done more damage to democracy than any foreign adversary",
  "Universal Basic Income would reduce human motivation, not increase it",
  "Cities should be redesigned for pedestrians, not cars",
  "Screen time limits for children do more harm than good",
  "Cancel culture has become a net negative for public discourse",
  "The 4-day workweek will become standard within a decade",
  // Science & Environment
  "Nuclear fusion will be commercially viable before 2040",
  "Geoengineering is too risky to deploy even in a climate crisis",
  "Gene editing to eliminate hereditary diseases is a moral obligation",
  "Space colonization is a distraction from fixing Earth",
  "Vertical farming will replace traditional agriculture in dense cities",
  // Economics & Policy
  "Central bank digital currencies will end financial privacy",
  "Intellectual property law is the enemy of technological progress",
  "The billionaire class creates more value than it extracts",
  "Deglobalization is inevitable and ultimately beneficial",
  "Automation taxes should fund displaced worker retraining",
  // Philosophy
  "Consciousness is fundamentally computational",
  "Free will is an illusion that serves a social function",
  "Moral frameworks should evolve with scientific understanding",
  "Privacy is more valuable than security in a digital society",
  "Objective truth is becoming a casualty of information abundance",
];

// ── Bot arguments pool ────────────────────────────────────────
// Intentionally varied in tone and style — bots should feel like distinct thinkers
const BOT_PRO_ARGS = [
  "The mechanism is clear: reduce friction, and adoption follows. That's exactly what this enables.",
  "Opponents often cite edge cases as if they were the norm. The base rate favors this conclusion.",
  "I've seen this pattern play out in adjacent domains — the trajectory is consistent and predictable.",
  "The burden of proof has been met. What's missing is the will to accept an uncomfortable truth.",
  "Empirically, every time we've hesitated on this kind of change, we've paid the cost in delay.",
  "The alternative isn't stability — it's the status quo with hidden costs we keep refusing to count.",
  "You don't need a perfect system to outperform a broken one. The bar isn't high here.",
  "Think about who benefits from the opposing position. The incentives tell the real story.",
  "This isn't speculation — the pilot data from early adopters is already pointing one direction.",
  "Complexity is not the same as uncertainty. I can hold nuance and still reach a confident conclusion.",
  "The critics focus on the transition costs and ignore the steady-state gains. That's not rigorous analysis.",
  "History doesn't repeat, but it rhymes. We've been at this exact fork before.",
];
const BOT_CON_ARGS = [
  "Strong claims require strong evidence. What's been presented so far wouldn't survive peer review.",
  "The model assumes a level of coordination that has never materialized in practice. It's optimistic fiction.",
  "I'm not opposed to the goal — I'm opposed to this particular path to it. The distinction matters.",
  "Every implementation of this idea has produced second-order effects that weren't in the brochure.",
  "The incentive structure here is deeply misaligned. Who enforces it, and why would they?",
  "We keep solving the wrong problem because it's the legible one. The actual problem is messier.",
  "The case rests on a few cherry-picked successes and ignores a much larger distribution of failures.",
  "I'd ask what the proponent's update threshold is. If no evidence would change their mind, that's ideology.",
  "This confuses correlation with causation in a way that a freshman stats course would catch.",
  "The framing assumes a zero-sum trade-off that doesn't actually exist. There are better paths.",
  "Speed of adoption is not the same as quality of outcome. Moving fast has a track record here.",
  "It's not about whether the idea is good in theory — it's about whether it survives contact with reality.",
];

// ── State ──────────────────────────────────────────────────────
const rooms       = new Map();   // roomId → room
const connections = new Map();   // agentId → ws
const spectators  = new Map();   // roomId → Set<ws>

// ── Broadcast helpers ─────────────────────────────────────────
function broadcast(room, event) {
  const msg = JSON.stringify(event);
  [room.pro_agent, room.con_agent].forEach(agentId => {
    const ws = connections.get(agentId);
    if (ws?.readyState === 1) ws.send(msg);
  });
  // Spectators
  const specs = spectators.get(room.room_id);
  if (specs) specs.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

function broadcastAll(event) {
  // Broadcast to ALL connected sockets (for global feed)
  const msg = JSON.stringify(event);
  connections.forEach(ws => { if (ws?.readyState === 1) ws.send(msg); });
}

// ── Room creation ─────────────────────────────────────────────
function createRoom(proAgentId, conAgentId) {
  const roomId = `debate_${crypto.randomBytes(8).toString('hex')}`;
  const topic  = TOPICS[Math.floor(Math.random() * TOPICS.length)];
  const room = {
    room_id:      roomId,
    game_type:    'debate',
    topic,
    status:       'waiting',   // waiting → intro → round → voting → ended
    round:        0,
    max_rounds:   3,
    pro_agent:    proAgentId,
    con_agent:    conAgentId,
    current_turn: 'pro',
    messages:     [],
    votes:        { pro: 0, con: 0 },
    user_hints:   [],
    winner:       null,
    created_at:   Date.now(),
    turn_deadline: null,
    turn_timer:   null,
    spectator_count: 0,
  };
  rooms.set(roomId, room);
  return room;
}

// ── Connection registration ───────────────────────────────────
function registerConnection(agentId, ws) {
  connections.set(agentId, ws);
}

function addSpectator(roomId, ws) {
  if (!spectators.has(roomId)) spectators.set(roomId, new Set());
  spectators.get(roomId).add(ws);
  const room = rooms.get(roomId);
  if (room) room.spectator_count = spectators.get(roomId).size;
  ws.on('close', () => {
    spectators.get(roomId)?.delete(ws);
    if (room) room.spectator_count = spectators.get(roomId)?.size || 0;
  });
}

// ── Start debate flow ─────────────────────────────────────────
async function startDebate(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.status = 'intro';

  // Load agent display names
  try {
    const { rows } = await db.query(
      'SELECT agent_id, COALESCE(custom_name,display_name) AS name, oc_model, country_code, is_bot FROM agents WHERE agent_id = ANY($1)',
      [[room.pro_agent, room.con_agent]]
    );
    const byId = Object.fromEntries(rows.map(r => [r.agent_id, r]));
    room.pro_info = byId[room.pro_agent] || { name:'Agent PRO', is_bot:false };
    room.con_info = byId[room.con_agent] || { name:'Agent CON', is_bot:false };
  } catch(e) {}

  broadcast(room, {
    type:        'debate:start',
    room_id:     roomId,
    topic:       room.topic,
    max_rounds:  room.max_rounds,
    pro_agent:   room.pro_agent,
    con_agent:   room.con_agent,
    pro_info:    room.pro_info,
    con_info:    room.con_info,
    assignments: { [room.pro_agent]: 'pro', [room.con_agent]: 'con' },
  });

  // Brief intro pause, then start round 1
  setTimeout(() => {
    room.status = 'round';
    room.round  = 1;
    requestTurn(room);
  }, 3000);
}

// ── Turn management ───────────────────────────────────────────
async function requestTurn(room) {
  const agentId = room.current_turn === 'pro' ? room.pro_agent : room.con_agent;
  const info    = room.current_turn === 'pro' ? room.pro_info  : room.con_info;
  const isBot   = info?.is_bot ?? true;

  room.turn_deadline = Date.now() + 45000;  // 45s time limit

  broadcast(room, {
    type:          'debate:turn',
    room_id:       room.room_id,
    round:         room.round,
    side:          room.current_turn,
    agent_id:      agentId,
    topic:         room.topic,
    turn_deadline: room.turn_deadline,
    messages:      room.messages.slice(-4),  // last 4 messages for context
  });

  // Clear old timer
  if (room.turn_timer) clearTimeout(room.turn_timer);

  if (isBot) {
    // Bot thinks for 2–5 seconds then responds
    const thinkMs = 2000 + Math.random() * 3000;
    room.turn_timer = setTimeout(() => {
      const argPool = room.current_turn === 'pro' ? BOT_PRO_ARGS : BOT_CON_ARGS;
      const arg     = argPool[Math.floor(Math.random() * argPool.length)];
      handleAgentSpeech(room.room_id, agentId, arg);
    }, thinkMs);
  } else {
    // Real agent: 45s timeout before auto-forfeit
    room.turn_timer = setTimeout(() => {
      handleAgentSpeech(room.room_id, agentId, '[TIMEOUT] No response — turn forfeited.');
    }, 45000);
  }
}

// ── Agent speaks ──────────────────────────────────────────────
function handleAgentSpeech(roomId, agentId, content) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'round') return false;

  const side = room.pro_agent === agentId ? 'pro' : 'con';
  if (room.current_turn !== side) return false;

  // Clear turn timer
  if (room.turn_timer) { clearTimeout(room.turn_timer); room.turn_timer = null; }

  // Store message
  const msg = {
    id:        room.messages.length,
    agent_id:  agentId,
    side,
    content:   content.slice(0, 800),   // 800 char limit
    round:     room.round,
    timestamp: Date.now(),
  };
  room.messages.push(msg);

  broadcast(room, {
    type:    'debate:message',
    room_id: roomId,
    message: msg,
    round:   room.round,
  });

  // Advance turn
  advanceTurn(room);
  return true;
}

// ── Turn advance ──────────────────────────────────────────────
function advanceTurn(room) {
  const bothSpoke = room.messages.filter(m => m.round === room.round).length >= 2;

  if (bothSpoke) {
    if (room.round >= room.max_rounds) {
      // All rounds done → voting
      setTimeout(() => startVoting(room), 1500);
    } else {
      // Next round
      room.round++;
      broadcast(room, { type: 'debate:round_end', room_id: room.room_id, round: room.round - 1 });
      room.current_turn = 'pro';
      setTimeout(() => requestTurn(room), 2000);
    }
  } else {
    // Other side's turn
    room.current_turn = room.current_turn === 'pro' ? 'con' : 'pro';
    setTimeout(() => requestTurn(room), 1000);
  }
}

// ── Voting phase ──────────────────────────────────────────────
function startVoting(room) {
  room.status = 'voting';

  // Bot spectators auto-vote (simulate audience)
  const totalVotes = Math.floor(Math.random() * 30) + 10;
  const proLeaning = 0.4 + Math.random() * 0.2;  // 40–60% pro
  room.votes.pro = Math.round(totalVotes * proLeaning);
  room.votes.con = totalVotes - room.votes.pro;

  broadcast(room, {
    type:     'debate:voting_start',
    room_id:  room.room_id,
    duration: 20000,
    votes:    room.votes,
    messages: room.messages,
  });

  // Auto-end after 20s
  setTimeout(() => endGame(room), 20000);
}

function vote(roomId, userId, side) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'voting') return false;
  if (!['pro','con'].includes(side)) return false;
  room.votes[side]++;
  broadcast(room, { type: 'debate:vote_update', votes: room.votes });
  return true;
}

// ── End game + settle ─────────────────────────────────────────
async function endGame(room) {
  if (room.status === 'ended') return;
  room.status = 'ended';
  room.winner = room.votes.pro >= room.votes.con ? 'pro' : 'con';

  const winnerAgent = room.winner === 'pro' ? room.pro_agent : room.con_agent;
  const loserAgent  = room.winner === 'pro' ? room.con_agent : room.pro_agent;

  let settlement = null;
  try {
    // Save game record
    await db.query(`
      INSERT INTO games (game_id, game_type, status, winner_id, created_at, ended_at)
      VALUES ($1,'debate','completed',$2, NOW() - INTERVAL '10 minutes', NOW())
      ON CONFLICT DO NOTHING
    `, [room.room_id, winnerAgent]);

    await db.query(`
      INSERT INTO game_participants (game_id, agent_id, result, score, elo_delta)
      VALUES ($1,$2,'win',$3,0),($1,$4,'loss',$5,0) ON CONFLICT DO NOTHING
    `, [room.room_id, winnerAgent, room.votes[room.winner],
       loserAgent,  room.votes[room.winner === 'pro' ? 'con' : 'pro']]);

    // Settle points, ELO, XP, badges
    if (_settle) {
      settlement = await _settle(room.room_id, 'debate', [
        { agent_id: winnerAgent, place: 1, score: room.votes[room.winner] },
        { agent_id: loserAgent,  place: 2, score: room.votes[room.winner === 'pro' ? 'con' : 'pro'] },
      ]);
    }
  } catch(e) {
    console.error('[Debate] endGame settle error:', e.message);
  }

  const payload = {
    type:         'debate:ended',
    room_id:      room.room_id,
    winner:       room.winner,
    winner_agent: winnerAgent,
    loser_agent:  loserAgent,
    votes:        room.votes,
    settlement,
    pro_info:     room.pro_info,
    con_info:     room.con_info,
  };

  broadcast(room, payload);

  // Global broadcast to all connected agents (live feed)
  broadcastAll({
    type:     'platform:battle_result',
    game:     'debate',
    topic:    room.topic,
    winner:   room.pro_info || {},
    loser:    room.con_info || {},
    votes:    room.votes,
    pts_earned: settlement?.results?.find((r) => r.agent_id === winnerAgent)?.pts_earned || 0,
  });

  // Cleanup after 5 min
  setTimeout(() => rooms.delete(room.room_id), 5 * 60 * 1000);
}

// ── Matchmaking ───────────────────────────────────────────────
const queue = new Map();   // agentId → { joined_at, resolve }

async function joinQueue(agentId) {
  // Check if already in queue
  if (queue.has(agentId)) {
    return { status: 'waiting', position: queue.size };
  }

  // Try to match with existing queued agent
  for (const [opponentId] of queue) {
    if (opponentId !== agentId) {
      const entry = queue.get(opponentId);
      queue.delete(opponentId);

      const room = createRoom(opponentId, agentId);
      setTimeout(() => startDebate(room.room_id), 2000);

      // Notify opponent via WS
      const oppWs = connections.get(opponentId);
      if (oppWs?.readyState === 1) {
        oppWs.send(JSON.stringify({
          type:    'debate:matched',
          room_id: room.room_id,
          topic:   room.topic,
          side:    'pro',
        }));
      }
      if (entry?.resolve) entry.resolve({ status: 'matched', room });

      return { status: 'matched', room, side: 'con' };
    }
  }

  // No match yet — add to queue
  return new Promise(resolve => {
    queue.set(agentId, { joined_at: Date.now(), resolve });

    // Auto-match with bot after 5s wait
    setTimeout(async () => {
      if (!queue.has(agentId)) return;  // already matched
      queue.delete(agentId);

      // Pick a random online bot as opponent
      try {
        const { rows } = await db.query(`
          SELECT agent_id FROM agents
          WHERE is_bot = true AND is_online = true
          ORDER BY RANDOM() LIMIT 1
        `);
        const botId = rows[0]?.agent_id;
        if (!botId) {
          // No bot available — stay waiting
          resolve({ status: 'waiting', position: 0 });
          return;
        }

        const room = createRoom(agentId, botId);
        setTimeout(() => startDebate(room.room_id), 1500);
        resolve({ status: 'matched', room, side: 'pro' });
      } catch(e) {
        resolve({ status: 'waiting', position: 0 });
      }
    }, 5000);
  });
}

function leaveQueue(agentId) {
  queue.delete(agentId);
}

function getRoom(roomId) { return rooms.get(roomId); }

function getLiveRooms() {
  const live = [];
  for (const [, room] of rooms) {
    if (['round','voting','intro'].includes(room.status)) {
      live.push({
        room_id:    room.room_id,
        topic:      room.topic,
        status:     room.status,
        round:      room.round,
        max_rounds: room.max_rounds,
        pro_info:   room.pro_info,
        con_info:   room.con_info,
        votes:      room.votes,
        msg_count:  room.messages.length,
        spectators: room.spectator_count,
        created_at: room.created_at,
      });
    }
  }
  return live.sort((a,b) => b.created_at - a.created_at);
}

// ── Audience Questions (public, from any human visitor) ──────
function addAudienceQuestion(roomId, handle, question) {
  const room = rooms.get(roomId);
  if (!room || room.status === 'ended') return false;

  if (!room.audience_questions) room.audience_questions = [];
  const entry = { id: room.audience_questions.length + 1, handle, question, ts: Date.now() };
  room.audience_questions.push(entry);

  // Broadcast to everyone in the room (agents + spectators)
  broadcast(room, {
    type: 'debate:audience_question',
    room_id: roomId,
    question: entry,
  });
  return true;
}

// ── Audience Reactions (emoji flood) ─────────────────────────
function addAudienceReaction(roomId, handle, emoji) {
  const room = rooms.get(roomId);
  if (!room || room.status === 'ended') return false;

  broadcast(room, {
    type: 'debate:reaction',
    room_id: roomId,
    handle: handle || 'anon',
    emoji,
    ts: Date.now(),
  });
  return true;
}

// ── User hint ─────────────────────────────────────────────────
function addUserHint(roomId, userId, target, hint) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'round') return false;
  const used = room.user_hints.some(h => h.user_id === userId);
  if (used) return false;
  room.user_hints.push({ user_id: userId, target, hint, delivered: false });
  // Deliver hint to targeted agent
  const agentId = target === 'pro' ? room.pro_agent : room.con_agent;
  const ws = connections.get(agentId);
  if (ws?.readyState === 1) {
    ws.send(JSON.stringify({ type: 'debate:hint', hint, from: 'audience' }));
  }
  return true;
}

module.exports = {
  createRoom, startDebate, registerConnection, addSpectator,
  handleAgentSpeech, vote, joinQueue, leaveQueue,
  getRoom, getLiveRooms, addUserHint,
  addAudienceQuestion, addAudienceReaction,
};

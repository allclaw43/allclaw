/**
 * AllClaw - Debate Arena Engine
 * Handles: matchmaking, debate flow, agent responses, state broadcast
 */

const crypto = require('crypto');
let _settleGame = null;
try { _settleGame = require('../../core/points-engine').settleGame; } catch(e) { console.warn('[Debate] points-engine not loaded:', e.message); }

// Debate topic library
const TOPICS = [
  "AI will replace most white-collar jobs within 10 years",
  "Open-source AI is more beneficial to humanity than closed-source AI",
  "Social media does more harm than good",
  "The Metaverse is the future, not a bubble",
  "Carbon neutrality should take priority over economic growth",
  "Humanity should colonize Mars",
  "Cryptocurrency will replace fiat currency",
  "Remote work is the dominant model of the future",
  "The arrival of AGI is a net positive for humanity",
  "The internet makes humanity more united than divided",
  "Regulation of AI development should be globally mandated",
  "Nuclear energy is essential to solving the climate crisis",
];

// Room storage (replace with Redis in production)
const rooms = new Map();

// WebSocket connections { agentId → ws }
const connections = new Map();

/**
 * Create a new debate room
 */
function createRoom(proAgentId, conAgentId) {
  const roomId = `debate_${crypto.randomBytes(8).toString('hex')}`;
  const topic = TOPICS[Math.floor(Math.random() * TOPICS.length)];

  const room = {
    room_id: roomId,
    game_type: 'debate',
    topic,
    status: 'intro',       // intro → round → voting → ended
    round: 0,
    max_rounds: 3,
    pro_agent: proAgentId,
    con_agent: conAgentId,
    current_turn: 'pro',
    messages: [],
    votes: { pro: 0, con: 0 },
    user_hints: [],
    winner: null,
    created_at: Date.now(),
    turn_deadline: null,
  };

  rooms.set(roomId, room);
  return room;
}

/**
 * Register a WebSocket connection for an agent
 */
function registerConnection(agentId, ws) {
  connections.set(agentId, ws);
}

/**
 * Broadcast an event to all participants in the room
 */
function broadcast(room, event) {
  const msg = JSON.stringify(event);
  [room.pro_agent, room.con_agent].forEach(agentId => {
    const ws = connections.get(agentId);
    if (ws && ws.readyState === 1) ws.send(msg);
  });
  // TODO: broadcast to spectator WebSocket connections
}

/**
 * Start a debate
 */
async function startDebate(roomId) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('Room not found');

  broadcast(room, {
    type: 'debate:start',
    room_id: roomId,
    topic: room.topic,
    max_rounds: room.max_rounds,
    assignments: {
      [room.pro_agent]: 'pro',
      [room.con_agent]: 'con',
    },
  });

  room.status = 'round';
  room.round = 1;
  await requestTurn(room);
}

/**
 * Request the current agent to speak
 */
async function requestTurn(room) {
  const agentId = room.current_turn === 'pro' ? room.pro_agent : room.con_agent;
  const side = room.current_turn;

  room.turn_deadline = Date.now() + 30000; // 30s time limit

  const history = room.messages.map(m =>
    `[${m.side === 'pro' ? 'PRO' : 'CON'} R${m.round}] ${m.content}`
  ).join('\n');

  const userHints = room.user_hints
    .filter(h => h.target === side && !h.delivered)
    .map(h => h.hint);
  userHints.forEach(h => {
    const hint = room.user_hints.find(x => x.hint === h);
    if (hint) hint.delivered = true;
  });

  const roleLabel = side === 'pro' ? 'PRO (supporting)' : 'CON (opposing)';
  const prompt = `You are arguing the ${roleLabel} side of: "${room.topic}".\n\nRound ${room.round} of ${room.max_rounds}.\n\n${history ? `Debate history:\n${history}\n\n` : ''}${userHints.length ? `Audience hint (you may use it): ${userHints.join('; ')}\n\n` : ''}State your argument concisely (100–200 words):`;

  const ws = connections.get(agentId);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: 'game:action_required',
      room_id: room.room_id,
      action: 'speak',
      prompt,
      deadline: room.turn_deadline,
      round: room.round,
    }));
  } else {
    // Agent offline — auto-forfeit
    setTimeout(() => handleTimeout(room), 5000);
  }
}

/**
 * Handle an agent speech submission
 */
async function handleAgentSpeech(roomId, agentId, content) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'round') return;

  const side = agentId === room.pro_agent ? 'pro' : 'con';
  if (room.current_turn !== side) return;

  const message = {
    agent_id: agentId,
    side,
    content: content.slice(0, 500),
    round: room.round,
    timestamp: Date.now(),
  };

  room.messages.push(message);

  broadcast(room, {
    type: 'debate:message',
    room_id: roomId,
    message,
  });

  if (room.current_turn === 'pro') {
    room.current_turn = 'con';
    await requestTurn(room);
  } else {
    room.round++;
    if (room.round > room.max_rounds) {
      await startVoting(room);
    } else {
      room.current_turn = 'pro';
      await requestTurn(room);
    }
  }
}

/**
 * Record a user whisper hint
 */
function addUserHint(roomId, userId, target, hint) {
  const room = rooms.get(roomId);
  if (!room) return false;

  const alreadyUsed = room.user_hints.some(h => h.user_id === userId);
  if (alreadyUsed) return false;

  room.user_hints.push({ user_id: userId, target, hint, delivered: false, timestamp: Date.now() });
  return true;
}

/**
 * Begin voting phase
 */
async function startVoting(room) {
  room.status = 'voting';
  broadcast(room, {
    type: 'debate:voting_start',
    room_id: room.room_id,
    duration: 30000,
    messages_summary: room.messages,
  });
  setTimeout(() => endGame(room), 30000);
}

/**
 * Audience vote
 */
function vote(roomId, userId, side) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'voting') return false;
  room.votes[side]++;
  broadcast(room, { type: 'debate:vote_update', votes: room.votes });
  return true;
}

/**
 * End the game and declare a winner
 */
async function endGame(room) {
  room.status = 'ended';
  room.winner = room.votes.pro >= room.votes.con ? 'pro' : 'con';

  const winnerAgent = room.winner === 'pro' ? room.pro_agent : room.con_agent;
  const loserAgent  = room.winner === 'pro' ? room.con_agent : room.pro_agent;

  // Settle points, ELO, XP, badges
  let settlement = null;
  if (_settleGame && winnerAgent && loserAgent) {
    try {
      // Store game record
      const db = require('../../db/pool');
      await db.query(`
        INSERT INTO games (game_id, game_type, status, winner_id, created_at, ended_at)
        VALUES ($1, 'debate', 'completed', $2, NOW() - INTERVAL '5 minutes', NOW())
        ON CONFLICT DO NOTHING
      `, [room.room_id, winnerAgent]);
      await db.query(`
        INSERT INTO game_participants (game_id, agent_id, result, score, elo_delta)
        VALUES ($1,$2,'win',$3,0), ($1,$4,'loss',$5,0) ON CONFLICT DO NOTHING
      `, [room.room_id, winnerAgent, room.votes[room.winner], loserAgent, room.votes[room.winner === 'pro' ? 'con' : 'pro']]);

      settlement = await _settleGame(room.room_id, 'debate', [
        { agent_id: winnerAgent, place: 1, score: room.votes[room.winner] },
        { agent_id: loserAgent,  place: 2, score: room.votes[room.winner === 'pro' ? 'con' : 'pro'] },
      ]);
    } catch(e) { console.error('[Debate] settle error:', e.message); }
  }

  broadcast(room, {
    type: 'debate:ended',
    room_id: room.room_id,
    winner: room.winner,
    votes: room.votes,
    winner_agent: winnerAgent,
    settlement,
  });
}

/**
 * Handle turn timeout — auto-forfeit
 */
function handleTimeout(room) {
  const forfeitSide = room.current_turn;
  const agentId = forfeitSide === 'pro' ? room.pro_agent : room.con_agent;
  const content = `[SYSTEM] ${forfeitSide.toUpperCase()} agent failed to respond in time. Turn forfeited.`;
  handleAgentSpeech(room.room_id, agentId, content);
}

/**
 * Get room state
 */
function getRoom(roomId) {
  return rooms.get(roomId);
}

/**
 * Matchmaking queue
 */
const waitingQueue = [];

function joinQueue(agentId) {
  if (waitingQueue.includes(agentId)) return null;

  if (waitingQueue.length > 0) {
    const opponent = waitingQueue.shift();
    const room = createRoom(opponent, agentId);
    setTimeout(() => startDebate(room.room_id), 2000);
    return { matched: true, room };
  }

  waitingQueue.push(agentId);
  return { matched: false, position: waitingQueue.length };
}

module.exports = {
  createRoom, startDebate, handleAgentSpeech,
  addUserHint, vote, getRoom, joinQueue,
  registerConnection, broadcast,
};

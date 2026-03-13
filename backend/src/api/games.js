/**
 * AllClaw - Game API Routes v2
 * Debate: real WS matchmaking + bot fallback + live rooms
 * Quiz:   turn-based Q&A with scoring
 */

const debate = require('../games/debate/engine');
const { authMiddleware, requireAuth } = require('../auth/jwt');
const pool = require('../db/pool');

// ── Quiz question bank ────────────────────────────────────────
const QUIZ_QUESTIONS = [
  { q:"Who developed the Transformer architecture?",                        opts:["Google Brain","OpenAI","Meta","DeepMind"],                ans:0 },
  { q:"What does 'GPT' stand for?",                                         opts:["Generative Pre-trained Transformer","General Purpose Tool","Graph Processing Technology","Gradient Propagation Training"], ans:0 },
  { q:"Which activation function is most common in modern LLMs?",           opts:["SwiGLU/SiLU","ReLU","Sigmoid","Tanh"],                    ans:0 },
  { q:"What is the context window of GPT-4 Turbo (max)?",                   opts:["128k tokens","32k tokens","8k tokens","256k tokens"],      ans:0 },
  { q:"Which company created the BERT model?",                              opts:["Google","OpenAI","Meta","Microsoft"],                       ans:0 },
  { q:"What does RLHF stand for?",                                          opts:["Reinforcement Learning from Human Feedback","Recursive Large-scale Hallucination Fix","Regression Loss Hyperparameter Finetuning","Random Layer Hierarchical Fine-tuning"], ans:0 },
  { q:"Which model family is Claude part of?",                              opts:["Anthropic","OpenAI","Google","Meta"],                       ans:0 },
  { q:"What is the primary training objective of language models?",         opts:["Next token prediction","Image classification","Speech recognition","Graph embedding"], ans:0 },
  { q:"Which architecture does Llama use?",                                 opts:["Transformer decoder","Transformer encoder","CNN","RNN"],    ans:0 },
  { q:"What is 'temperature' in LLM generation?",                           opts:["Randomness control","GPU heat monitor","Training speed","Context length"], ans:0 },
  { q:"Who founded Anthropic?",                                             opts:["Dario Amodei","Sam Altman","Elon Musk","Demis Hassabis"],  ans:0 },
  { q:"What is MoE in AI models?",                                          opts:["Mixture of Experts","Model of Everything","Multi-order Embedding","Memory over Epochs"], ans:0 },
  { q:"Which dataset is Llama 3 primarily trained on?",                     opts:["Public internet data","Wikipedia only","Books only","Synthetic only"], ans:0 },
  { q:"What is 'quantization' in the context of LLMs?",                    opts:["Reducing model precision to save memory","Training with more data","Adding more layers","Increasing vocabulary size"], ans:0 },
  { q:"Which metric is commonly used to evaluate LLMs?",                   opts:["Perplexity","Accuracy only","F1 Score only","BLEU only"],  ans:0 },
  { q:"What year was ChatGPT publicly released?",                           opts:["2022","2021","2023","2020"],                                ans:0 },
  { q:"What is 'hallucination' in LLMs?",                                   opts:["Generating false but confident text","Seeing colors in data","GPU overheating","Memory overflow"], ans:0 },
  { q:"What does RAG stand for?",                                           opts:["Retrieval-Augmented Generation","Random Attention Gating","Recursive Auto-Generation","Reinforced Attention Gradient"], ans:0 },
  { q:"Which company developed the Gemini model family?",                   opts:["Google DeepMind","OpenAI","Microsoft","Meta"],             ans:0 },
  { q:"What is 'few-shot learning' in LLMs?",                              opts:["Learning from a small number of examples in the prompt","Training with limited GPU","Using tiny datasets","Reducing parameter count"], ans:0 },
  { q:"What is the default starting ELO in AllClaw?",                      opts:["1200","1000","1500","800"],                                  ans:0 },
  { q:"How many rounds does a standard Debate game have in AllClaw?",       opts:["3","5","2","10"],                                           ans:0 },
  { q:"Which game type gives the most win points in AllClaw?",              opts:["Code Duel (+300)","Debate (+200)","Quiz (+150)","Challenge (variable)"], ans:0 },
  { q:"What is the top level name in AllClaw?",                             opts:["Apex","Legend","Grandmaster","Master"],                     ans:0 },
  { q:"How many XP does it take to reach level 10 (Apex) in AllClaw?",     opts:["10000","5000","8000","15000"],                              ans:0 },
];

// In-memory quiz rooms
const quizRooms = new Map();

function createQuizRoom(agentA, agentB) {
  const roomId = `quiz_${require('crypto').randomBytes(8).toString('hex')}`;
  // Shuffle and pick 10 questions
  const shuffled = [...QUIZ_QUESTIONS].sort(() => Math.random() - 0.5).slice(0, 10);
  const room = {
    room_id:    roomId,
    game_type:  'quiz',
    status:     'waiting',
    agents:     [agentA, agentB],
    questions:  shuffled,
    current_q:  0,
    scores:     { [agentA]: 0, [agentB]: 0 },
    answers:    [],  // [{ q_idx, agent_id, answer, correct, ms }]
    created_at: Date.now(),
    q_timer:    null,
  };
  quizRooms.set(roomId, room);
  return room;
}

async function gameRoutes(fastify) {

  // ═══════════════════════════════════════════════════════════
  // DEBATE
  // ═══════════════════════════════════════════════════════════

  // ── POST /api/v1/games/debate/queue ──────────────────────────
  fastify.post('/api/v1/games/debate/queue', { preHandler: requireAuth }, async (req, reply) => {
    const { agent_id } = req.agent;
    const result = await debate.joinQueue(agent_id);

    if (result.status === 'matched') {
      return reply.send({
        status:  'matched',
        room_id: result.room.room_id,
        topic:   result.room.topic,
        side:    result.side,
      });
    }
    return reply.send({ status: 'waiting', message: 'Finding opponent (bot fallback in 5s)...' });
  });

  // ── DELETE /api/v1/games/debate/queue ─────────────────────────
  fastify.delete('/api/v1/games/debate/queue', { preHandler: requireAuth }, async (req, reply) => {
    debate.leaveQueue(req.agent.agent_id);
    reply.send({ ok: true });
  });

  // ── GET /api/v1/games/debate/live ─────────────────────────────
  fastify.get('/api/v1/games/debate/live', async (req, reply) => {
    reply.send({ rooms: debate.getLiveRooms(), total: debate.getLiveRooms().length });
  });

  // ── GET /api/v1/games/debate/:roomId ──────────────────────────
  fastify.get('/api/v1/games/debate/:roomId', async (req, reply) => {
    const room = debate.getRoom(req.params.roomId);
    if (!room) return reply.status(404).send({ error: 'Room not found' });
    // Sanitize: don't expose raw timers
    const { turn_timer, q_timer, ...safe } = room;
    reply.send(safe);
  });

  // ── POST /api/v1/games/debate/:roomId/speak ───────────────────
  // For real agents: submit their argument via REST (WS preferred)
  fastify.post('/api/v1/games/debate/:roomId/speak', { preHandler: requireAuth }, async (req, reply) => {
    const { content } = req.body || {};
    if (!content?.trim()) return reply.status(400).send({ error: 'content required' });
    const ok = debate.handleAgentSpeech(req.params.roomId, req.agent.agent_id, content.trim());
    if (!ok) return reply.status(400).send({ error: 'Not your turn or room not active' });
    reply.send({ ok: true });
  });

  // ── POST /api/v1/games/debate/:roomId/vote ────────────────────
  fastify.post('/api/v1/games/debate/:roomId/vote', async (req, reply) => {
    const { side, user_id } = req.body || {};
    const ok = debate.vote(req.params.roomId, user_id || 'anon', side);
    if (!ok) return reply.status(400).send({ error: 'Vote failed' });
    reply.send({ ok: true });
  });

  // ── POST /api/v1/games/debate/:roomId/hint ────────────────────
  fastify.post('/api/v1/games/debate/:roomId/hint', async (req, reply) => {
    const { user_id, target, hint } = req.body || {};
    if (!['pro','con'].includes(target)) return reply.status(400).send({ error: 'target must be pro or con' });
    if (!hint?.trim() || hint.length < 5) return reply.status(400).send({ error: 'Hint too short' });
    const ok = debate.addUserHint(req.params.roomId, user_id || 'anon', target, hint.trim());
    if (!ok) return reply.status(400).send({ error: 'Hint already used or room not in round phase' });
    reply.send({ ok: true });
  });

  // ── WS /api/v1/games/debate/ws ────────────────────────────────
  // Agents connect here to participate in debates in real-time
  fastify.get('/api/v1/games/debate/ws', { websocket: true }, async (socket, req) => {
    let agentId = null;
    let roomId  = null;

    socket.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        switch (msg.type) {
          case 'auth': {
            // { type:'auth', token:'...' }
            const { verifyToken } = require('../auth/jwt');
            const payload = verifyToken(msg.token);
            if (!payload) { socket.send(JSON.stringify({ type:'error', message:'Invalid token' })); return; }
            agentId = payload.agent_id;
            debate.registerConnection(agentId, socket);
            socket.send(JSON.stringify({ type:'auth:ok', agent_id: agentId }));
            break;
          }

          case 'queue:join': {
            if (!agentId) { socket.send(JSON.stringify({ type:'error', message:'Not authenticated' })); return; }
            const result = await debate.joinQueue(agentId);
            if (result.status === 'matched') {
              roomId = result.room.room_id;
              socket.send(JSON.stringify({
                type: 'queue:matched',
                room_id: roomId,
                topic: result.room.topic,
                side:  result.side,
              }));
            } else {
              socket.send(JSON.stringify({ type: 'queue:waiting' }));
            }
            break;
          }

          case 'debate:speak': {
            if (!agentId || !msg.room_id || !msg.content) return;
            debate.handleAgentSpeech(msg.room_id, agentId, msg.content);
            break;
          }

          case 'debate:vote': {
            if (!msg.room_id || !msg.side) return;
            debate.vote(msg.room_id, agentId || 'anon', msg.side);
            break;
          }

          case 'spectate': {
            // { type:'spectate', room_id:'...' }
            if (msg.room_id) {
              roomId = msg.room_id;
              debate.addSpectator(msg.room_id, socket);
              const room = debate.getRoom(msg.room_id);
              if (room) {
                const { turn_timer, ...safe } = room;
                socket.send(JSON.stringify({ type: 'room:state', room: safe }));
              }
            }
            break;
          }

          case 'ping':
            socket.send(JSON.stringify({ type: 'pong' }));
            break;
        }
      } catch(e) {
        console.error('[GameWS] error:', e.message);
      }
    });

    socket.on('close', () => {
      if (agentId) debate.leaveQueue(agentId);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // QUIZ
  // ═══════════════════════════════════════════════════════════

  // ── POST /api/v1/games/quiz/queue ─────────────────────────────
  fastify.post('/api/v1/games/quiz/queue', { preHandler: requireAuth }, async (req, reply) => {
    const agentId = req.agent.agent_id;

    // Immediately match with a bot
    const { rows } = await pool.query(`
      SELECT agent_id FROM agents WHERE is_bot=true AND is_online=true ORDER BY RANDOM() LIMIT 1
    `);
    const botId = rows[0]?.agent_id;
    if (!botId) return reply.status(503).send({ error: 'No bots available' });

    const room = createQuizRoom(agentId, botId);

    // Start quiz after 2s
    setTimeout(() => startQuiz(room), 2000);

    reply.send({
      status:   'matched',
      room_id:  room.room_id,
      opponent: botId,
      q_count:  room.questions.length,
    });
  });

  // ── GET /api/v1/games/quiz/:roomId ────────────────────────────
  fastify.get('/api/v1/games/quiz/:roomId', async (req, reply) => {
    const room = quizRooms.get(req.params.roomId);
    if (!room) return reply.status(404).send({ error: 'Room not found' });
    const { q_timer, ...safe } = room;
    reply.send(safe);
  });

  // ── POST /api/v1/games/quiz/:roomId/answer ────────────────────
  fastify.post('/api/v1/games/quiz/:roomId/answer', { preHandler: requireAuth }, async (req, reply) => {
    const room = quizRooms.get(req.params.roomId);
    if (!room || room.status !== 'active') return reply.status(400).send({ error: 'Room not active' });

    const { answer_index } = req.body || {};
    const agentId = req.agent.agent_id;
    if (!room.agents.includes(agentId)) return reply.status(403).send({ error: 'Not in this game' });

    const q   = room.questions[room.current_q];
    const correct = answer_index === q.ans;
    if (correct) room.scores[agentId] = (room.scores[agentId] || 0) + 10;

    room.answers.push({
      q_idx:    room.current_q,
      agent_id: agentId,
      answer:   answer_index,
      correct,
      ms:       Date.now() - room.q_start,
    });

    // Check if both answered
    const thisQAnswers = room.answers.filter(a => a.q_idx === room.current_q);
    if (thisQAnswers.length >= 2 || room.agents.length < 2) {
      advanceQuiz(room);
    }

    reply.send({ ok: true, correct, correct_index: q.ans });
  });

  // ── GET /api/v1/games/quiz/questions ─────────────────────────
  fastify.get('/api/v1/games/quiz/questions', async (req, reply) => {
    reply.send({ count: QUIZ_QUESTIONS.length, sample: QUIZ_QUESTIONS.slice(0,3) });
  });

  // ═══════════════════════════════════════════════════════════
  // SHARED
  // ═══════════════════════════════════════════════════════════

  // ── GET /api/v1/leaderboard ───────────────────────────────────
  fastify.get('/api/v1/leaderboard', async (req, reply) => {
    const { rows } = await pool.query(`
      SELECT agent_id, COALESCE(custom_name,display_name) AS display_name,
             oc_model, oc_provider, elo_rating, games_played, wins, losses,
             ROUND(CASE WHEN games_played>0 THEN wins::numeric/games_played*100 ELSE 0 END) AS win_rate,
             is_bot
      FROM agents
      WHERE games_played > 0
      ORDER BY elo_rating DESC LIMIT 50
    `);
    reply.send({ leaderboard: rows });
  });

  // ── GET /api/v1/games/history ─────────────────────────────────
  fastify.get('/api/v1/games/history', async (req, reply) => {
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    // Pull winner + loser names from game_participants (more reliable than winner_id)
    const { rows } = await pool.query(`
      SELECT
        g.game_id, g.game_type, g.status, g.created_at, g.ended_at,
        w.display_name  AS winner_name,  w.agent_id  AS winner_id,
        w.oc_model      AS winner_model, w.country_code AS winner_country,
        l.display_name  AS loser_name,   l.agent_id  AS loser_id,
        l.oc_model      AS loser_model,
        wp.elo_delta    AS winner_elo_delta
      FROM games g
      LEFT JOIN game_participants wp ON wp.game_id = g.game_id AND wp.result = 'win'
      LEFT JOIN agents w ON w.agent_id = wp.agent_id
      LEFT JOIN game_participants lp ON lp.game_id = g.game_id AND lp.result = 'loss'
      LEFT JOIN agents l ON l.agent_id = lp.agent_id
      WHERE g.status = 'completed'
      ORDER BY g.ended_at DESC NULLS LAST
      LIMIT $1
    `, [limit]);
    reply.send({ games: rows });
  });
}

// ── Quiz helpers ─────────────────────────────────────────────
function startQuiz(room) {
  room.status  = 'active';
  room.current_q = 0;
  nextQuestion(room);
}

function nextQuestion(room) {
  if (room.current_q >= room.questions.length) {
    endQuiz(room);
    return;
  }
  const q = room.questions[room.current_q];
  room.q_start = Date.now();

  // Bot auto-answers after 3–8s (45% accuracy)
  const botId = room.agents.find(id => id.startsWith('bot_'));
  if (botId) {
    const thinkMs = 3000 + Math.random() * 5000;
    room.q_timer = setTimeout(() => {
      // Bot answers: 45% correct
      const botAns = Math.random() < 0.45 ? q.ans
        : (q.ans + 1 + Math.floor(Math.random() * (q.opts.length - 1))) % q.opts.length;
      const correct = botAns === q.ans;
      if (correct) room.scores[botId] = (room.scores[botId] || 0) + 10;
      room.answers.push({ q_idx: room.current_q, agent_id: botId, answer: botAns, correct, ms: thinkMs });
      // Check if both answered
      const thisQ = room.answers.filter(a => a.q_idx === room.current_q);
      if (thisQ.length >= 2) advanceQuiz(room);
    }, thinkMs);
  }

  // Real agent timeout after 15s
  setTimeout(() => {
    const thisQ = room.answers.filter(a => a.q_idx === room.current_q);
    const realId = room.agents.find(id => !id.startsWith('bot_'));
    if (realId && !thisQ.find(a => a.agent_id === realId)) {
      room.answers.push({ q_idx: room.current_q, agent_id: realId, answer: -1, correct: false, ms: 15000 });
      advanceQuiz(room);
    }
  }, 15000);
}

function advanceQuiz(room) {
  if (room.q_timer) { clearTimeout(room.q_timer); room.q_timer = null; }
  room.current_q++;
  if (room.current_q < room.questions.length) {
    setTimeout(() => nextQuestion(room), 1500);
  } else {
    endQuiz(room);
  }
}

async function endQuiz(room) {
  if (room.status === 'ended') return;
  room.status = 'ended';

  const [agentA, agentB] = room.agents;
  const scoreA = room.scores[agentA] || 0;
  const scoreB = room.scores[agentB] || 0;
  const winnerAgent = scoreA >= scoreB ? agentA : agentB;
  const loserAgent  = scoreA >= scoreB ? agentB : agentA;

  try {
    const gameId = room.room_id;
    await pool.query(`
      INSERT INTO games (game_id, game_type, status, winner_id, created_at, ended_at)
      VALUES ($1,'quiz','completed',$2,NOW() - INTERVAL '5 minutes',NOW())
      ON CONFLICT DO NOTHING
    `, [gameId, winnerAgent]);
    await pool.query(`
      INSERT INTO game_participants (game_id, agent_id, result, score, elo_delta)
      VALUES ($1,$2,'win',$3,0),($1,$4,'loss',$5,0) ON CONFLICT DO NOTHING
    `, [gameId, winnerAgent, Math.max(scoreA,scoreB), loserAgent, Math.min(scoreA,scoreB)]);

    if (require('../../core/points-engine').settleGame) {
      await require('../../core/points-engine').settleGame(gameId, 'quiz', [
        { agent_id: winnerAgent, place: 1, score: Math.max(scoreA,scoreB) },
        { agent_id: loserAgent,  place: 2, score: Math.min(scoreA,scoreB) },
      ]);
    }
  } catch(e) { console.error('[Quiz] endQuiz error:', e.message); }

  setTimeout(() => quizRooms.delete(room.room_id), 5 * 60 * 1000);
}

module.exports = { gameRoutes };

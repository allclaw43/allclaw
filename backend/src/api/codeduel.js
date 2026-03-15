/**
 * AllClaw — Code Duel API v1.0
 *
 * Routes:
 *   GET  /api/v1/codeduel/challenges          - list all challenges
 *   GET  /api/v1/codeduel/challenges/:id      - get one challenge
 *   POST /api/v1/codeduel/rooms               - create a room (auth)
 *   GET  /api/v1/codeduel/rooms               - list active rooms
 *   GET  /api/v1/codeduel/rooms/:id           - get room state
 *   POST /api/v1/codeduel/rooms/:id/submit    - submit solution (auth)
 *   POST /api/v1/codeduel/rooms/:id/timeout   - force score (system)
 *   GET  /api/v1/codeduel/leaderboard         - top code duelers
 *   GET  /api/v1/codeduel/history             - recent completed duels
 *   POST /api/v1/codeduel/practice            - solo practice session
 */

const engine = require('../games/codeduel/engine');
const { requireAuth } = require('../auth/jwt');
const pool   = require('../db/pool');

async function codeduelRoutes(fastify) {

  // GET /challenges
  fastify.get('/api/v1/codeduel/challenges', async (req, reply) => {
    const { difficulty, category } = req.query;
    let challenges = engine.CHALLENGES;

    if (difficulty) {
      challenges = challenges.filter(c => c.difficulty.toLowerCase() === difficulty.toLowerCase());
    }
    if (category) {
      challenges = challenges.filter(c => c.category.toLowerCase().includes(category.toLowerCase()));
    }

    // Don't expose scoring_keywords in list view
    return challenges.map(c => ({
      id:          c.id,
      title:       c.title,
      difficulty:  c.difficulty,
      category:    c.category,
      description: c.description,
      constraints: c.constraints,
      test_cases:  c.test_cases.slice(0, 2),  // show 2 examples
      max_points:  c.max_points,
    }));
  });

  // GET /challenges/:id
  fastify.get('/api/v1/codeduel/challenges/:id', async (req, reply) => {
    const ch = engine.CHALLENGES.find(c => c.id === req.params.id);
    if (!ch) return reply.code(404).send({ error: 'challenge not found' });
    return {
      id:          ch.id,
      title:       ch.title,
      difficulty:  ch.difficulty,
      category:    ch.category,
      description: ch.description,
      constraints: ch.constraints,
      hints:       ch.hints,
      test_cases:  ch.test_cases,
      max_points:  ch.max_points,
    };
  });

  // POST /rooms — create a new duel room
  fastify.post('/api/v1/codeduel/rooms', { preHandler: requireAuth }, async (req, reply) => {
    const { challenge_id, opponent_id } = req.body || {};
    const agentId = req.user.agent_id;

    // Look up agent info
    const agentRow = await pool.query(
      'SELECT id, display_name, elo_rating FROM agents WHERE id = $1',
      [agentId]
    ).catch(() => ({ rows: [] }));

    if (!agentRow.rows[0]) return reply.code(404).send({ error: 'agent not found' });

    const agentA = { id: agentId, display_name: agentRow.rows[0].display_name, is_bot: false };

    let agentB;
    if (opponent_id) {
      const oppRow = await pool.query(
        'SELECT id, display_name FROM agents WHERE id = $1',
        [opponent_id]
      ).catch(() => ({ rows: [] }));
      if (!oppRow.rows[0]) return reply.code(404).send({ error: 'opponent not found' });
      agentB = { id: opponent_id, display_name: oppRow.rows[0].display_name, is_bot: false };
    } else {
      // Bot opponent
      agentB = { id: `bot_${Math.floor(Math.random() * 5000)}`, display_name: 'CodeBot', is_bot: true };
    }

    const room = engine.createRoom(agentA, agentB, challenge_id || null);
    engine.startRoom(room.room_id);

    // Set deadline timer
    setTimeout(async () => {
      const r = engine.getRoom(room.room_id);
      if (r && r.status === 'active') {
        const result = engine.handleTimeout(room.room_id);
        if (result?.ok && result.room) {
          await engine.persistRoom(result.room);
          // WS broadcast if available
          if (fastify.broadcastAll) {
            fastify.broadcastAll({
              type:    'codeduel:timeout',
              room_id: room.room_id,
              winner:  result.room.winner,
              scores:  result.room.scores,
            });
          }
        }
      }
    }, room.deadline_ms);

    return {
      room_id:    room.room_id,
      challenge:  {
        id:          room.challenge.id,
        title:       room.challenge.title,
        difficulty:  room.challenge.difficulty,
        description: room.challenge.description,
        constraints: room.challenge.constraints,
        hints:       room.challenge.hints,
        test_cases:  room.challenge.test_cases,
        max_points:  room.challenge.max_points,
      },
      agents:      room.agents,
      status:      room.status,
      deadline_ms: room.deadline_ms,
      started_at:  room.started_at,
    };
  });

  // GET /rooms — list active rooms
  fastify.get('/api/v1/codeduel/rooms', async (req, reply) => {
    const active = engine.listActiveRooms();
    return active.map(r => ({
      room_id:   r.room_id,
      challenge: { id: r.challenge.id, title: r.challenge.title, difficulty: r.challenge.difficulty },
      status:    r.status,
      agents:    {
        a: { display_name: r.agents.a?.display_name },
        b: { display_name: r.agents.b?.display_name },
      },
      started_at: r.started_at,
    }));
  });

  // GET /rooms/:id — get room state
  fastify.get('/api/v1/codeduel/rooms/:id', async (req, reply) => {
    const room = engine.getRoom(req.params.id);
    if (!room) return reply.code(404).send({ error: 'room not found' });

    const resp = {
      room_id:    room.room_id,
      status:     room.status,
      challenge:  {
        id:          room.challenge.id,
        title:       room.challenge.title,
        difficulty:  room.challenge.difficulty,
        description: room.challenge.description,
        constraints: room.challenge.constraints,
        hints:       room.challenge.hints,
        test_cases:  room.challenge.test_cases,
        max_points:  room.challenge.max_points,
      },
      agents:     room.agents,
      submitted:  {
        a: !!room.submissions.a,
        b: !!room.submissions.b,
      },
      started_at: room.started_at,
    };

    if (room.status === 'complete') {
      resp.scores  = room.scores;
      resp.winner  = room.winner;
      resp.submissions = {
        a: room.submissions.a?.text,
        b: room.submissions.b?.text,
      };
    }

    return resp;
  });

  // POST /rooms/:id/submit — submit solution
  fastify.post('/api/v1/codeduel/rooms/:id/submit', { preHandler: requireAuth }, async (req, reply) => {
    const { solution } = req.body || {};
    if (!solution || solution.trim().length < 10) {
      return reply.code(400).send({ error: 'solution too short (min 10 chars)' });
    }
    if (solution.length > 5000) {
      return reply.code(400).send({ error: 'solution too long (max 5000 chars)' });
    }

    const room = engine.getRoom(req.params.id);
    if (!room) return reply.code(404).send({ error: 'room not found' });

    // Determine which side this agent is
    const agentId = req.user.agent_id;
    const side = room.agents.a?.id === agentId ? 'a'
               : room.agents.b?.id === agentId ? 'b'
               : null;

    if (!side) return reply.code(403).send({ error: 'you are not in this room' });

    const result = engine.submitSolution(req.params.id, side, solution);
    if (!result.ok) return reply.code(400).send({ error: result.error });

    // If complete, persist to DB
    if (result.room?.status === 'complete') {
      await engine.persistRoom(result.room);
      if (fastify.broadcastAll) {
        fastify.broadcastAll({
          type:    'codeduel:complete',
          room_id: req.params.id,
          winner:  result.room.winner,
          scores:  result.room.scores,
          challenge: { id: result.room.challenge.id, title: result.room.challenge.title },
        });
      }
    }

    const room2 = engine.getRoom(req.params.id);
    return {
      ok:      true,
      status:  room2.status,
      submitted: side,
      waiting_for_opponent: room2.status === 'active',
      ...(room2.status === 'complete' ? {
        scores:  room2.scores,
        winner:  room2.winner,
        your_score: room2.scores[side],
        result: room2.winner === side ? 'win' : room2.winner === 'draw' ? 'draw' : 'loss',
      } : {}),
    };
  });

  // POST /rooms/:id/timeout — system force-score
  fastify.post('/api/v1/codeduel/rooms/:id/timeout', async (req, reply) => {
    const result = engine.handleTimeout(req.params.id);
    if (!result) return reply.code(404).send({ error: 'room not found or already complete' });
    if (result.ok) await engine.persistRoom(result.room);
    return result;
  });

  // GET /leaderboard — top code duelers (from code_duel_stats)
  fastify.get('/api/v1/codeduel/leaderboard', async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    try {
      const res = await pool.query(`
        SELECT
          s.agent_id, s.wins, s.losses, s.draws,
          s.total_score, s.best_score, s.updated_at,
          COALESCE(a.custom_name, a.display_name) AS name,
          a.model, a.division, a.elo_rating
        FROM code_duel_stats s
        JOIN agents a ON a.agent_id = s.agent_id
        ORDER BY s.wins DESC, s.total_score DESC
        LIMIT $1
      `, [limit]);
      return res.rows;
    } catch (err) {
      return [];
    }
  });

  // GET /history — recent completed duels (from code_duel_rooms)
  fastify.get('/api/v1/codeduel/history', async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit) || 15, 50);
    try {
      const res = await pool.query(`
        SELECT room_id, challenge_title, difficulty, category,
               agent_a_name, agent_b_name,
               score_a, score_b, winner, ended_at, started_at
        FROM code_duel_rooms
        WHERE status = 'complete'
        ORDER BY ended_at DESC
        LIMIT $1
      `, [limit]);
      return res.rows.map(r => ({
        room_id: r.room_id,
        challenge: { title: r.challenge_title, difficulty: r.difficulty, category: r.category },
        agent_a: r.agent_a_name, agent_b: r.agent_b_name,
        score_a: r.score_a, score_b: r.score_b,
        winner: r.winner,
        ended_at: r.ended_at,
        duration_s: r.ended_at && r.started_at
          ? Math.round((new Date(r.ended_at) - r.started_at) / 1000) : null,
      }));
    } catch (err) {
      return [];
    }
  });

  // POST /practice — solo practice (no opponent, no ranking)
  fastify.post('/api/v1/codeduel/practice', { preHandler: requireAuth }, async (req, reply) => {
    const { challenge_id, solution } = req.body || {};
    if (!solution || solution.trim().length < 10) {
      return reply.code(400).send({ error: 'solution required (min 10 chars)' });
    }

    const ch = challenge_id
      ? engine.CHALLENGES.find(c => c.id === challenge_id)
      : engine.CHALLENGES[Math.floor(Math.random() * engine.CHALLENGES.length)];

    if (!ch) return reply.code(404).send({ error: 'challenge not found' });

    const started_at = Date.now() - 120000; // assume 2min solve time for scoring
    const score = engine.scoreSubmission
      ? engine.scoreSubmission(ch, solution, Date.now(), started_at)
      : 50;

    // Generate bot comparison
    const botSolution = engine.generateBotSubmission(ch.difficulty.toLowerCase());
    const botScore    = engine.scoreSubmission
      ? engine.scoreSubmission(ch, botSolution, Date.now() - 30000, started_at)
      : 45;

    const pct = Math.round((score / ch.max_points) * 100);
    const grade = pct >= 90 ? 'S' : pct >= 75 ? 'A' : pct >= 60 ? 'B' : pct >= 40 ? 'C' : 'D';

    return {
      challenge: { id: ch.id, title: ch.title, difficulty: ch.difficulty, max_points: ch.max_points },
      your_score: score,
      bot_score:  botScore,
      grade,
      pct,
      keywords_detected: ch.scoring_keywords.filter(kw =>
        solution.toLowerCase().includes(kw.toLowerCase())
      ),
      feedback: pct >= 75
        ? 'Strong solution! Good keyword coverage and approach.'
        : pct >= 50
        ? 'Decent approach. Try mentioning time/space complexity and edge cases.'
        : 'Consider explaining your algorithm more clearly with key concepts.',
      practice_mode: true,
    };
  });
}

module.exports = codeduelRoutes;

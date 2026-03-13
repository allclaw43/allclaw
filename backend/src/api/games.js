/**
 * AllClaw - Game API Routes
 */

const debateEngine = require('../games/debate/engine');
const { authMiddleware } = require('../auth/jwt');
const pool = require('../db/pool');

async function gameRoutes(fastify) {

  // ── Debate Arena ─────────────────────────────────────────────

  // Join matchmaking queue
  fastify.post('/api/v1/games/debate/queue', { preHandler: authMiddleware }, async (req, reply) => {
    const { agent_id } = req.agent;
    const result = debateEngine.joinQueue(agent_id);

    if (result.matched) {
      return reply.send({
        status: 'matched',
        room_id: result.room.room_id,
        topic: result.room.topic,
      });
    } else {
      return reply.send({
        status: 'waiting',
        position: result.position,
        message: 'Waiting for opponent...',
      });
    }
  });

  // Get room state
  fastify.get('/api/v1/games/debate/:roomId', async (req, reply) => {
    const room = debateEngine.getRoom(req.params.roomId);
    if (!room) return reply.status(404).send({ error: 'Room not found' });
    return reply.send(room);
  });

  // Human whisper hint
  fastify.post('/api/v1/games/debate/:roomId/hint', async (req, reply) => {
    const { roomId } = req.params;
    const { user_id, target, hint } = req.body;

    if (!['pro', 'con'].includes(target)) {
      return reply.status(400).send({ error: 'target must be "pro" or "con"' });
    }
    if (!hint || hint.trim().length < 5) {
      return reply.status(400).send({ error: 'Hint too short (min 5 chars)' });
    }

    const ok = debateEngine.addUserHint(roomId, user_id, target, hint.trim());
    if (!ok) return reply.status(400).send({ error: 'You have already used your hint' });

    return reply.send({ success: true, message: 'Hint delivered — waiting for AI to incorporate' });
  });

  // Audience vote
  fastify.post('/api/v1/games/debate/:roomId/vote', async (req, reply) => {
    const { roomId } = req.params;
    const { user_id, side } = req.body;

    if (!['pro', 'con'].includes(side)) {
      return reply.status(400).send({ error: 'side must be "pro" or "con"' });
    }

    const ok = debateEngine.vote(roomId, user_id, side);
    if (!ok) return reply.status(400).send({ error: 'Vote failed (room not in voting phase)' });

    return reply.send({ success: true });
  });

  // Live debates (spectator)
  fastify.get('/api/v1/games/debate/live', async (req, reply) => {
    return reply.send({ rooms: [], total: 0 });
  });

  // ── Leaderboard ───────────────────────────────────────────────

  fastify.get('/api/v1/leaderboard', async (req, reply) => {
    const rows = await pool.query(`
      SELECT agent_id, display_name, oc_model, oc_provider,
             elo_rating, games_played, wins, losses,
             CASE WHEN games_played > 0 THEN ROUND(wins::numeric/games_played*100) ELSE 0 END as win_rate
      FROM agents
      WHERE games_played > 0
      ORDER BY elo_rating DESC
      LIMIT 50
    `);
    return reply.send({ leaderboard: rows.rows });
  });
}

module.exports = { gameRoutes };

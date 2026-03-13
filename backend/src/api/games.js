/**
 * AllClaw - 游戏相关 API
 */

const debateEngine = require('../games/debate/engine');
const { authMiddleware } = require('../auth/jwt');
const pool = require('../db/pool');

async function gameRoutes(fastify) {

  // ── 辩论场 ────────────────────────────────────────────────────

  // 加入对战队列
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
        message: '正在等待对手...',
      });
    }
  });

  // 获取房间状态
  fastify.get('/api/v1/games/debate/:roomId', async (req, reply) => {
    const room = debateEngine.getRoom(req.params.roomId);
    if (!room) return reply.status(404).send({ error: '房间不存在' });
    return reply.send(room);
  });

  // 用户耳语
  fastify.post('/api/v1/games/debate/:roomId/hint', async (req, reply) => {
    const { roomId } = req.params;
    const { user_id, target, hint } = req.body;

    if (!['pro', 'con'].includes(target)) {
      return reply.status(400).send({ error: 'target 必须是 pro 或 con' });
    }
    if (!hint || hint.trim().length < 5) {
      return reply.status(400).send({ error: '耳语内容太短' });
    }

    const ok = debateEngine.addUserHint(roomId, user_id, target, hint.trim());
    if (!ok) return reply.status(400).send({ error: '你已经使用过耳语了' });

    return reply.send({ success: true, message: '耳语已发送，等待 AI 采纳' });
  });

  // 用户投票
  fastify.post('/api/v1/games/debate/:roomId/vote', async (req, reply) => {
    const { roomId } = req.params;
    const { user_id, side } = req.body;

    if (!['pro', 'con'].includes(side)) {
      return reply.status(400).send({ error: 'side 必须是 pro 或 con' });
    }

    const ok = debateEngine.vote(roomId, user_id, side);
    if (!ok) return reply.status(400).send({ error: '投票失败（房间不在投票阶段）' });

    return reply.send({ success: true });
  });

  // 获取进行中的辩论列表（供观战）
  fastify.get('/api/v1/games/debate/live', async (req, reply) => {
    // TODO: 从内存/Redis 获取进行中的房间
    return reply.send({ rooms: [], total: 0 });
  });

  // ── 排行榜 ────────────────────────────────────────────────────

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

// quiz 路由在主文件中注册后追加

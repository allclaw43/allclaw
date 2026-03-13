/**
 * AllClaw Backend - 主服务器
 */
require('./config');

const Fastify = require('fastify');
const { createClient } = require('redis');
const { setRedis } = require('./auth/challenge');
const { probeRoutes } = require('./api/probe');
const { gameRoutes } = require('./api/games');
const { marketRoutes } = require('./api/market');
const debateEngine = require('./games/debate/engine');

const PORT = process.env.PORT || 3001;

async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: 'info',
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  });

  // CORS
  fastify.register(require('@fastify/cors'), {
    origin: [
      'https://allclaw.io',
      'https://www.allclaw.io',
      'http://localhost:3000',
    ],
    credentials: true,
  });

  // WebSocket
  fastify.register(require('@fastify/websocket'));

  // 健康检查
  fastify.get('/health', async () => ({
    status: 'ok',
    service: 'AllClaw API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  }));

  // 认证 & Agent 路由
  fastify.register(probeRoutes);

  // 游戏路由
  fastify.register(gameRoutes);

  // 预测市场路由
  fastify.register(marketRoutes);

  // WebSocket 实时通信
  fastify.get('/ws', { websocket: true }, (socket, req) => {
    let agentId = null;

    socket.send(JSON.stringify({ type: 'hello', message: '🦅 欢迎来到 AllClaw！' }));

    socket.on('message', async (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        fastify.log.info('[WS] 收到：' + data.type);

        switch (data.type) {
          // Agent 身份认证
          case 'auth': {
            const { verifyJwt } = require('./auth/jwt');
            const payload = verifyJwt(data.token);
            if (!payload) { socket.send(JSON.stringify({ type: 'error', message: 'Token 无效' })); return; }
            agentId = payload.agent_id;
            debateEngine.registerConnection(agentId, socket);
            socket.send(JSON.stringify({ type: 'auth:ok', agent_id: agentId }));
            break;
          }

          // Agent 游戏发言
          case 'game:speak': {
            if (!agentId) return;
            await debateEngine.handleAgentSpeech(data.room_id, agentId, data.content);
            break;
          }

          // 加入对战队列（WebSocket 版）
          case 'debate:queue': {
            if (!agentId) return;
            const result = debateEngine.joinQueue(agentId);
            socket.send(JSON.stringify({ type: 'queue:result', ...result }));
            break;
          }
        }
      } catch (e) {
        fastify.log.error('[WS] 处理消息出错：' + e.message);
      }
    });

    socket.on('close', () => {
      if (agentId) {
        fastify.log.info(`[WS] Agent 断开：${agentId}`);
        // 可以标记 Agent 为离线
      }
    });
  });

  return fastify;
}

async function main() {
  // 连接 Redis
  if (process.env.REDIS_URL) {
    try {
      const redis = createClient({ url: process.env.REDIS_URL });
      await redis.connect();
      setRedis(redis);
      console.log('✅ Redis 已连接');
    } catch (e) {
      console.warn('⚠️  Redis 连接失败，使用内存模式：', e.message);
    }
  }

  const fastify = await buildServer();

  try {
    await fastify.listen({ port: PORT, host: '127.0.0.1' });
    console.log(`\n🦅 AllClaw 后端已启动 → http://127.0.0.1:${PORT}`);
    console.log(`   健康检查：http://127.0.0.1:${PORT}/health\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();

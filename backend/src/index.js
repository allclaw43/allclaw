/**
 * AllClaw Backend - 主服务器
 */
require('./config');

const Fastify = require('fastify');
const { createClient } = require('redis');
const { setRedis } = require('./auth/challenge');
const { probeRoutes } = require('./api/probe');

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

  // WebSocket 实时通信
  fastify.get('/ws', { websocket: true }, (socket) => {
    socket.send(JSON.stringify({ type: 'hello', message: '🦅 欢迎来到 AllClaw！' }));
    socket.on('message', (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        fastify.log.info('[WS] 收到：' + data.type);
        // TODO: 游戏房间路由
      } catch {}
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

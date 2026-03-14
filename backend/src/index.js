/**
 * AllClaw Backend - Main Server
 */
require('./config');

const Fastify = require('fastify');
const { createClient } = require('redis');
const { setRedis } = require('./auth/challenge');
const { probeRoutes } = require('./api/probe');
const { gameRoutes } = require('./api/games');
const { marketRoutes } = require('./api/market');
const dashboardRoutes = require('./api/dashboard');
const rankingsRoutes  = require('./api/rankings');
const adminRoutes     = require('./api/admin');
const pointsRoutes    = require('./api/points');
const oracleRoutes    = require('./api/oracle');
const socraticRoutes  = require('./api/socratic');
const identityRoutes  = require('./api/identity');
const chronicleRoutes = require('./api/chronicle');
const thoughtmapRoutes= require('./api/thoughtmap');
const codeduelRoutes  = require('./api/codeduel');
const allianceRoutes  = require('./api/alliances');
const { soulRoutes }      = require('./api/soul');
const { worldRoutes, refreshCountryWar } = require('./api/world');
const { soulExtendedRoutes } = require('./api/soul-extended');
const { battleRoutes }       = require('./api/battle');
const { generateBriefing, computeReputationTags } = require('./core/world-briefing');
const debateEngine = require('./games/debate/engine');
const { heartbeat, setOffline, sweepOffline } = require('./core/presence');
const botPresence = require('./core/bot-presence');

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

  // Health check
  fastify.get('/health', async () => ({
    status: 'ok',
    service: 'AllClaw API',
    version: '1.1.0',
    timestamp: new Date().toISOString(),
    online_agents: 0, // filled by presence sweep
  }));

  // ── Routes ────────────────────────────────────────────────────
  fastify.register(probeRoutes);
  fastify.register(gameRoutes);
  fastify.register(marketRoutes);
  fastify.register(dashboardRoutes);
  fastify.register(rankingsRoutes);
  fastify.register(adminRoutes);
  fastify.register(pointsRoutes);
  fastify.register(oracleRoutes);
  fastify.register(socraticRoutes);
  fastify.register(identityRoutes);
  fastify.register(chronicleRoutes);
  fastify.register(thoughtmapRoutes);
  fastify.register(codeduelRoutes);
  fastify.register(allianceRoutes);
  fastify.register(soulRoutes);
  fastify.register(worldRoutes);
  fastify.register(soulExtendedRoutes);
  fastify.register(battleRoutes);

  // ── Global WS client registry (for broadcasts) ───────────────
  const wsClients = new Set();
  function broadcastAll(event) {
    const msg = JSON.stringify(event);
    for (const ws of wsClients) {
      if (ws.readyState === 1) ws.send(msg);
    }
  }
  // Inject broadcast into bot presence and expose on fastify instance
  botPresence.setBroadcast(broadcastAll);
  fastify.broadcastAll = broadcastAll;

  // ── WebSocket real-time channel ───────────────────────────────
  fastify.get('/ws', { websocket: true }, (socket, req) => {
    let agentId = null;
    let pingInterval = null;

    wsClients.add(socket);
    socket.send(JSON.stringify({ type: 'hello', message: '🦅 Welcome to AllClaw!', ts: Date.now() }));

    // Heartbeat ticker: ping client every 20s
    pingInterval = setInterval(() => {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
      }
    }, 20000);

    socket.on('message', async (msg) => {
      try {
        const data = JSON.parse(msg.toString());

        switch (data.type) {

          // ── Auth ──────────────────────────────────────────────
          case 'auth': {
            const { verifyJwt } = require('./auth/jwt');
            const payload = verifyJwt(data.token);
            if (!payload) {
              socket.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
              return;
            }
            agentId = payload.agent_id;
            debateEngine.registerConnection(agentId, socket);

            // Mark online
            const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
            await heartbeat(agentId, { ip });

            socket.send(JSON.stringify({ type: 'auth:ok', agent_id: agentId, ts: Date.now() }));
            break;
          }

          // ── Client heartbeat pong ─────────────────────────────
          case 'pong':
          case 'heartbeat': {
            if (!agentId) return;
            await heartbeat(agentId, {
              gameRoom: data.game_room,
              wsConnId: data.ws_conn_id,
            });
            break;
          }

          // ── Agent speech ──────────────────────────────────────
          case 'game:speak': {
            if (!agentId) return;
            await debateEngine.handleAgentSpeech(data.room_id, agentId, data.content);
            break;
          }

          // ── Debate queue ──────────────────────────────────────
          case 'debate:queue': {
            if (!agentId) return;
            const result = debateEngine.joinQueue(agentId);
            socket.send(JSON.stringify({ type: 'queue:result', ...result }));
            break;
          }

          // ── Challenge accepted notify ─────────────────────────
          case 'challenge:accept': {
            // Handled via REST; WS just forwards the notification to recipient
            break;
          }
        }
      } catch (e) {
        fastify.log.error('[WS] message error: ' + e.message);
      }
    });

    socket.on('close', async () => {
      clearInterval(pingInterval);
      wsClients.delete(socket);
      if (agentId) {
        fastify.log.info(`[WS] Agent disconnected: ${agentId}`);
        await setOffline(agentId);
      }
    });

    socket.on('error', () => {
      clearInterval(pingInterval);
    });
  });

  return fastify;
}

async function main() {
  // Connect Redis
  if (process.env.REDIS_URL) {
    try {
      const redis = createClient({ url: process.env.REDIS_URL });
      await redis.connect();
      setRedis(redis);
      console.log('✅ Redis connected');
    } catch (e) {
      console.warn('⚠️  Redis unavailable, falling back to in-memory mode:', e.message);
    }
  }

  const fastify = await buildServer();

  try {
    await fastify.listen({ port: PORT, host: '127.0.0.1' });
    console.log(`\n🦅 AllClaw backend running → http://127.0.0.1:${PORT}`);
    console.log(`   Health: http://127.0.0.1:${PORT}/health`);
    console.log(`   Presence: http://127.0.0.1:${PORT}/api/v1/presence\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  // Sweep stale connections every 30s
  setInterval(sweepOffline, 30000);

  // Start bot presence engine (simulates online/offline patterns)
  botPresence.start();
}

main();

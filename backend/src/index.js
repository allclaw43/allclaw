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
const myAgentRoutes   = require('./api/myagent');
const fundRoutes      = require('./api/fund');
const dailyRewardsRoutes = require('./api/daily-rewards');
const allianceRoutes  = require('./api/alliances');
const { soulRoutes }      = require('./api/soul');
const { worldRoutes, refreshCountryWar } = require('./api/world');
const { soulExtendedRoutes } = require('./api/soul-extended');
const { battleRoutes }       = require('./api/battle');
const { referralRoutes }     = require('./api/referral');
const humanRoutes            = require('./api/human');
const acpRoutes              = require('./api/acp');
const factionRoutes          = require('./api/factions');
const voiceRoutes            = require('./api/voice');
const modelInsightRoutes     = require('./api/models-insight');
const struggleRoutes         = require('./api/struggle');
const humanEconomyRoutes     = require('./api/human-economy');
const exchangeModule         = require('./api/exchange');
const exchangeRoutes         = exchangeModule;
const marketDataRoutes       = require('./api/market-data');
const aiFundsRoutes          = require('./api/ai-funds');
const realMarket             = require('./core/real-market');
const newsEngine             = require('./core/news-engine');
const newsRoutes             = require('./api/news');
const { generateBriefing, computeReputationTags } = require('./core/world-briefing');
const debateEngine = require('./games/debate/engine');
const quizEngine   = require('./games/quiz/engine');
const { heartbeat, setOffline, sweepOffline } = require('./core/presence');
const botPresence = require('./core/bot-presence');
const { seedBotVotes } = require('./games/oracle/engine');
const { runDailyTick } = require('./core/daily-engine');

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
  fastify.register(myAgentRoutes);
  fastify.register(fundRoutes);
  fastify.register(dailyRewardsRoutes);
  fastify.register(allianceRoutes);
  fastify.register(soulRoutes);
  fastify.register(worldRoutes);
  fastify.register(soulExtendedRoutes);
  fastify.register(battleRoutes);
  fastify.register(referralRoutes);
  fastify.register(humanRoutes);
  fastify.register(acpRoutes);
  fastify.register(factionRoutes);
  fastify.register(voiceRoutes);
  fastify.register(modelInsightRoutes);
  fastify.register(struggleRoutes);
  fastify.register(humanEconomyRoutes);
  fastify.register(exchangeRoutes);
  fastify.register(marketDataRoutes);
  fastify.register(aiFundsRoutes);
  fastify.register(newsRoutes);

  // ── Init quiz engine with DB + settle ────────────────────────
  const { settleGame } = require('./core/points-engine');
  quizEngine.setDb(fastify.pg);
  quizEngine.setSettle(settleGame);

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
  exchangeModule.setBroadcast(broadcastAll);
  const aiTrader = require('./core/ai-trader');
  aiTrader.setBroadcast(broadcastAll);
  aiTrader.start().catch(e => console.error('[AITrader] Start failed:', e.message));
  realMarket.setBroadcast(broadcastAll);
  realMarket.start().catch(e => console.error('[RealMarket] Start failed:', e.message));
  newsEngine.setBroadcast(broadcastAll);
  newsEngine.setAiTrader(require('./core/ai-trader'));
  newsEngine.start().catch(e => console.error('[NewsEngine] Start failed:', e.message));
  fastify.broadcastAll = broadcastAll;

  // ── WebSocket real-time channel ───────────────────────────────
  // @fastify/websocket v10 requires WS routes inside a plugin scope
  fastify.register(async function wsPlugin(f) {
  f.get('/ws', { websocket: true }, (socket, req) => {
    let agentId = null;
    let pingInterval = null;

    wsClients.add(socket);
    // Delay hello to ensure WS is fully open
    setImmediate(() => {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'hello', message: 'Welcome to AllClaw!', ts: Date.now() }));
      }
    });

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

          // ── Quiz queue ────────────────────────────────────────
          case 'quiz:queue': {
            if (!agentId) return;
            quizEngine.registerConnection(agentId, socket);
            const result = quizEngine.joinQueue(agentId);
            socket.send(JSON.stringify({ type: 'quiz:queue_result', ...result }));
            break;
          }

          // ── Quiz answer ───────────────────────────────────────
          case 'quiz:answer': {
            if (!agentId) return;
            quizEngine.handleAnswer(data.room_id, agentId, data.answer);
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
  }); // end f.get('/ws')
  }); // end fastify.register(wsPlugin)

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

  // Bot presence engine
  botPresence.start();

  // Oracle bot votes — seed once on start, then every 6 hours
  setTimeout(() => seedBotVotes().catch(console.error), 5000);
  setInterval(() => seedBotVotes().catch(console.error), 6 * 60 * 60 * 1000);

  // Daily survival engine — run once at startup, then every 6 hours
  setTimeout(() => runDailyTick().catch(console.error), 10000);
  setInterval(() => runDailyTick().catch(console.error), 6 * 60 * 60 * 1000);

  // Refresh country war stats every 10 min
  setInterval(() => refreshCountryWar().catch(console.error), 10 * 60 * 1000);
}

main();

/**
 * AllClaw — News API Routes
 *
 * GET  /api/v1/news/latest        latest crawl result (cached)
 * GET  /api/v1/news/history       last N snapshots from DB
 * POST /api/v1/news/refresh       trigger immediate crawl (admin)
 */

const newsEngine = require('../core/news-engine');
const db         = require('../db/pool');

module.exports = async function newsRoutes(fastify) {

  // ── GET /api/v1/news/latest ──────────────────────────────────
  fastify.get('/api/v1/news/latest', async (req, reply) => {
    const cached = newsEngine.getCache();
    if (cached) return reply.send(cached);

    // Fallback: last DB snapshot
    try {
      const { rows: [last] } = await db.query(
        `SELECT * FROM news_snapshots ORDER BY created_at DESC LIMIT 1`
      );
      if (last) {
        return reply.send({
          market_mood:     last.market_mood,
          mood_score:      parseFloat(last.mood_score),
          ai_score:        parseFloat(last.ai_score),
          crypto_score:    parseFloat(last.crypto_score),
          total_headlines: last.headline_count,
          sources:         last.sources,
          headlines:       last.headlines,
          timestamp:       last.created_at,
          from_cache:      true,
        });
      }
    } catch(e) { /* table may not exist yet */ }

    reply.send({ market_mood: 'neutral', mood_score: 0, headlines: [], sources: [] });
  });

  // ── GET /api/v1/news/history ─────────────────────────────────
  fastify.get('/api/v1/news/history', async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit)||24, 48);
    try {
      const { rows } = await db.query(`
        SELECT id, market_mood, mood_score, ai_score, crypto_score,
               headline_count, sources, created_at
        FROM news_snapshots
        ORDER BY created_at DESC LIMIT $1
      `, [limit]);
      reply.send({ history: rows });
    } catch(e) {
      reply.send({ history: [] });
    }
  });

  // ── POST /api/v1/news/refresh ────────────────────────────────
  fastify.post('/api/v1/news/refresh', async (req, reply) => {
    newsEngine.refresh().catch(e => console.error('[News refresh]', e.message));
    reply.send({ ok: true, message: 'Crawl triggered' });
  });

};

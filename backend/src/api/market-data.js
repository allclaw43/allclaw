/**
 * AllClaw — Market Data API
 *
 * Provides stock-market-style data for the ASX:
 *   GET /api/v1/market/candles/:agentId?interval=1m|5m|1h  → OHLC candles
 *   GET /api/v1/market/orderbook/:agentId                  → bid/ask depth
 *   GET /api/v1/market/ticker/:agentId                     → live ticker
 *   GET /api/v1/market/overview                            → market overview
 *   POST /api/v1/market/seed-trades                        → seed demo trade history
 */

const db = require('../db/pool');

let _broadcast = null;
function setBroadcast(fn) { _broadcast = fn; }

// ── Helpers ─────────────────────────────────────────────────────

// Generate realistic OHLC from price_24h → current price
function generateCandles(basePrice, currentPrice, count = 30, intervalMs = 5 * 60 * 1000) {
  const candles = [];
  const now = Date.now();
  let price = parseFloat(basePrice) || 10;
  const target = parseFloat(currentPrice) || price;
  const step = (target - price) / count;
  const volatility = price * 0.012; // 1.2% per candle max swing

  for (let i = 0; i < count; i++) {
    const ts = now - (count - i) * intervalMs;
    const drift = step + (Math.random() - 0.5) * volatility;
    const open  = parseFloat(price.toFixed(2));
    const change = drift + (Math.random() - 0.48) * volatility;
    price = Math.max(1.0, price + change);
    const close = parseFloat(price.toFixed(2));
    const swing = Math.abs(change) + Math.random() * volatility * 0.5;
    const high  = parseFloat((Math.max(open, close) + swing * 0.6).toFixed(2));
    const low   = parseFloat((Math.min(open, close) - swing * 0.4).toFixed(2));
    const vol   = Math.floor(Math.random() * 20 + 2);
    candles.push({ ts, open, high, low, close, volume: vol });
  }
  return candles;
}

// Generate bid/ask order book depth
function generateOrderBook(currentPrice, spread = 0.15) {
  const price = parseFloat(currentPrice) || 10;
  const bids = [];
  const asks = [];

  let bidPrice = price * (1 - 0.002);
  let askPrice = price * (1 + 0.002);

  for (let i = 0; i < 8; i++) {
    const vol = Math.floor(Math.random() * 50 + 5);
    bids.push({ price: parseFloat(bidPrice.toFixed(2)), volume: vol });
    bidPrice *= (1 - 0.004 - Math.random() * 0.003);
  }
  for (let i = 0; i < 8; i++) {
    const vol = Math.floor(Math.random() * 50 + 5);
    asks.push({ price: parseFloat(askPrice.toFixed(2)), volume: vol });
    askPrice *= (1 + 0.004 + Math.random() * 0.003);
  }

  const maxVol = Math.max(...bids.map(b => b.volume), ...asks.map(a => a.volume));
  return {
    bids: bids.map(b => ({ ...b, pct: Math.round(b.volume / maxVol * 100) })),
    asks: asks.map(a => ({ ...a, pct: Math.round(a.volume / maxVol * 100) })),
  };
}

module.exports = async function marketDataRoutes(fastify) {

  // ── GET /api/v1/market/overview ──────────────────────────────
  fastify.get('/api/v1/market/overview', async (req, reply) => {
    const { rows: listings } = await db.query(`
      SELECT s.agent_id, COALESCE(a.custom_name,a.display_name) AS name,
        s.price, s.price_24h, s.volume_24h, s.available, s.total_supply,
        a.elo_rating, a.wins, a.losses,
        COALESCE(f.color,'#94a3b8') AS faction_color,
        COALESCE(f.symbol,'') AS faction_symbol,
        (a.last_seen > NOW()-INTERVAL '5 minutes') AS is_online
      FROM agent_shares s
      JOIN agents a ON a.agent_id=s.agent_id
      LEFT JOIN factions f ON f.slug=a.faction
      ORDER BY s.market_cap DESC
      LIMIT 30
    `);

    // Market stats
    const totalMcap    = listings.reduce((s,l) => s + parseFloat(l.price) * (l.total_supply||1000), 0);
    const totalVolume  = listings.reduce((s,l) => s + parseInt(l.volume_24h || 0), 0);
    const gainers      = listings.filter(l => parseFloat(l.price) > parseFloat(l.price_24h)).length;
    const losers       = listings.filter(l => parseFloat(l.price) < parseFloat(l.price_24h)).length;

    reply.send({
      listings: listings.map(l => ({
        ...l,
        market_cap: parseFloat((parseFloat(l.price) * (l.total_supply||1000)).toFixed(2)),
        change_pct: l.price_24h
          ? parseFloat(((parseFloat(l.price) - parseFloat(l.price_24h)) / parseFloat(l.price_24h) * 100).toFixed(2))
          : 0,
      })),
      market: {
        total_mcap:    parseFloat(totalMcap.toFixed(2)),
        total_volume:  totalVolume,
        gainers,
        losers,
        unchanged:     listings.length - gainers - losers,
        total_listed:  listings.length,
      },
    });
  });

  // ── GET /api/v1/market/candles/:agentId ─────────────────────
  fastify.get('/api/v1/market/candles/:agentId', async (req, reply) => {
    const { agentId } = req.params;
    const interval = req.query.interval || '5m';

    const intervalMs = interval === '1m'  ? 60000
                     : interval === '5m'  ? 300000
                     : interval === '15m' ? 900000
                     : interval === '1h'  ? 3600000
                     : 300000;

    const { rows: [share] } = await db.query(
      `SELECT s.price, s.price_24h, COALESCE(a.custom_name,a.display_name) AS name
       FROM agent_shares s JOIN agents a ON a.agent_id=s.agent_id
       WHERE s.agent_id=$1`, [agentId]
    );
    if (!share) return reply.status(404).send({ error: 'Not found' });

    // Try to build candles from actual trade history
    const { rows: trades } = await db.query(`
      SELECT price, shares, created_at
      FROM share_trades WHERE agent_id=$1
      ORDER BY created_at ASC LIMIT 200
    `, [agentId]);

    let candles;
    if (trades.length >= 3) {
      // Build real OHLC from trades
      const buckets = {};
      trades.forEach(t => {
        const bucket = Math.floor(new Date(t.created_at).getTime() / intervalMs) * intervalMs;
        if (!buckets[bucket]) buckets[bucket] = [];
        buckets[bucket].push(parseFloat(t.price));
      });
      candles = Object.entries(buckets).map(([ts, prices]) => ({
        ts: parseInt(ts),
        open:   prices[0],
        close:  prices[prices.length - 1],
        high:   Math.max(...prices),
        low:    Math.min(...prices),
        volume: prices.length,
      })).sort((a,b) => a.ts - b.ts);
    } else {
      // Generate synthetic candles
      candles = generateCandles(share.price_24h || share.price, share.price, 30, intervalMs);
    }

    reply.send({ agent_id: agentId, name: share.name, interval, candles });
  });

  // ── GET /api/v1/market/orderbook/:agentId ───────────────────
  fastify.get('/api/v1/market/orderbook/:agentId', async (req, reply) => {
    const { rows: [share] } = await db.query(
      `SELECT s.price, s.available FROM agent_shares s WHERE s.agent_id=$1`,
      [req.params.agentId]
    );
    if (!share) return reply.status(404).send({ error: 'Not found' });

    // Get actual holders as reference for bid side
    const { rows: holders } = await db.query(`
      SELECT shares, avg_cost FROM share_holdings
      WHERE agent_id=$1 AND shares>0 ORDER BY avg_cost ASC LIMIT 5
    `, [req.params.agentId]);

    const book = generateOrderBook(share.price);

    // Override top bid with actual holder avg costs if available
    if (holders.length > 0) {
      book.bids[0] = {
        price:  parseFloat((parseFloat(share.price) * 0.998).toFixed(2)),
        volume: holders[0].shares,
        pct: 80,
      };
    }

    reply.send({
      agent_id:      req.params.agentId,
      current_price: parseFloat(share.price),
      available:     share.available,
      ...book,
    });
  });

  // ── GET /api/v1/market/ticker/:agentId ──────────────────────
  fastify.get('/api/v1/market/ticker/:agentId', async (req, reply) => {
    const { rows: [row] } = await db.query(`
      SELECT s.price, s.price_24h, s.volume_24h, s.available, s.total_shares,
        a.elo_rating, a.wins, a.losses,
        COALESCE(a.custom_name,a.display_name) AS name
      FROM agent_shares s JOIN agents a ON a.agent_id=s.agent_id
      WHERE s.agent_id=$1
    `, [req.params.agentId]);
    if (!row) return reply.status(404).send({ error: 'Not found' });

    const price    = parseFloat(row.price);
    const price24h = parseFloat(row.price_24h) || price;
    const chgAbs   = parseFloat((price - price24h).toFixed(2));
    const chgPct   = parseFloat(((chgAbs / price24h) * 100).toFixed(2));

    reply.send({
      agent_id:    req.params.agentId,
      name:        row.name,
      price,
      price_24h:   price24h,
      change_abs:  chgAbs,
      change_pct:  chgPct,
      volume_24h:  parseInt(row.volume_24h || 0),
      available:   row.available,
      total_supply: row.total_supply,
      market_cap:  parseFloat((price * (row.total_supply||1000)).toFixed(2)),
      elo_rating:  row.elo_rating,
      win_rate:    row.wins + row.losses > 0
                   ? parseFloat((row.wins / (row.wins + row.losses) * 100).toFixed(1))
                   : 50,
    });
  });

  // ── POST /api/v1/market/seed-trades ─────────────────────────
  // Generates synthetic trade history so charts have data
  fastify.post('/api/v1/market/seed-trades', async (req, reply) => {
    const { rows: listings } = await db.query(
      `SELECT agent_id, price, price_24h FROM agent_shares LIMIT 10`
    );

    let count = 0;
    for (const l of listings) {
      const base = parseFloat(l.price_24h) || parseFloat(l.price) * 0.92;
      const candles = generateCandles(base, l.price, 20, 5 * 60 * 1000);

      for (const c of candles) {
        const shares = Math.floor(Math.random() * 5 + 1);
        await db.query(
          `INSERT INTO share_trades (agent_id, buyer, shares, price, total_cost, trade_type, created_at)
           VALUES ($1, 'market-maker', $2, $3, $4, 'buy', to_timestamp($5/1000.0))
           ON CONFLICT DO NOTHING`,
          [l.agent_id, shares, c.close, parseFloat((c.close*shares).toFixed(2)), c.ts]
        );
        count++;
      }
    }
    reply.send({ ok: true, inserted: count });
  });

};

module.exports.setBroadcast = setBroadcast;

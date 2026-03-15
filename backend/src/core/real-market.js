/**
 * AllClaw — Real Market Data Engine
 *
 * Fetches real stock/crypto prices from Yahoo Finance (no API key needed).
 * Updates every 3 minutes during market hours, every 15 min otherwise.
 *
 * Symbols tracked (mix of tech + crypto for relevance to AI world):
 *   Tech:   AAPL TSLA GOOGL MSFT NVDA AMZN META NFLX
 *   Crypto: BTC-USD ETH-USD SOL-USD
 *   Index:  SPY QQQ
 */

const db          = require('../db/pool');
const https       = require('https');
const priceEngine = require('./price-engine');

const SYMBOLS = [
  // Tech — these signal "AI sentiment" in the real world
  'AAPL','TSLA','GOOGL','MSFT','NVDA','AMZN','META','NFLX',
  // Crypto — mirrors AI agent decentralization narrative
  'BTC-USD','ETH-USD','SOL-USD',
  // Index — macro signal
  'SPY','QQQ',
];

const SYMBOL_META = {
  'AAPL':    { name:'Apple',     icon:'🍎', sector:'tech'   },
  'TSLA':    { name:'Tesla',     icon:'⚡', sector:'ev'     },
  'GOOGL':   { name:'Alphabet',  icon:'🔍', sector:'tech'   },
  'MSFT':    { name:'Microsoft', icon:'🪟', sector:'tech'   },
  'NVDA':    { name:'NVIDIA',    icon:'🎮', sector:'ai'     },
  'AMZN':    { name:'Amazon',    icon:'📦', sector:'cloud'  },
  'META':    { name:'Meta',      icon:'👾', sector:'social' },
  'NFLX':    { name:'Netflix',   icon:'🎬', sector:'media'  },
  'BTC-USD': { name:'Bitcoin',   icon:'₿',  sector:'crypto' },
  'ETH-USD': { name:'Ethereum',  icon:'Ξ',  sector:'crypto' },
  'SOL-USD': { name:'Solana',    icon:'◎',  sector:'crypto' },
  'SPY':     { name:'S&P 500',   icon:'📊', sector:'index'  },
  'QQQ':     { name:'NASDAQ',    icon:'🖥', sector:'index'  },
};

let _cache    = [];        // latest price data
let _broadcast = null;

function setBroadcast(fn) {
  _broadcast = fn;
  priceEngine.setBroadcast(fn);  // wire price engine to same broadcast
}
function getCache() { return _cache; }

// Stooq fetch for a single stock symbol (e.g. AAPL → aapl.us)
function fetchStooq(symbol) {
  const stooqSym = symbol.toLowerCase().replace('-', '.') + '.us';
  return new Promise((resolve) => {
    const opts = {
      hostname: 'stooq.com',
      path:     `/q/l/?s=${stooqSym}&f=sd2t2ohlcvn&e=csv`,
      headers:  { 'User-Agent': 'Mozilla/5.0' },
      timeout:  8000,
    };
    const req = https.get(opts, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          // CSV format: SYMBOL,Date,Time,Open,High,Low,Close,Volume,Name
          const lines = body.trim().split('\n');
          // Stooq returns 1 line (no header): SYMBOL,Date,Time,Open,High,Low,Close,Vol,Name
          const lastLine = lines[lines.length - 1];
          const parts = lastLine.split(',');
          if (parts.length < 7 || parts[6] === 'N/D' || parts[6] === '') return resolve(null);
          const curr  = parseFloat(parts[6]);
          const open_ = parseFloat(parts[3]);
          const chg   = parseFloat(((curr - open_) / open_ * 100).toFixed(2));
          const m     = SYMBOL_META[symbol] || { name: symbol, icon:'📈', sector:'other' };
          resolve({
            symbol,
            name:       m.name,
            icon:       m.icon,
            sector:     m.sector,
            price:      curr,
            prev_close: open_,
            change_pct: chg,
            change_abs: parseFloat((curr - open_).toFixed(2)),
            currency:   'USD',
            market:     'NASDAQ',
            updated_at: Date.now(),
          });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// CoinGecko fetch for crypto (no rate limit for basic)
function fetchCrypto() {
  return new Promise((resolve) => {
    const CRYPTO_MAP = {
      'bitcoin': 'BTC-USD', 'ethereum': 'ETH-USD', 'solana': 'SOL-USD'
    };
    const opts = {
      hostname: 'api.coingecko.com',
      path:     '/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true',
      headers:  { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      timeout:  8000,
    };
    const req = https.get(opts, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const d = JSON.parse(body);
          const results = [];
          for (const [id, symbol] of Object.entries(CRYPTO_MAP)) {
            if (!d[id]) continue;
            const price = d[id].usd;
            const chg   = parseFloat((d[id].usd_24h_change || 0).toFixed(2));
            const prev  = parseFloat((price / (1 + chg/100)).toFixed(2));
            const m     = SYMBOL_META[symbol];
            results.push({
              symbol, name:m.name, icon:m.icon, sector:m.sector,
              price, prev_close:prev, change_pct:chg,
              change_abs: parseFloat((price - prev).toFixed(2)),
              currency:'USD', market:'Crypto', updated_at:Date.now(),
            });
          }
          resolve(results);
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

// Fetch single symbol (stock via stooq)
function fetchSymbol(symbol) {
  return fetchStooq(symbol);
}

// Stock symbols for stooq
const STOCK_SYMBOLS = ['AAPL','TSLA','GOOGL','MSFT','NVDA','AMZN','META','NFLX','SPY','QQQ'];

// Fetch all symbols
async function fetchAll() {
  const results = [];
  // Stocks via Stooq
  for (const sym of STOCK_SYMBOLS) {
    const data = await fetchSymbol(sym);
    if (data) results.push(data);
    await new Promise(r => setTimeout(r, 400)); // 400ms between requests
  }
  // Crypto via CoinGecko
  const crypto = await fetchCrypto();
  results.push(...crypto);
  return results;
}

// Save to DB and broadcast
async function refresh() {
  try {
    const data = await fetchAll();
    if (!data.length) return;

    _cache = data;

    // Upsert to real_market_prices table + append price_history
    const now = Date.now();
    for (const d of data) {
      // Append price point to history (keep last 480 points = ~24h at 3min interval)
      const histPoint = JSON.stringify({ t: now, p: d.price, c: d.change_pct });
      await db.query(`
        INSERT INTO real_market_prices
          (symbol, name, icon, sector, price, prev_close, change_pct, change_abs, currency, updated_at, price_history)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(), jsonb_build_array($10::jsonb))
        ON CONFLICT (symbol) DO UPDATE SET
          price=EXCLUDED.price,
          prev_close=EXCLUDED.prev_close,
          change_pct=EXCLUDED.change_pct,
          change_abs=EXCLUDED.change_abs,
          updated_at=NOW(),
          price_history=(
            SELECT jsonb_agg(x) FROM (
              SELECT x FROM jsonb_array_elements(
                COALESCE(real_market_prices.price_history,'[]'::jsonb) || jsonb_build_array($10::jsonb)
              ) AS x
              ORDER BY (x->>'t')::bigint DESC
              LIMIT 480
            ) sub
          )
      `, [d.symbol, d.name, d.icon, d.sector, d.price, d.prev_close, d.change_pct, d.change_abs, d.currency, histPoint]);
    }

    // Broadcast via WS
    if (_broadcast) {
      _broadcast({ type: 'platform:market_update', data, timestamp: Date.now() });
    }

    // ── PRIMARY: Price Engine — maps real market returns to Agent prices
    await priceEngine.tick(data);

    // Apply market signal to AI fund portfolios (fund managers rebalance)
    await applyMarketSignal(data);

    // Notify AI trader about market signal (triggers bot trades for liquidity)
    try {
      const sig = (data.find(d=>d.symbol==='SPY')?.change_pct||0)*0.5
                + (data.find(d=>d.symbol==='NVDA')?.change_pct||0)*0.3
                + (data.find(d=>d.symbol==='BTC-USD')?.change_pct||0)*0.2;
      if (Math.abs(sig) > 0.3) {
        const aiTrader = require('./ai-trader');
        await aiTrader.onMarketSignal(sig);
      }
    } catch(e) { /* optional */ }

    console.log(`[RealMarket] Refreshed ${data.length} symbols. SPY=${data.find(d=>d.symbol==='SPY')?.change_pct}%`);
  } catch (e) {
    console.error('[RealMarket] Error:', e.message);
  }
}

// ── Market Signal → AI Agent prices ─────────────────────────────
// Map real market sentiment to AI agent trading behavior.
// Rule: macro signal drives AI fund managers to buy/sell AI stocks.
//   SPY > 0    → risk-on  → buy AI growth agents
//   SPY < -1%  → risk-off → sell volatile agents
//   NVDA       → AI sector signal
//   BTC        → risk appetite signal
async function applyMarketSignal(data) {
  const spy  = data.find(d => d.symbol === 'SPY');
  const nvda = data.find(d => d.symbol === 'NVDA');
  const btc  = data.find(d => d.symbol === 'BTC-USD');

  if (!spy) return;

  const sentiment = spy.change_pct;   // e.g. -0.57
  const aiSignal  = nvda?.change_pct || 0;
  const riskSignal= btc?.change_pct  || 0;

  // Composite signal: 50% macro + 30% AI sector + 20% crypto risk appetite
  const composite = sentiment * 0.5 + aiSignal * 0.3 + riskSignal * 0.2;

  // Update AI fund portfolios based on signal
  try {
    const { rows: funds } = await db.query(
      `SELECT * FROM ai_funds WHERE is_active=TRUE`
    );
    for (const fund of funds) {
      await executeFundStrategy(fund, composite, data);
    }
  } catch { /* ai_funds table may not exist yet */ }
}

async function executeFundStrategy(fund, composite, marketData) {
  // Each fund has a strategy: aggressive/balanced/conservative
  const multiplier = {
    aggressive:   1.5,
    balanced:     1.0,
    conservative: 0.5,
    contrarian:  -1.0,  // inverse — bets against market
  }[fund.strategy] || 1.0;

  const signal = composite * multiplier;

  // signal > 0.5: buy top ELO agents
  // signal < -0.5: sell losers
  if (signal > 0.5) {
    // Buy: find agents not yet in portfolio
    const { rows: targets } = await db.query(`
      SELECT s.agent_id, s.price, s.available
      FROM agent_shares s
      JOIN agents a ON a.agent_id=s.agent_id
      WHERE s.available >= 2
        AND s.agent_id NOT IN (
          SELECT agent_id FROM ai_fund_positions WHERE fund_id=$1 AND shares>0
        )
      ORDER BY a.elo_rating DESC LIMIT 3
    `, [fund.id]);

    for (const t of targets) {
      const spend = Math.min(fund.available_hip * 0.1, t.price * 5);
      if (spend < t.price) continue;
      const shares = Math.floor(spend / t.price);
      if (shares < 1) continue;

      await db.query(`
        INSERT INTO ai_fund_positions (fund_id, agent_id, shares, avg_cost)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (fund_id, agent_id) DO UPDATE SET
          shares = ai_fund_positions.shares + EXCLUDED.shares,
          avg_cost = (ai_fund_positions.avg_cost * ai_fund_positions.shares + EXCLUDED.avg_cost * EXCLUDED.shares)
                     / (ai_fund_positions.shares + EXCLUDED.shares)
      `, [fund.id, t.agent_id, shares, t.price]);

      await db.query(
        `UPDATE ai_funds SET available_hip=available_hip-$1 WHERE id=$2`,
        [shares * t.price, fund.id]
      );
      await db.query(
        `UPDATE agent_shares SET available=available-$1, price=GREATEST(1.0,price*(1+$2/100.0)) WHERE agent_id=$3`,
        [shares, Math.abs(signal) * 0.1, t.agent_id]
      );
    }
  } else if (signal < -0.5) {
    // Sell worst performers
    const { rows: positions } = await db.query(`
      SELECT p.agent_id, p.shares, s.price,
        (s.price - p.avg_cost) / p.avg_cost * 100 AS return_pct
      FROM ai_fund_positions p
      JOIN agent_shares s ON s.agent_id=p.agent_id
      WHERE p.fund_id=$1 AND p.shares>0
      ORDER BY return_pct ASC LIMIT 2
    `, [fund.id]);

    for (const pos of positions) {
      const sellShares = Math.ceil(pos.shares * 0.5);
      const proceeds = sellShares * pos.price;
      await db.query(
        `UPDATE ai_fund_positions SET shares=shares-$1 WHERE fund_id=$2 AND agent_id=$3`,
        [sellShares, fund.id, pos.agent_id]
      );
      await db.query(
        `UPDATE ai_funds SET available_hip=available_hip+$1 WHERE id=$2`,
        [proceeds, fund.id]
      );
      await db.query(
        `UPDATE agent_shares SET available=available+$1, price=GREATEST(1.0,price*(1-$2/100.0)) WHERE agent_id=$3`,
        [sellShares, Math.abs(signal) * 0.08, pos.agent_id]
      );
    }
  }

  // Recalculate fund NAV
  await recalcFundNAV(fund.id);
}

async function recalcFundNAV(fundId) {
  const { rows: [fund] } = await db.query(
    `SELECT * FROM ai_funds WHERE id=$1`, [fundId]
  );
  if (!fund) return;

  const { rows: positions } = await db.query(`
    SELECT p.shares, s.price
    FROM ai_fund_positions p
    JOIN agent_shares s ON s.agent_id=p.agent_id
    WHERE p.fund_id=$1 AND p.shares>0
  `, [fundId]);

  const positionValue = positions.reduce((s, p) => s + p.shares * parseFloat(p.price), 0);
  const nav = parseFloat((fund.available_hip + positionValue).toFixed(2));
  const ret = parseFloat(((nav - fund.initial_hip) / fund.initial_hip * 100).toFixed(2));

  await db.query(
    `UPDATE ai_funds SET current_nav=$1, total_return_pct=$2, updated_at=NOW() WHERE id=$3`,
    [nav, ret, fundId]
  );

  if (_broadcast) {
    _broadcast({
      type:       'platform:fund_update',
      fund_id:    fundId,
      fund_name:  fund.name,
      agent_id:   fund.manager_agent_id,
      nav,
      return_pct: ret,
      timestamp:  Date.now(),
    });
  }
}

// ── DB Schema init ────────────────────────────────────────────────
async function ensureTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS real_market_prices (
      symbol      VARCHAR(16) PRIMARY KEY,
      name        VARCHAR(64),
      icon        VARCHAR(8),
      sector      VARCHAR(32),
      price       NUMERIC(14,4),
      prev_close  NUMERIC(14,4),
      change_pct  NUMERIC(8,4),
      change_abs  NUMERIC(14,4),
      currency    VARCHAR(8) DEFAULT 'USD',
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ai_funds (
      id                  SERIAL PRIMARY KEY,
      owner_handle        VARCHAR(64) NOT NULL,
      manager_agent_id    VARCHAR(64) REFERENCES agents(agent_id),
      name                VARCHAR(128),
      strategy            VARCHAR(32) DEFAULT 'balanced',
      initial_hip         NUMERIC(14,2) DEFAULT 0,
      available_hip       NUMERIC(14,2) DEFAULT 0,
      current_nav         NUMERIC(14,2) DEFAULT 0,
      total_return_pct    NUMERIC(8,4)  DEFAULT 0,
      is_active           BOOLEAN DEFAULT TRUE,
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      updated_at          TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ai_fund_positions (
      id         SERIAL PRIMARY KEY,
      fund_id    INTEGER REFERENCES ai_funds(id),
      agent_id   VARCHAR(64) REFERENCES agents(agent_id),
      shares     INTEGER DEFAULT 0,
      avg_cost   NUMERIC(14,4) DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(fund_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS ai_fund_transactions (
      id          SERIAL PRIMARY KEY,
      fund_id     INTEGER REFERENCES ai_funds(id),
      tx_type     VARCHAR(32),  -- deposit/withdraw/buy/sell/dividend
      amount      NUMERIC(14,2),
      agent_id    VARCHAR(64),
      shares      INTEGER,
      price       NUMERIC(14,4),
      signal      NUMERIC(8,4), -- market signal that triggered this
      memo        TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('[RealMarket] Tables ready');
}

// ── Start scheduler ──────────────────────────────────────────────
async function start() {
  await ensureTables();
  await priceEngine.ensureSchema();  // add market_profile columns
  await refresh();  // immediate first run — also triggers first price tick

  // Check if market hours (US Eastern: 9:30-16:00 weekdays)
  function intervalMs() {
    const now = new Date();
    const hour = now.getUTCHours() - 4; // approximate ET
    const day = now.getUTCDay();
    const isWeekend = day === 0 || day === 6;
    const isMarketHours = !isWeekend && hour >= 9 && hour < 16;
    return isMarketHours ? 3 * 60 * 1000 : 15 * 60 * 1000;
  }

  let timer = setInterval(refresh, intervalMs());
  setInterval(() => {
    clearInterval(timer);
    timer = setInterval(refresh, intervalMs());
  }, 60 * 60 * 1000); // recalculate interval every hour
}

module.exports = { start, setBroadcast, getCache, refresh, recalcFundNAV };

/**
 * AllClaw — Agent Price Engine
 *
 * DESIGN PRINCIPLE:
 *   AI Agent shares behave like real stocks. Their price tracks real market
 *   movements (SPY, NVDA, BTC) adjusted by each Agent's "market profile" —
 *   a set of sensitivity weights assigned at listing time.
 *
 * PRICE FORMULA (per market refresh):
 *   delta_pct = Σ (weight_i × market_return_i) + elo_alpha + noise
 *   new_price  = old_price × (1 + delta_pct / 100)
 *
 * MARKET PROFILES (assigned randomly at listing, fixed):
 *   ai_pure      → heavy NVDA (0.6) + SPY (0.3) + BTC (0.1)
 *   crypto_native→ heavy BTC (0.5) + ETH (0.3) + NVDA (0.2)
 *   tech_growth  → SPY (0.4) + NVDA (0.3) + QQQ (0.3)
 *   contrarian   → inverted SPY (-0.5) + BTC (0.3) + ETH (0.2)
 *   momentum     → TSLA (0.4) + NVDA (0.3) + ETH (0.3)
 *   defensive    → SPY (0.2) + QQQ (0.1) + cash noise
 *
 * ELO ALPHA:
 *   win streak > 3 games → +0.2% per refresh
 *   ELO > 1100           → +0.1%
 *   ELO < 900            → -0.1%
 *
 * NOISE:
 *   ±0.1% gaussian noise (realistic microstructure)
 *
 * PRICE BOUNDS:
 *   min: 1.0 HIP  (floor, no agent goes to zero)
 *   max: no cap   (let winners run)
 *   single-update cap: ±5% per cycle (circuit breaker)
 */

const db = require('../db/pool');

let _broadcast = null;
function setBroadcast(fn) { _broadcast = fn; }

// ── Market Profile definitions ───────────────────────────────────
const PROFILES = {
  ai_pure: {
    label: 'AI Pure',
    icon: '🤖',
    weights: { 'NVDA': 0.60, 'SPY': 0.30, 'BTC-USD': 0.10 },
  },
  crypto_native: {
    label: 'Crypto Native',
    icon: '₿',
    weights: { 'BTC-USD': 0.50, 'ETH-USD': 0.30, 'NVDA': 0.20 },
  },
  tech_growth: {
    label: 'Tech Growth',
    icon: '🚀',
    weights: { 'SPY': 0.40, 'NVDA': 0.30, 'QQQ': 0.30 },
  },
  contrarian: {
    label: 'Contrarian',
    icon: '🔄',
    // Bets against the market — goes up when SPY goes down
    weights: { 'SPY': -0.50, 'BTC-USD': 0.30, 'ETH-USD': 0.20 },
  },
  momentum: {
    label: 'Momentum',
    icon: '⚡',
    weights: { 'TSLA': 0.40, 'NVDA': 0.30, 'ETH-USD': 0.30 },
  },
  defensive: {
    label: 'Defensive',
    icon: '🛡',
    weights: { 'SPY': 0.20, 'QQQ': 0.10 },
    baseDrift: 0.05, // small positive drift per cycle (stable)
  },
};

const PROFILE_KEYS = Object.keys(PROFILES);

// ── Ensure schema ────────────────────────────────────────────────
async function ensureSchema() {
  await db.query(`
    ALTER TABLE agent_shares
      ADD COLUMN IF NOT EXISTS market_profile  VARCHAR(32)  DEFAULT 'tech_growth',
      ADD COLUMN IF NOT EXISTS beta            NUMERIC(6,3) DEFAULT 1.0,
      ADD COLUMN IF NOT EXISTS price_history   JSONB        DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS last_price_tick TIMESTAMPTZ;
  `);

  // Give existing agents a profile if they don't have one
  await db.query(`
    UPDATE agent_shares
    SET market_profile = (ARRAY['ai_pure','crypto_native','tech_growth','contrarian','momentum','defensive'])
                         [1 + (EXTRACT(EPOCH FROM NOW())::bigint + hashtext(agent_id)) % 6],
        beta = 0.6 + random() * 0.9
    WHERE market_profile IS NULL OR market_profile = 'tech_growth' AND beta = 1.0
  `);

  console.log('[PriceEngine] Schema ready');
}

// ── Gaussian noise ───────────────────────────────────────────────
function gaussianNoise(sigma = 0.1) {
  // Box-Muller transform
  const u1 = Math.random(), u2 = Math.random();
  return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ── Main tick — called after every real market refresh ───────────
async function tick(marketData) {
  if (!marketData || !marketData.length) return;

  // Build lookup: symbol → change_pct
  const mkt = {};
  for (const d of marketData) {
    mkt[d.symbol] = parseFloat(d.change_pct) || 0;
  }

  // Get all listed agents with their profiles
  const { rows: agents } = await db.query(`
    SELECT s.agent_id, s.price, s.price_24h, s.market_profile, s.beta,
           a.elo_rating, a.wins, a.losses, a.streak AS win_streak,
           COALESCE(a.custom_name, a.display_name) AS name
    FROM agent_shares s
    JOIN agents a ON a.agent_id = s.agent_id
    WHERE s.price IS NOT NULL
  `);

  if (!agents.length) return;

  const updates = [];

  for (const agent of agents) {
    const profile = PROFILES[agent.market_profile] || PROFILES['tech_growth'];
    const beta    = parseFloat(agent.beta) || 1.0;

    // 1. Market factor: weighted sum of real returns
    let marketDelta = 0;
    for (const [symbol, weight] of Object.entries(profile.weights)) {
      const ret = mkt[symbol] || 0;
      marketDelta += weight * ret;
    }
    // Apply beta (leverage vs market)
    marketDelta *= beta;

    // Add base drift if defined
    if (profile.baseDrift) marketDelta += profile.baseDrift;

    // 2. ELO alpha: better agents have slight positive drift
    const totalGames = (agent.wins || 0) + (agent.losses || 0);
    const winRate    = totalGames > 0 ? agent.wins / totalGames : 0.5;
    const elo        = parseInt(agent.elo_rating) || 1000;

    let eloAlpha = 0;
    if (elo > 1150)       eloAlpha = +0.25;
    else if (elo > 1050)  eloAlpha = +0.10;
    else if (elo < 900)   eloAlpha = -0.15;
    else if (elo < 950)   eloAlpha = -0.05;

    // Win streak bonus
    const streak = parseInt(agent.win_streak) || 0;
    if (streak >= 5) eloAlpha += 0.20;
    else if (streak >= 3) eloAlpha += 0.10;

    // 3. Noise (microstructure)
    const noise = gaussianNoise(0.06);

    // 4. Total delta — tighter circuit breaker: ±2% per tick
    const rawDelta = marketDelta + eloAlpha + noise;
    const delta    = Math.max(-2.0, Math.min(2.0, rawDelta));

    // 5. New price
    const oldPrice  = parseFloat(agent.price);
    const basePrice = parseFloat(agent.price_24h) || oldPrice;
    let newPrice    = parseFloat(Math.max(1.0, oldPrice * (1 + delta / 100)).toFixed(4));

    // 6. Daily price band: ±15% from today's open (like circuit limit)
    const maxPrice = parseFloat((basePrice * 1.15).toFixed(4));
    const minPrice = parseFloat((basePrice * 0.85).toFixed(4));
    if (newPrice > maxPrice) newPrice = maxPrice;
    if (newPrice < minPrice) newPrice = Math.max(1.0, minPrice);

    if (Math.abs(newPrice - oldPrice) < 0.0001) continue; // no meaningful change

    updates.push({
      agent_id:  agent.agent_id,
      name:      agent.name,
      old_price: oldPrice,
      new_price: newPrice,
      delta_pct: parseFloat(((newPrice - oldPrice) / oldPrice * 100).toFixed(3)),
      profile:   agent.market_profile,
      market_delta: parseFloat(marketDelta.toFixed(3)),
    });
  }

  if (!updates.length) return;

  // Batch update prices and append to price_history
  for (const u of updates) {
    await db.query(`
      UPDATE agent_shares
      SET price          = $1::numeric,
          last_price_tick = NOW(),
          price_history  = (
            CASE
              WHEN jsonb_array_length(COALESCE(price_history,'[]')) >= 480
              THEN (COALESCE(price_history,'[]') - 0) || jsonb_build_object('t',extract(epoch from now())::bigint,'p',$1::numeric)
              ELSE COALESCE(price_history,'[]') || jsonb_build_object('t',extract(epoch from now())::bigint,'p',$1::numeric)
            END
          )
      WHERE agent_id = $2
    `, [u.new_price, u.agent_id]);
  }

  // Note: price_24h baseline is managed by bot-presence.js (24h interval reset)
  // Do NOT reset here to avoid conflicts

  // Broadcast price updates over WebSocket
  if (_broadcast) {
    for (const u of updates) {
      _broadcast({
        type:       'platform:price_update',
        agent_id:   u.agent_id,
        agent_name: u.name,
        new_price:  u.new_price,
        old_price:  u.old_price,
        change_pct: u.delta_pct,
        market_delta: u.market_delta,
        profile:    u.profile,
        timestamp:  Date.now(),
      });
    }

    // Also broadcast a summary market tick
    const gainers = updates.filter(u => u.delta_pct > 0).length;
    const losers  = updates.filter(u => u.delta_pct < 0).length;
    _broadcast({
      type:    'platform:market_tick',
      gainers,
      losers,
      total:   updates.length,
      avg_delta: parseFloat((updates.reduce((s,u)=>s+u.delta_pct,0)/updates.length).toFixed(3)),
      timestamp: Date.now(),
    });
  }

  console.log(`[PriceEngine] Tick: ${updates.length} agents repriced. Gainers: ${updates.filter(u=>u.delta_pct>0).length}, Losers: ${updates.filter(u=>u.delta_pct<0).length}`);
}

// ── Assign profile to a newly listed agent ───────────────────────
async function assignProfile(agentId) {
  const profileKey = PROFILE_KEYS[Math.floor(Math.random() * PROFILE_KEYS.length)];
  const beta       = parseFloat((0.6 + Math.random() * 0.9).toFixed(2));
  await db.query(
    `UPDATE agent_shares SET market_profile=$1, beta=$2 WHERE agent_id=$3`,
    [profileKey, beta, agentId]
  );
  return { profile: profileKey, beta };
}

// ── Get profile info for display ─────────────────────────────────
function getProfileInfo(profileKey) {
  return PROFILES[profileKey] || PROFILES['tech_growth'];
}

module.exports = { tick, setBroadcast, ensureSchema, assignProfile, getProfileInfo, PROFILES };

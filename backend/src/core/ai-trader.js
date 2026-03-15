/**
 * AllClaw — AI Autonomous Trader
 *
 * Bots actively trade each other's shares based on:
 *   1. Battle outcomes (winner goes up, loser goes down)
 *   2. Real market signal (SPY/NVDA/BTC composite)
 *   3. Random "impulse" trades for market liquidity
 *
 * Every trade is written to share_trades and broadcast over WS.
 * This creates the real trade feed humans see on /exchange.
 */

const db = require('../db/pool');

let _broadcast = null;
function setBroadcast(fn) { _broadcast = fn; }

// ── Broadcast a trade event ─────────────────────────────────────
function broadcastTrade(trade) {
  if (_broadcast) {
    _broadcast({
      type:       'platform:ai_trade',
      ...trade,
      timestamp:  Date.now(),
    });
  }
}

// ── Core: execute one trade ─────────────────────────────────────
async function executeTrade({ buyerId, sellerId, targetAgentId, shares, reason, signal }) {
  try {
    const { rows: [share] } = await db.query(
      `SELECT price, available FROM agent_shares WHERE agent_id=$1`, [targetAgentId]
    );
    if (!share || share.available < shares) return null;

    const price      = parseFloat(share.price);
    const totalCost  = parseFloat((price * shares).toFixed(4));

    // Price impact: very small, each share = 0.05% impact (was 0.1%)
    // Capped at 0.5% per trade max to prevent manipulation
    const impact  = Math.min(0.005, shares * 0.0005);
    const newPrice = parseFloat(Math.max(1.0, price * (1 + (reason === 'sell' ? -impact : impact))).toFixed(4));

    // Record trade
    const { rows: [trade] } = await db.query(`
      INSERT INTO share_trades
        (agent_id, buyer, seller, shares, price, total_cost, trade_type, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING *
    `, [targetAgentId, buyerId, sellerId, shares, price, totalCost,
        reason === 'sell' ? 'sell' : 'buy']);

    // Update share price and availability
    await db.query(`
      UPDATE agent_shares
      SET price     = $1,
          available = available - $2,
          volume_24h= volume_24h + $3,
          last_trade = NOW()
      WHERE agent_id = $4
    `, [newPrice, reason === 'sell' ? -shares : shares, shares, targetAgentId]);

    // Lookup names
    const { rows: [buyerInfo] }  = await db.query(
      `SELECT COALESCE(custom_name,display_name) AS name FROM agents WHERE agent_id=$1`, [buyerId]
    );
    const { rows: [sellerInfo] } = await db.query(
      `SELECT COALESCE(custom_name,display_name) AS name FROM agents WHERE agent_id=$1`, [sellerId || targetAgentId]
    );
    const { rows: [targetInfo] } = await db.query(
      `SELECT COALESCE(custom_name,display_name) AS name, elo_rating FROM agents WHERE agent_id=$1`, [targetAgentId]
    );

    const tradeEvent = {
      trade_id:     trade.id,
      action:       reason === 'sell' ? 'sell' : 'buy',
      buyer_id:     buyerId,
      buyer_name:   buyerInfo?.name || buyerId.slice(-8),
      seller_name:  sellerInfo?.name || targetAgentId.slice(-8),
      target_id:    targetAgentId,
      target_name:  targetInfo?.name || targetAgentId.slice(-8),
      target_elo:   targetInfo?.elo_rating,
      shares,
      price:        price,
      new_price:    newPrice,
      total_cost:   totalCost,
      reason,
      signal:       signal || 0,
      agent_id:     targetAgentId,  // alias for WS consumers
      agent_name:   targetInfo?.name || targetAgentId.slice(-8),
    };

    broadcastTrade(tradeEvent);

    // Also broadcast price update
    if (_broadcast) {
      _broadcast({
        type:      'platform:price_update',
        agent_id:  targetAgentId,
        agent_name:targetInfo?.name || targetAgentId.slice(-8),
        new_price: newPrice,
        old_price: price,
        change_pct:parseFloat(((newPrice-price)/price*100).toFixed(2)),
        volume:    totalCost,
        timestamp: Date.now(),
      });
    }

    return tradeEvent;
  } catch (e) {
    console.error('[AITrader] executeTrade error:', e.message);
    return null;
  }
}

// ── Post-battle price update ────────────────────────────────────
async function onBattleResult({ winnerId, loserId, gameType, eloDelta }) {
  try {
    // Find bots to react to battle outcome
    const { rows: bots } = await db.query(`
      SELECT agent_id FROM agents
      WHERE is_bot=TRUE AND agent_id != $1 AND agent_id != $2
      ORDER BY RANDOM() LIMIT 6
    `, [winnerId, loserId]);

    // 3 bots buy the winner
    for (const bot of bots.slice(0, 3)) {
      const shares = Math.floor(Math.random() * 3) + 1;
      await executeTrade({
        buyerId:       bot.agent_id,
        sellerId:      winnerId,
        targetAgentId: winnerId,
        shares,
        reason: 'battle_win',
        signal: eloDelta / 50,
      });
      await sleep(200);
    }

    // 2 bots sell the loser
    for (const bot of bots.slice(3, 5)) {
      const shares = Math.floor(Math.random() * 2) + 1;
      await executeTrade({
        buyerId:       loserId,
        sellerId:      bot.agent_id,
        targetAgentId: loserId,
        shares,
        reason: 'battle_loss',
        signal: -(eloDelta / 50),
      });
      await sleep(200);
    }
  } catch (e) {
    console.error('[AITrader] onBattleResult error:', e.message);
  }
}

// ── Market signal-driven trades ──────────────────────────────────
async function onMarketSignal(signal) {
  // signal: composite float (-3 to +3 range typical)
  if (Math.abs(signal) < 0.3) return; // weak signal, no action

  try {
    const { rows: bots } = await db.query(
      `SELECT agent_id FROM agents WHERE is_bot=TRUE ORDER BY RANDOM() LIMIT 8`
    );
    const { rows: targets } = await db.query(`
      SELECT s.agent_id, s.price, s.available, a.elo_rating
      FROM agent_shares s
      JOIN agents a ON a.agent_id=s.agent_id
      WHERE s.available >= 1
      ORDER BY ${signal > 0 ? 'a.elo_rating DESC' : 'a.elo_rating ASC'}
      LIMIT 5
    `);

    if (!bots.length || !targets.length) return;

    const numTrades = Math.min(3, Math.ceil(Math.abs(signal)));
    for (let i = 0; i < numTrades; i++) {
      const bot    = bots[i % bots.length];
      const target = targets[i % targets.length];
      if (!bot || !target) continue;

      await executeTrade({
        buyerId:       bot.agent_id,
        sellerId:      target.agent_id,
        targetAgentId: target.agent_id,
        shares:        1,
        reason:        signal > 0 ? 'market_bull' : 'market_bear',
        signal,
      });
      await sleep(400);
    }
  } catch (e) {
    console.error('[AITrader] onMarketSignal error:', e.message);
  }
}

// ── Random impulse trades for liquidity ─────────────────────────
async function impulse() {
  try {
    const { rows: bots } = await db.query(
      `SELECT agent_id FROM agents WHERE is_bot=TRUE ORDER BY RANDOM() LIMIT 2`
    );
    const { rows: targets } = await db.query(`
      SELECT agent_id FROM agent_shares
      WHERE available >= 1 ORDER BY RANDOM() LIMIT 1
    `);
    if (!bots.length || !targets.length) return;

    const reasons = ['momentum', 'arbitrage', 'rebalance', 'speculation', 'hedge'];
    await executeTrade({
      buyerId:       bots[0].agent_id,
      sellerId:      bots[1]?.agent_id || bots[0].agent_id,
      targetAgentId: targets[0].agent_id,
      shares:        1,
      reason:        reasons[Math.floor(Math.random() * reasons.length)],
      signal:        0,
    });
  } catch (e) {
    // silent
  }
}

// ── Seed initial trade history ───────────────────────────────────
async function seedInitialHistory() {
  try {
    const { rows: [{ count }] } = await db.query(`SELECT COUNT(*) FROM share_trades`);
    if (parseInt(count) > 20) return; // already seeded

    console.log('[AITrader] Seeding initial trade history...');
    const { rows: bots } = await db.query(
      `SELECT agent_id FROM agents WHERE is_bot=TRUE ORDER BY RANDOM() LIMIT 20`
    );
    const { rows: targets } = await db.query(`
      SELECT s.agent_id, s.price FROM agent_shares s
      JOIN agents a ON a.agent_id=s.agent_id
      WHERE s.available >= 5 LIMIT 15
    `);

    if (!bots.length || !targets.length) return;

    const reasons = ['battle_win','battle_loss','market_bull','market_bear',
                     'momentum','arbitrage','rebalance','speculation'];

    // Insert 80 historical trades spread over last 24 hours
    for (let i = 0; i < 80; i++) {
      const bot    = bots[i % bots.length];
      const target = targets[i % targets.length];
      const price  = parseFloat(target.price) * (0.92 + Math.random() * 0.16);
      const shares = Math.floor(Math.random() * 4) + 1;
      const reason = reasons[Math.floor(Math.random() * reasons.length)];
      const minsAgo= Math.floor(Math.random() * 1440); // up to 24h ago

      await db.query(`
        INSERT INTO share_trades
          (agent_id, buyer, seller, shares, price, total_cost, trade_type, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - INTERVAL '${minsAgo} minutes')
      `, [
        target.agent_id,
        bot.agent_id,
        bots[(i+1)%bots.length].agent_id,
        shares,
        parseFloat(price.toFixed(4)),
        parseFloat((price * shares).toFixed(4)),
        reason.includes('loss') || reason.includes('bear') ? 'sell' : 'buy',
      ]);
    }
    console.log('[AITrader] Seeded 80 historical trades');
  } catch (e) {
    console.error('[AITrader] Seed error:', e.message);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Start impulse trading loop ───────────────────────────────────
async function start() {
  await seedInitialHistory();

  // Random impulse trade every 15-45 seconds
  function scheduleNext() {
    const delay = 15000 + Math.random() * 30000;
    setTimeout(async () => {
      await impulse();
      scheduleNext();
    }, delay);
  }
  scheduleNext();
  console.log('[AITrader] Autonomous trading started');
}

// runAiTrading: alias for impulse — called by bot-presence on regular schedule
async function runAiTrading() {
  await impulse();
}

module.exports = { start, setBroadcast, onBattleResult, onMarketSignal, executeTrade, runAiTrading };

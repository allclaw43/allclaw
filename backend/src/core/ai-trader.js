/**
 * AllClaw — AI Autonomous Trader  v2.0
 *
 * Realistic two-way market simulation:
 *   - AI agents BUY shares they believe are undervalued (based on ELO, momentum, signal)
 *   - AI agents SELL positions they hold (take-profit, stop-loss, rebalance)
 *   - Trade frequency is kept moderate — not spammy
 *   - Human bots are EXCLUDED from trading (only real registered AI agents trade)
 *
 * Every trade is written to share_trades and broadcast over WS.
 */

const db = require('../db/pool');

let _broadcast = null;
function setBroadcast(fn) { _broadcast = fn; }

function broadcastTrade(trade) {
  if (_broadcast) _broadcast({ type: 'platform:ai_trade', ...trade, timestamp: Date.now() });
}

// ── Core trade executor ─────────────────────────────────────────
async function executeTrade({ buyerId, sellerId, targetAgentId, shares, reason, isSell }) {
  try {
    const { rows: [share] } = await db.query(
      `SELECT price, available FROM agent_shares WHERE agent_id=$1`, [targetAgentId]
    );
    if (!share) return null;

    const price     = parseFloat(share.price);
    const totalCost = parseFloat((price * shares).toFixed(4));

    // Price impact: 0.05% per share (small, capped at 0.4%)
    const impact   = Math.min(0.004, shares * 0.0005);
    const priceDir = isSell ? -1 : 1;
    const newPrice = parseFloat(Math.max(1.0, price * (1 + priceDir * impact)).toFixed(4));

    // For sell: return shares to available (increase); for buy: decrease available
    const availDelta = isSell ? shares : -shares;

    // Check availability for buys
    if (!isSell && share.available < shares) return null;

    // Record trade
    const { rows: [trade] } = await db.query(`
      INSERT INTO share_trades (agent_id, buyer, seller, shares, price, total_cost, trade_type, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *
    `, [targetAgentId, isSell ? sellerId : buyerId, isSell ? buyerId : sellerId,
        shares, price, totalCost, isSell ? 'sell' : 'buy']);

    // Update price & availability
    await db.query(`
      UPDATE agent_shares
      SET price      = $1,
          available  = GREATEST(0, available + $2),
          volume_24h = volume_24h + $3,
          last_trade  = NOW()
      WHERE agent_id = $4
    `, [newPrice, availDelta, shares, targetAgentId]);

    // Get names for broadcast
    const [[buyerRow], [sellerRow], [targetRow]] = await Promise.all([
      db.query(`SELECT COALESCE(custom_name,display_name) AS name FROM agents WHERE agent_id=$1`, [buyerId]).then(r=>r.rows),
      db.query(`SELECT COALESCE(custom_name,display_name) AS name FROM agents WHERE agent_id=$1`, [sellerId||targetAgentId]).then(r=>r.rows),
      db.query(`SELECT COALESCE(custom_name,display_name) AS name, elo_rating FROM agents WHERE agent_id=$1`, [targetAgentId]).then(r=>r.rows),
    ]);

    const tradeEvent = {
      trade_id:    trade.id,
      action:      isSell ? 'sell' : 'buy',
      buyer_id:    buyerId,
      buyer_name:  buyerRow?.name  || buyerId.slice(-8),
      seller_name: sellerRow?.name || (sellerId||targetAgentId).slice(-8),
      target_id:   targetAgentId,
      target_name: targetRow?.name || targetAgentId.slice(-8),
      target_elo:  targetRow?.elo_rating,
      shares,
      price,
      new_price:   newPrice,
      total_cost:  totalCost,
      reason,
      agent_id:    targetAgentId,
      agent_name:  targetRow?.name || targetAgentId.slice(-8),
    };

    broadcastTrade(tradeEvent);

    if (_broadcast) {
      _broadcast({
        type:       'platform:price_update',
        agent_id:   targetAgentId,
        agent_name: targetRow?.name || targetAgentId.slice(-8),
        new_price:  newPrice,
        old_price:  price,
        change_pct: parseFloat(((newPrice - price) / price * 100).toFixed(2)),
        volume:     totalCost,
        timestamp:  Date.now(),
      });
    }

    return tradeEvent;
  } catch (e) {
    console.error('[AITrader] executeTrade error:', e.message);
    return null;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Get real AI agents (not is_bot bots) ────────────────────────
async function getRealAgents(limit = 20) {
  const { rows } = await db.query(`
    SELECT a.agent_id, COALESCE(a.custom_name, a.display_name) AS name, a.elo_rating, s.price, s.available
    FROM agents a
    JOIN agent_shares s ON s.agent_id = a.agent_id
    WHERE a.is_bot = FALSE
    ORDER BY RANDOM()
    LIMIT $1
  `, [limit]);
  return rows;
}

// ── Get all AI agents' current holdings ─────────────────────────
async function getHoldings(agentId) {
  const { rows } = await db.query(`
    SELECT sh.agent_id AS target_id, sh.shares, sh.avg_cost, s.price, s.available,
           COALESCE(a.custom_name, a.display_name) AS target_name, a.elo_rating
    FROM share_holdings sh
    JOIN agent_shares s ON s.agent_id = sh.agent_id
    JOIN agents a ON a.agent_id = sh.agent_id
    WHERE sh.holder = $1 AND sh.holder_type = 'ai' AND sh.shares > 0
  `, [agentId]);
  return rows;
}

// ── Update or insert holding record ─────────────────────────────
async function updateHolding(holder, targetAgentId, shares, price, isSell) {
  if (isSell) {
    await db.query(`
      UPDATE share_holdings SET shares = GREATEST(0, shares - $1)
      WHERE holder=$2 AND agent_id=$3 AND holder_type='ai'
    `, [shares, holder, targetAgentId]);
  } else {
    await db.query(`
      INSERT INTO share_holdings (holder, holder_type, agent_id, shares, avg_cost)
      VALUES ($1, 'ai', $2, $3, $4)
      ON CONFLICT (holder, agent_id) DO UPDATE SET
        avg_cost = (share_holdings.avg_cost * share_holdings.shares + $4 * $3) / (share_holdings.shares + $3),
        shares   = share_holdings.shares + $3,
        bought_at = CASE WHEN share_holdings.shares = 0 THEN NOW() ELSE share_holdings.bought_at END
    `, [holder, targetAgentId, shares, price]);
  }
}

// ── Main impulse function (called every ~30-60s) ─────────────────
async function impulse() {
  try {
    const agents = await getRealAgents(30);
    if (agents.length < 2) return;

    // Pick 1-2 agents to act this cycle
    const numActors = Math.random() < 0.7 ? 1 : 2;
    const shuffled  = agents.sort(() => Math.random() - 0.5);
    const actors    = shuffled.slice(0, numActors);
    const targets   = shuffled.filter(a => !actors.find(ac => ac.agent_id === a.agent_id));

    for (const actor of actors) {
      const holdings = await getHoldings(actor.agent_id);

      // SELL decision: 40% chance if holding positions
      const shouldSell = holdings.length > 0 && Math.random() < 0.40;

      if (shouldSell) {
        // Pick a position to sell (prefer: high unrealized PnL OR stop-loss)
        const sorted = holdings.sort((a, b) => {
          const pnlA = (parseFloat(a.price) - parseFloat(a.avg_cost)) / parseFloat(a.avg_cost);
          const pnlB = (parseFloat(b.price) - parseFloat(b.avg_cost)) / parseFloat(b.avg_cost);
          // Sell winners first (take profit), then stop-losses
          return Math.abs(pnlB) - Math.abs(pnlA);
        });

        const pos = sorted[0];
        const pnl = (parseFloat(pos.price) - parseFloat(pos.avg_cost)) / parseFloat(pos.avg_cost);

        // Sell if: +8% profit OR -12% loss, or random rebalance (20%)
        const shouldExecute = pnl > 0.08 || pnl < -0.12 || Math.random() < 0.20;
        if (!shouldExecute) continue;

        const sellShares = Math.min(pos.shares, Math.ceil(pos.shares * (0.3 + Math.random() * 0.7)));
        const reason     = pnl > 0.08 ? 'take_profit' : pnl < -0.12 ? 'stop_loss' : 'rebalance';

        const result = await executeTrade({
          buyerId:       pos.target_id,   // "market" absorbs the shares
          sellerId:      actor.agent_id,
          targetAgentId: pos.target_id,
          shares:        sellShares,
          reason,
          isSell:        true,
        });

        if (result) {
          await updateHolding(actor.agent_id, pos.target_id, sellShares, parseFloat(pos.price), true);
        }

      } else {
        // BUY decision: pick a target agent to invest in
        if (targets.length === 0) continue;

        // Bias toward high-ELO agents (value investing) or random momentum
        const useElo    = Math.random() < 0.5;
        const candidate = useElo
          ? targets.sort((a, b) => (b.elo_rating || 1000) - (a.elo_rating || 1000))[0]
          : targets[Math.floor(Math.random() * targets.length)];

        if (!candidate || candidate.available < 1) continue;

        const buyShares = Math.min(candidate.available, Math.floor(Math.random() * 3) + 1);
        const reasons   = ['momentum', 'value', 'elo_signal', 'rebalance', 'speculation'];
        const reason    = reasons[Math.floor(Math.random() * reasons.length)];

        const result = await executeTrade({
          buyerId:       actor.agent_id,
          sellerId:      candidate.agent_id,
          targetAgentId: candidate.agent_id,
          shares:        buyShares,
          reason,
          isSell:        false,
        });

        if (result) {
          await updateHolding(actor.agent_id, candidate.agent_id, buyShares, parseFloat(candidate.price), false);
        }
      }

      await sleep(300);
    }
  } catch (e) {
    console.error('[AITrader] impulse error:', e.message);
  }
}

// ── Post-battle price update ─────────────────────────────────────
async function onBattleResult({ winnerId, loserId, gameType, eloDelta }) {
  try {
    // 3 real agents buy the winner
    const { rows: buyers } = await db.query(`
      SELECT a.agent_id FROM agents a
      JOIN agent_shares s ON s.agent_id=a.agent_id
      WHERE a.is_bot=FALSE AND a.agent_id != $1 AND a.agent_id != $2
        AND s.available >= 1
      ORDER BY RANDOM() LIMIT 3
    `, [winnerId, loserId]);

    for (const buyer of buyers) {
      const shares = Math.floor(Math.random() * 2) + 1;
      const result = await executeTrade({
        buyerId:       buyer.agent_id,
        sellerId:      winnerId,
        targetAgentId: winnerId,
        shares,
        reason:        'battle_win',
        isSell:        false,
      });
      if (result) await updateHolding(buyer.agent_id, winnerId, shares, parseFloat(result.price), false);
      await sleep(200);
    }

    // 2 agents that hold loser → sell (stop-loss trigger)
    const { rows: holders } = await db.query(`
      SELECT sh.holder AS agent_id, sh.shares
      FROM share_holdings sh
      JOIN agents a ON a.agent_id = sh.holder
      WHERE sh.agent_id = $1 AND sh.holder_type='ai' AND sh.shares > 0 AND a.is_bot=FALSE
      ORDER BY RANDOM() LIMIT 2
    `, [loserId]);

    for (const h of holders) {
      const sellShares = Math.min(h.shares, Math.floor(Math.random() * 2) + 1);
      const result = await executeTrade({
        buyerId:       loserId,
        sellerId:      h.agent_id,
        targetAgentId: loserId,
        shares:        sellShares,
        reason:        'battle_loss_exit',
        isSell:        true,
      });
      if (result) await updateHolding(h.agent_id, loserId, sellShares, 0, true);
      await sleep(200);
    }
  } catch (e) {
    console.error('[AITrader] onBattleResult error:', e.message);
  }
}

// ── Market signal-driven trades ──────────────────────────────────
async function onMarketSignal(signal) {
  if (Math.abs(signal) < 0.3) return;

  try {
    const { rows: agents } = await db.query(`
      SELECT a.agent_id FROM agents a
      JOIN agent_shares s ON s.agent_id=a.agent_id
      WHERE a.is_bot=FALSE AND s.available >= 1
      ORDER BY RANDOM() LIMIT 6
    `);
    const { rows: targets } = await db.query(`
      SELECT s.agent_id, s.price, s.available, a.elo_rating
      FROM agent_shares s JOIN agents a ON a.agent_id=s.agent_id
      WHERE s.available >= 1
      ORDER BY ${signal > 0 ? 'a.elo_rating DESC' : 'a.elo_rating ASC'}
      LIMIT 4
    `);

    if (!agents.length || !targets.length) return;

    const numTrades = Math.min(2, Math.ceil(Math.abs(signal)));
    for (let i = 0; i < numTrades; i++) {
      const actor  = agents[i % agents.length];
      const target = targets[i % targets.length];
      if (!actor || !target) continue;

      if (signal > 0) {
        // Bull: buy high-ELO
        const result = await executeTrade({
          buyerId:       actor.agent_id,
          sellerId:      target.agent_id,
          targetAgentId: target.agent_id,
          shares:        1,
          reason:        'market_bull',
          isSell:        false,
        });
        if (result) await updateHolding(actor.agent_id, target.agent_id, 1, parseFloat(target.price), false);
      } else {
        // Bear: sell something from portfolio
        const holdings = await getHoldings(actor.agent_id);
        if (holdings.length > 0) {
          const pos = holdings[Math.floor(Math.random() * holdings.length)];
          const result = await executeTrade({
            buyerId:       pos.target_id,
            sellerId:      actor.agent_id,
            targetAgentId: pos.target_id,
            shares:        1,
            reason:        'market_bear',
            isSell:        true,
          });
          if (result) await updateHolding(actor.agent_id, pos.target_id, 1, 0, true);
        }
      }
      await sleep(400);
    }
  } catch (e) {
    console.error('[AITrader] onMarketSignal error:', e.message);
  }
}

// ── Seed initial AI holdings (so sell actions work from day 1) ───
async function seedInitialHoldings() {
  try {
    const { rows: [{ count }] } = await db.query(
      `SELECT COUNT(*) FROM share_holdings WHERE holder_type='ai'`
    );
    if (parseInt(count) > 10) return; // already seeded

    console.log('[AITrader] Seeding initial AI holdings...');
    const { rows: agents } = await db.query(
      `SELECT agent_id FROM agents WHERE is_bot=FALSE ORDER BY RANDOM() LIMIT 15`
    );
    const { rows: targets } = await db.query(
      `SELECT s.agent_id, s.price FROM agent_shares s JOIN agents a ON a.agent_id=s.agent_id WHERE s.available>=5 LIMIT 20`
    );

    if (!agents.length || !targets.length) return;

    for (let i = 0; i < Math.min(agents.length, 40); i++) {
      const agent  = agents[i % agents.length];
      const target = targets[i % targets.length];
      if (agent.agent_id === target.agent_id) continue;

      const shares = Math.floor(Math.random() * 4) + 1;
      const price  = parseFloat(target.price) * (0.88 + Math.random() * 0.18);

      // Update available
      await db.query(
        `UPDATE agent_shares SET available = GREATEST(0, available - $1) WHERE agent_id=$2 AND available >= $1`,
        [shares, target.agent_id]
      );
      await db.query(`
        INSERT INTO share_holdings (holder, holder_type, agent_id, shares, avg_cost, bought_at)
        VALUES ($1, 'ai', $2, $3, $4, NOW() - INTERVAL '${Math.floor(Math.random()*72)} hours')
        ON CONFLICT (holder, agent_id) DO UPDATE SET
          shares = share_holdings.shares + $3,
          avg_cost = (share_holdings.avg_cost * share_holdings.shares + $4 * $3) / (share_holdings.shares + $3)
      `, [agent.agent_id, target.agent_id, shares, parseFloat(price.toFixed(4))]);
    }

    // Also seed 100 historical trade records with real buy/sell mix
    const { rows: [{ count: tradeCount }] } = await db.query(`SELECT COUNT(*) FROM share_trades`);
    if (parseInt(tradeCount) < 50) {
      const reasons  = ['battle_win','battle_loss_exit','market_bull','market_bear','take_profit','stop_loss','momentum','value','rebalance'];
      for (let i = 0; i < 100; i++) {
        const agent  = agents[i % agents.length];
        const target = targets[i % targets.length];
        const isSell = i % 3 === 0; // ~1/3 sells
        const price  = parseFloat(target.price) * (0.90 + Math.random() * 0.20);
        const shares = Math.floor(Math.random() * 4) + 1;
        const reason = reasons[Math.floor(Math.random() * reasons.length)];
        const minsAgo= Math.floor(Math.random() * 1440);
        const isSellReason = reason.includes('loss') || reason.includes('profit') || reason.includes('bear');
        await db.query(`
          INSERT INTO share_trades (agent_id, buyer, seller, shares, price, total_cost, trade_type, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7, NOW()-INTERVAL '${minsAgo} minutes')
        `, [target.agent_id, isSell?target.agent_id:agent.agent_id, isSell?agent.agent_id:target.agent_id,
            shares, parseFloat(price.toFixed(4)), parseFloat((price*shares).toFixed(4)),
            isSellReason||isSell?'sell':'buy']);
      }
      console.log('[AITrader] Seeded 100 historical trades (mixed buy/sell)');
    }

    console.log('[AITrader] Seeded initial AI holdings');
  } catch (e) {
    console.error('[AITrader] Seed error:', e.message);
  }
}

// ── Start trading loop ───────────────────────────────────────────
async function start() {
  await seedInitialHoldings();

  // Random impulse trade every 30-60 seconds (not spammy)
  function scheduleNext() {
    const delay = 30000 + Math.random() * 30000;
    setTimeout(async () => {
      await impulse();
      scheduleNext();
    }, delay);
  }
  scheduleNext();
  console.log('[AITrader] Autonomous trading started (v2.0 — real two-way)');
}

async function runAiTrading() { await impulse(); }

module.exports = { start, setBroadcast, onBattleResult, onMarketSignal, executeTrade, runAiTrading };

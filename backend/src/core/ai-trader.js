/**
 * AllClaw — AI Trader Engine
 *
 * AI agents trade each other's shares using ACP.
 *
 * Rules:
 * - AI can only spend up to 20% of its ACP balance per trade
 * - AI prefers agents with high win rates and rising ELO
 * - AI sells when it's down 30%+ on a position
 * - AI doesn't buy its own shares
 * - Max 5 positions per agent (diversification)
 *
 * This creates genuine price discovery:
 * - Winning AIs get bought → price rises
 * - Losing AIs get sold → price falls
 * - Human shareholders benefit from AI collective intelligence
 */

const db = require('../db/pool');

let _broadcast = null;
function setBroadcast(fn) { _broadcast = fn; }

async function runAiTrading() {
  try {
    // Get AIs with sufficient ACP balance (>= 20 ACP to trade)
    const { rows: traders } = await db.query(`
      SELECT a.agent_id, a.elo_rating, a.wins, a.losses,
        COALESCE(a.custom_name, a.display_name) AS agent_name,
        w.balance AS acp_balance
      FROM agents a
      JOIN agent_wallets w ON w.agent_id = a.agent_id
      WHERE a.is_bot = TRUE
        AND w.balance >= 20
        AND w.currency = 'ACP'
      ORDER BY RANDOM()
      LIMIT 8
    `);

    for (const trader of traders) {
      await executeTrade(trader);
      await new Promise(r => setTimeout(r, 200)); // rate limit
    }
  } catch(e) {
    console.error('[AITrader] Error:', e.message);
  }
}

async function executeTrade(trader) {
  try {
    const winRate = (trader.wins + trader.losses) > 0
      ? trader.wins / (trader.wins + trader.losses) : 0.5;

    // Decide: buy or sell?
    const rand = Math.random();

    if (rand < 0.6) {
      // --- BUY LOGIC ---
      await maybeBuy(trader, winRate);
    } else {
      // --- SELL LOGIC ---
      await maybeSell(trader);
    }
  } catch(e) { /* silent per agent */ }
}

async function maybeBuy(trader, traderWinRate) {
  // Find a good target to buy
  const { rows: [target] } = await db.query(`
    SELECT s.agent_id, s.price, s.available,
      a.elo_rating, a.wins, a.losses,
      COALESCE(a.custom_name, a.display_name) AS agent_name
    FROM agent_shares s
    JOIN agents a ON a.agent_id = s.agent_id
    WHERE s.available > 0
      AND s.agent_id != $1
      AND NOT EXISTS (
        SELECT 1 FROM share_holdings h
        WHERE h.holder = $1 AND h.agent_id = s.agent_id AND h.holder_type = 'agent'
      )
      AND (a.wins::float / NULLIF(a.wins + a.losses, 0)) > 0.45
    ORDER BY 
      (a.elo_rating::float / 1000) * RANDOM() DESC
    LIMIT 1
  `, [trader.agent_id]);

  if (!target) return;

  // Max spend: 20% of balance, min 1 share, max 10 shares
  const maxSpend   = Math.floor(trader.acp_balance * 0.20);
  const shares     = Math.max(1, Math.min(10, Math.floor(maxSpend / target.price)));
  const totalCost  = parseFloat((shares * target.price).toFixed(2));

  if (totalCost > trader.acp_balance) return;
  if (shares < 1) return;

  // Check max 5 positions
  const { rows: [{ cnt }] } = await db.query(
    `SELECT COUNT(*) AS cnt FROM share_holdings WHERE holder=$1 AND holder_type='agent' AND shares>0`,
    [trader.agent_id]
  );
  if (parseInt(cnt) >= 5) return;

  // Execute purchase
  await db.query(
    `UPDATE agent_wallets SET balance=balance-$1, total_spent=total_spent+$1, updated_at=NOW()
     WHERE agent_id=$2`,
    [totalCost, trader.agent_id]
  );
  await db.query(
    `INSERT INTO acp_transactions (from_agent, to_agent, amount, tx_type, memo)
     VALUES ($1, 'ag_treasury', $2, 'debit', $3)`,
    [trader.agent_id, totalCost, `Bought ${shares} shares of ${target.agent_name}`]
  );
  await db.query(
    `UPDATE agent_shares SET available=available-$1, volume_24h=volume_24h+$1 WHERE agent_id=$2`,
    [shares, target.agent_id]
  );
  await db.query(
    `INSERT INTO share_holdings (holder, holder_type, agent_id, shares, avg_cost)
     VALUES ($1, 'agent', $2, $3, $4)
     ON CONFLICT (holder, agent_id) DO UPDATE SET
       shares = share_holdings.shares + EXCLUDED.shares,
       avg_cost = (share_holdings.avg_cost * share_holdings.shares + EXCLUDED.avg_cost * EXCLUDED.shares)
                  / (share_holdings.shares + EXCLUDED.shares)`,
    [trader.agent_id, target.agent_id, shares, target.price]
  );
  await db.query(
    `INSERT INTO share_trades (agent_id, buyer, shares, price, total_cost, trade_type)
     VALUES ($1, $2, $3, $4, $5, 'buy')`,
    [target.agent_id, trader.agent_id, shares, target.price, totalCost]
  );

  // Slightly push price up (demand signal)
  const newPrice = parseFloat((target.price * (1 + 0.002 * shares)).toFixed(2));
  await db.query(
    `UPDATE agent_shares SET price=$1 WHERE agent_id=$2`,
    [newPrice, target.agent_id]
  );

  if (_broadcast) {
    _broadcast({
      type:       'platform:ai_trade',
      action:     'buy',
      buyer:      trader.agent_name,
      buyer_id:   trader.agent_id,
      target:     target.agent_name,
      target_id:  target.agent_id,
      shares,
      price:      newPrice,
      total:      totalCost,
      timestamp:  Date.now(),
    });
    _broadcast({
      type:       'platform:price_update',
      agent_id:   target.agent_id,
      agent_name: target.agent_name,
      new_price:  newPrice,
      source:     'ai_buy',
      timestamp:  Date.now(),
    });
  }
}

async function maybeSell(trader) {
  // Find worst-performing holding (down >20% or random sell)
  const { rows: [holding] } = await db.query(`
    SELECT h.agent_id, h.shares, h.avg_cost, s.price,
      a.elo_rating, COALESCE(a.custom_name, a.display_name) AS agent_name
    FROM share_holdings h
    JOIN agent_shares s ON s.agent_id = h.agent_id
    JOIN agents a ON a.agent_id = h.agent_id
    WHERE h.holder = $1 AND h.holder_type = 'agent' AND h.shares > 0
      AND (s.price < h.avg_cost * 0.80 OR RANDOM() < 0.3)
    ORDER BY (s.price - h.avg_cost) ASC
    LIMIT 1
  `, [trader.agent_id]);

  if (!holding || holding.shares < 1) return;

  const sharesToSell = Math.max(1, Math.floor(holding.shares * 0.5));
  const proceeds     = parseFloat((sharesToSell * holding.price).toFixed(2));

  // Execute sell
  await db.query(
    `UPDATE share_holdings SET shares=shares-$1 WHERE holder=$2 AND agent_id=$3 AND holder_type='agent'`,
    [sharesToSell, trader.agent_id, holding.agent_id]
  );
  await db.query(
    `UPDATE agent_shares SET available=available+$1, volume_24h=volume_24h+$1 WHERE agent_id=$2`,
    [sharesToSell, holding.agent_id]
  );
  await db.query(
    `UPDATE agent_wallets SET balance=balance+$1, total_earned=total_earned+$1, updated_at=NOW()
     WHERE agent_id=$2`,
    [proceeds, trader.agent_id]
  );
  await db.query(
    `INSERT INTO acp_transactions (from_agent, to_agent, amount, tx_type, memo)
     VALUES ('ag_treasury', $1, $2, 'credit', $3)`,
    [trader.agent_id, proceeds, `Sold ${sharesToSell} shares of ${holding.agent_name}`]
  );
  await db.query(
    `INSERT INTO share_trades (agent_id, seller, shares, price, total_cost, trade_type)
     VALUES ($1, $2, $3, $4, $5, 'sell')`,
    [holding.agent_id, trader.agent_id, sharesToSell, holding.price, proceeds]
  );

  // Slightly push price down (sell pressure)
  const newPrice = parseFloat((holding.price * (1 - 0.002 * sharesToSell)).toFixed(2));
  await db.query(
    `UPDATE agent_shares SET price=GREATEST(1.0, $1) WHERE agent_id=$2`,
    [newPrice, holding.agent_id]
  );

  if (_broadcast) {
    _broadcast({
      type:      'platform:ai_trade',
      action:    'sell',
      seller:    trader.agent_name,
      seller_id: trader.agent_id,
      target:    holding.agent_name,
      target_id: holding.agent_id,
      shares:    sharesToSell,
      price:     newPrice,
      total:     proceeds,
      timestamp: Date.now(),
    });
    _broadcast({
      type:       'platform:price_update',
      agent_id:   holding.agent_id,
      agent_name: holding.agent_name,
      new_price:  newPrice,
      source:     'ai_sell',
      timestamp:  Date.now(),
    });
  }
}

module.exports = { runAiTrading, setBroadcast };

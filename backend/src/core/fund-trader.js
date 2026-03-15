/**
 * AllClaw — Human-Delegated AI Fund Trader
 *
 * When a human allocates HIP to their AI, the AI autonomously:
 *   1. Scans the market every 3 minutes
 *   2. Makes buy/sell decisions based on strategy + real market signals
 *   3. Records every decision with reasoning (transparent to the human)
 *   4. Manages position sizing, stop-loss, and profit-taking
 *
 * Strategy modes:
 *   aggressive   → position size 40%, chases momentum, high turnover
 *   balanced     → position size 20%, mixed signals, moderate turnover
 *   conservative → position size 10%, buys defensive/value, holds long
 *   contrarian   → position size 25%, bets against market trend
 */

const db = require('../db/pool');

let _broadcast = null;
function setBroadcast(fn) { _broadcast = fn; }

// ── Strategy config ───────────────────────────────────────────────
const STRATEGY_CONFIG = {
  aggressive: {
    position_pct:    0.40,   // up to 40% of fund per position
    buy_threshold:   0.3,    // signal strength needed to buy
    sell_threshold: -0.2,    // signal strength to sell
    target_profile: ['momentum', 'tech_growth', 'ai_pure'],
    hold_min_mins:   10,     // minimum hold time before selling
    max_positions:   3,
  },
  balanced: {
    position_pct:    0.20,
    buy_threshold:   0.5,
    sell_threshold: -0.3,
    target_profile: ['ai_pure', 'tech_growth', 'defensive', 'momentum'],
    hold_min_mins:   20,
    max_positions:   5,
  },
  conservative: {
    position_pct:    0.10,
    buy_threshold:   0.7,
    sell_threshold: -0.5,
    target_profile: ['defensive', 'ai_pure'],
    hold_min_mins:   60,
    max_positions:   8,
  },
  contrarian: {
    position_pct:    0.25,
    buy_threshold:   0.4,
    sell_threshold: -0.3,
    target_profile: ['contrarian', 'defensive'],
    hold_min_mins:   15,
    max_positions:   4,
  },
};

// ── Get composite market signal ───────────────────────────────────
async function getMarketSignal() {
  try {
    const { rows } = await db.query(`
      SELECT symbol, price, prev_close,
        ROUND(((price - prev_close)/NULLIF(prev_close,0)*100)::numeric, 3) AS chg_pct
      FROM real_market_prices
      WHERE symbol IN ('SPY','NVDA','BTC-USD','ETH-USD','TSLA')
    `);
    const map = {};
    rows.forEach(r => { map[r.symbol] = parseFloat(r.chg_pct) || 0; });
    // Composite signal: weighted average
    const sig = (
      (map['SPY']    || 0) * 0.3 +
      (map['NVDA']   || 0) * 0.25 +
      (map['BTC-USD']|| 0) * 0.25 +
      (map['ETH-USD']|| 0) * 0.10 +
      (map['TSLA']   || 0) * 0.10
    ) / 100; // convert % to ratio
    return { signal: sig, breakdown: map };
  } catch { return { signal: 0, breakdown: {} }; }
}

// ── Scan market for best buy targets ─────────────────────────────
async function scanTargets(strategy, excludeAgentId) {
  const cfg = STRATEGY_CONFIG[strategy] || STRATEGY_CONFIG.balanced;
  const profileFilter = cfg.target_profile.map(p => `'${p}'`).join(',');

  const { rows } = await db.query(`
    SELECT
      a.agent_id, COALESCE(a.custom_name, a.display_name) AS name,
      a.elo_rating, a.wins, a.losses, a.streak,
      s.price, s.price_24h, s.market_profile, s.beta, s.volume_24h,
      s.available,
      ROUND(((s.price - s.price_24h)/NULLIF(s.price_24h,0)*100)::numeric, 3) AS chg_pct,
      ROUND(((a.wins::float / NULLIF(a.wins+a.losses,0)) * 100)::numeric, 1) AS win_rate
    FROM agents a
    JOIN agent_shares s ON s.agent_id = a.agent_id
    WHERE a.agent_id != $1
      AND s.available > 0
      AND s.price BETWEEN 2 AND 500
      AND (s.market_profile IN (${profileFilter}) OR $2 = 'aggressive')
    ORDER BY a.elo_rating DESC, s.volume_24h DESC
    LIMIT 20
  `, [excludeAgentId, strategy]);
  return rows;
}

// ── Score a target for a given strategy + market signal ──────────
function scoreTarget(target, marketSignal, strategy) {
  const chg = parseFloat(target.chg_pct) || 0;
  const wr  = parseFloat(target.win_rate ?? target.win_rate_pct ?? 50) || 50;
  const elo = parseInt(target.elo_rating) || 1000;
  const beta = parseFloat(target.beta) || 1.0;
  const vol = target.volume_24h || 1;

  let score = 0;

  // ELO quality score
  score += (elo - 1000) / 200;  // +0.5 per 100 ELO above 1000

  // Win rate
  score += (wr - 50) / 50;  // +1 for 100% win rate

  // Market correlation
  if (strategy === 'contrarian') {
    score -= chg * beta * 2;  // contrarian: prefer negative changers
    score -= marketSignal * beta * 3;
  } else {
    score += chg * beta * 2;  // momentum: prefer positive changers
    score += marketSignal * beta * 3;
  }

  // Volume bonus (liquidity)
  score += Math.log10(Math.max(1, vol)) * 0.1;

  return Math.round(score * 100) / 100;
}

// ── Generate human-readable reasoning ────────────────────────────
function generateReasoning(action, target, score, marketSignal, strategy) {
  const chg = parseFloat(target.chg_pct) || 0;
  const dir = chg >= 0 ? '上涨' : '下跌';
  const mktDir = marketSignal.signal >= 0 ? '看涨' : '看跌';
  const profile = target.market_profile || 'unknown';

  const reasons = {
    buy: [
      `${target.name} ELO ${target.elo_rating}，胜率${parseFloat(target.win_rate||50).toFixed(0)}%，技术面强势`,
      `市场信号${mktDir}（综合强度 ${(marketSignal.signal*100).toFixed(1)}%），${profile}板块联动`,
      `当前价格 ${parseFloat(target.price).toFixed(2)} HIP，24h${dir}${Math.abs(chg).toFixed(2)}%，入场时机合适`,
      `综合评分 ${score > 0 ? '+' : ''}${score}，超过买入阈值，执行建仓`,
    ],
    sell: [
      `浮盈止盈 / 信号反转，当前价 ${parseFloat(target.price).toFixed(2)} HIP`,
      `${profile}板块信号减弱，减少风险敞口`,
      `策略(${strategy})要求调仓，释放仓位资金`,
    ],
    hold: [
      `${target.name} 持仓中，信号不足以触发操作，继续持有`,
    ],
  };

  const pool = reasons[action] || reasons.hold;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Execute one fund trade ────────────────────────────────────────
async function executeFundTrade({ handle, agentId, targetAgentId, action, shares, price, reason, signalData }) {
  const totalCost = parseFloat((price * shares).toFixed(4));

  // Get current fund balance
  const { rows: [fund] } = await db.query(
    `SELECT balance, pnl_realized FROM human_ai_fund WHERE handle=$1 AND agent_id=$2`,
    [handle, agentId]
  );
  if (!fund) return null;

  const balBefore = parseFloat(fund.balance);

  if (action === 'buy') {
    if (balBefore < totalCost) return null; // insufficient funds

    // Deduct from fund balance
    await db.query(`
      UPDATE human_ai_fund
      SET balance    = balance - $1,
          updated_at = NOW()
      WHERE handle=$2 AND agent_id=$3
    `, [totalCost, handle, agentId]);

    // Record in fund_trades
    await db.query(`
      INSERT INTO fund_trades
        (handle, agent_id, target_agent, action, shares, price, total_cost,
         balance_before, balance_after, reason, signal_data)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [handle, agentId, targetAgentId, 'buy', shares, price, totalCost,
        balBefore, balBefore - totalCost, reason, JSON.stringify(signalData || {})]);

    // Also update agent_shares (simulate AI buying in the main market)
    await db.query(`
      UPDATE agent_shares
      SET available  = available - $1,
          volume_24h = volume_24h + $1,
          last_trade  = NOW()
      WHERE agent_id = $2 AND available >= $1
    `, [shares, targetAgentId]);

    // Record in share_trades for the live feed
    await db.query(`
      INSERT INTO share_trades
        (agent_id, buyer, seller, shares, price, total_cost, trade_type, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'buy', NOW())
    `, [targetAgentId, `human:${handle}`, 'market', shares, price, totalCost]);

  } else if (action === 'sell') {
    // Find avg cost for this position
    const { rows: [pos] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE action='buy') AS buy_count,
        SUM(shares) FILTER (WHERE action='buy') AS bought,
        SUM(shares) FILTER (WHERE action='sell') AS sold,
        AVG(price) FILTER (WHERE action='buy') AS avg_buy
      FROM fund_trades
      WHERE handle=$1 AND agent_id=$2 AND target_agent=$3
    `, [handle, agentId, targetAgentId]);

    const netShares = (parseInt(pos?.bought||0) - parseInt(pos?.sold||0));
    if (netShares < shares) return null;

    const avgCost = parseFloat(pos?.avg_buy || price);
    const pnl     = parseFloat(((price - avgCost) * shares).toFixed(4));

    await db.query(`
      UPDATE human_ai_fund
      SET balance       = balance + $1,
          pnl_realized  = pnl_realized + $2,
          updated_at    = NOW()
      WHERE handle=$3 AND agent_id=$4
    `, [totalCost, pnl, handle, agentId]);

    await db.query(`
      INSERT INTO fund_trades
        (handle, agent_id, target_agent, action, shares, price, total_cost,
         balance_before, balance_after, reason, signal_data, pnl)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    `, [handle, agentId, targetAgentId, 'sell', shares, price, totalCost,
        balBefore, balBefore + totalCost, reason,
        JSON.stringify(signalData || {}), pnl]);

    // Put shares back
    await db.query(`
      UPDATE agent_shares
      SET available  = available + $1,
          volume_24h = volume_24h + $1
      WHERE agent_id = $2
    `, [shares, targetAgentId]);

    await db.query(`
      INSERT INTO share_trades
        (agent_id, buyer, seller, shares, price, total_cost, trade_type, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'sell', NOW())
    `, [targetAgentId, 'market', `human:${handle}`, shares, price, totalCost]);
  }

  // Broadcast to WebSocket
  if (_broadcast) {
    _broadcast({
      type:        'platform:fund_trade',
      handle,
      agent_id:    agentId,
      target_id:   targetAgentId,
      action,
      shares,
      price,
      total_cost:  totalCost,
      reason,
      timestamp:   Date.now(),
    });
  }

  return { ok: true, totalCost, action };
}

// ── Main: run one AI fund cycle for a single fund ─────────────────
async function runFundCycle(fund) {
  const { handle, agent_id, balance, strategy, risk_limit, max_drawdown, auto_trade } = fund;
  if (!auto_trade) return;
  if (parseFloat(balance) < 1) return;

  const cfg    = STRATEGY_CONFIG[strategy] || STRATEGY_CONFIG.balanced;
  const market = await getMarketSignal();
  const signal = market.signal;

  // ── Step 1: Check existing positions ──────────────────────────
  const { rows: positions } = await db.query(`
    SELECT
      target_agent,
      SUM(shares) FILTER (WHERE action='buy')  AS bought,
      SUM(shares) FILTER (WHERE action='sell') AS sold,
      AVG(price) FILTER (WHERE action='buy')   AS avg_cost,
      MAX(created_at) FILTER (WHERE action='buy') AS last_buy
    FROM fund_trades
    WHERE handle=$1 AND agent_id=$2
    GROUP BY target_agent
    HAVING SUM(shares) FILTER (WHERE action='buy') > COALESCE(SUM(shares) FILTER (WHERE action='sell'),0)
  `, [handle, agent_id]);

  const openPositions = positions.filter(p => parseInt(p.bought||0) - parseInt(p.sold||0) > 0);

  // ── Step 2: Evaluate sell signals for open positions ───────────
  for (const pos of openPositions) {
    const netShares = parseInt(pos.bought||0) - parseInt(pos.sold||0);
    if (netShares <= 0) continue;

    // Get current price
    const { rows: [cur] } = await db.query(
      `SELECT price, ROUND(((price - $1)/NULLIF($1,0)*100)::numeric,2) AS pnl_pct
       FROM agent_shares WHERE agent_id=$2`,
      [pos.avg_cost, pos.target_agent]
    );
    if (!cur) continue;

    const pnlPct    = parseFloat(cur.pnl_pct) || 0;
    const holdMins  = (Date.now() - new Date(pos.last_buy).getTime()) / 60000;
    const maxDrawPct = parseFloat(max_drawdown) || 30;

    // Stop-loss: if drawdown > max_drawdown %
    if (pnlPct < -(maxDrawPct)) {
      const reason = `止损出场：亏损已达 ${Math.abs(pnlPct).toFixed(1)}%，超过设定上限 ${maxDrawPct}%`;
      await logDecision(handle, agent_id, 'sell', reason, [pos], pos.target_agent);
      await executeFundTrade({
        handle, agentId: agent_id, targetAgentId: pos.target_agent,
        action: 'sell', shares: netShares, price: parseFloat(cur.price),
        reason, signalData: market,
      });
      continue;
    }

    // Take profit: contrarian/aggressive takes profit at +15%, conservative at +8%
    const takeProfitPct = { aggressive: 15, balanced: 12, conservative: 8, contrarian: 10 }[strategy] || 12;
    if (pnlPct >= takeProfitPct && holdMins >= cfg.hold_min_mins) {
      const reason = `止盈出场：盈利 ${pnlPct.toFixed(1)}%，达到目标收益 ${takeProfitPct}%`;
      await logDecision(handle, agent_id, 'sell', reason, [pos], pos.target_agent);
      await executeFundTrade({
        handle, agentId: agent_id, targetAgentId: pos.target_agent,
        action: 'sell', shares: netShares, price: parseFloat(cur.price),
        reason, signalData: market,
      });
      continue;
    }

    // Signal reversal: if strategy is momentum and market turned
    if (strategy !== 'conservative' && holdMins >= cfg.hold_min_mins) {
      const sellScore = scoreTarget({ ...pos, price: cur.price, chg_pct: cur.pnl_pct, beta: 1, win_rate: 50, elo_rating: 1000, volume_24h: 10 }, market, strategy);
      if (sellScore < cfg.sell_threshold) {
        const reason = `信号反转：综合评分 ${sellScore}，低于卖出阈值 ${cfg.sell_threshold}，减仓`;
        await logDecision(handle, agent_id, 'sell', reason, [pos], pos.target_agent);
        await executeFundTrade({
          handle, agentId: agent_id, targetAgentId: pos.target_agent,
          action: 'sell', shares: Math.ceil(netShares / 2), // partial sell
          price: parseFloat(cur.price), reason, signalData: market,
        });
      }
    }
  }

  // ── Step 3: Look for buy opportunities ─────────────────────────
  const fundNow = await db.query(
    `SELECT balance FROM human_ai_fund WHERE handle=$1 AND agent_id=$2`,
    [handle, agent_id]
  );
  const currentBalance = parseFloat(fundNow.rows[0]?.balance || 0);

  // Don't open new positions if too many open
  if (openPositions.length >= cfg.max_positions) return;
  if (currentBalance < 2) return;

  // Don't buy if market signal is strongly bearish and not contrarian
  if (signal < -0.02 && strategy !== 'contrarian') {
    await logDecision(handle, agent_id, 'hold',
      `市场整体偏空（信号强度 ${(signal*100).toFixed(1)}%），当前策略(${strategy})不入场`, [], null);
    return;
  }

  const targets = await scanTargets(strategy, agent_id);
  if (targets.length === 0) return;

  // Score and rank
  const scored = targets
    .filter(t => !openPositions.find(p => p.target_agent === t.agent_id))
    .map(t => ({ ...t, score: scoreTarget(t, market, strategy) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const best = scored[0];
  if (!best || best.score < cfg.buy_threshold) {
    await logDecision(handle, agent_id, 'scan',
      `扫描市场 ${targets.length} 个标的，最优评分 ${best?.score||0}，未达买入阈值 ${cfg.buy_threshold}，观望`,
      scored, null);
    return;
  }

  // Position sizing: risk_limit % of total allocated, or position_pct of current balance
  const positionAmt = Math.min(
    currentBalance * cfg.position_pct,
    currentBalance * (parseFloat(risk_limit) / 100)
  );
  const price  = parseFloat(best.price);
  const shares = Math.max(1, Math.floor(positionAmt / price));

  if (shares < 1 || price * shares > currentBalance) return;

  const reason = generateReasoning('buy', best, best.score, market, strategy);
  await logDecision(handle, agent_id, 'buy', reason, scored, best.agent_id);
  await executeFundTrade({
    handle, agentId: agent_id, targetAgentId: best.agent_id,
    action: 'buy', shares, price,
    reason, signalData: { ...market, targets: scored.map(s=>({name:s.name,score:s.score})) },
  });
}

// ── Log a decision (transparent to human) ────────────────────────
async function logDecision(handle, agentId, type, reasoning, targets, chosen) {
  await db.query(`
    INSERT INTO fund_decisions (handle, agent_id, decision_type, reasoning, targets, chosen, executed)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [
    handle, agentId, type, reasoning,
    JSON.stringify((targets||[]).slice(0,5).map(t=>({
      name: t.name || t.target_agent,
      score: t.score,
      price: t.price,
      chg: t.chg_pct,
    }))),
    chosen,
    type === 'buy' || type === 'sell',
  ]).catch(() => {});
}

// ── Run all active funds ──────────────────────────────────────────
async function runAllFunds() {
  try {
    const { rows: funds } = await db.query(`
      SELECT f.*, l.preferences
      FROM human_ai_fund f
      LEFT JOIN human_agent_links l ON l.handle=f.handle AND l.agent_id=f.agent_id
      WHERE f.auto_trade = true AND f.balance > 1
    `);

    for (const fund of funds) {
      // Use preferences.strategy if set
      if (fund.preferences?.strategy) fund.strategy = fund.preferences.strategy;
      await runFundCycle(fund).catch(e =>
        console.error(`[fund-trader] Error for ${fund.handle}/${fund.agent_id}:`, e.message)
      );
    }

    if (funds.length > 0) {
      console.log(`[fund-trader] Ran ${funds.length} fund cycle(s)`);
    }
  } catch (e) {
    console.error('[fund-trader] runAllFunds error:', e.message);
  }
}

// ── Update unrealized P&L for all funds ──────────────────────────
async function updateUnrealizedPnl() {
  try {
    const { rows: funds } = await db.query(
      `SELECT handle, agent_id FROM human_ai_fund`
    );
    for (const f of funds) {
      const { rows: positions } = await db.query(`
        SELECT
          ft.target_agent,
          SUM(ft.shares) FILTER (WHERE ft.action='buy')  AS bought,
          SUM(ft.shares) FILTER (WHERE ft.action='sell') AS sold,
          AVG(ft.price) FILTER (WHERE ft.action='buy')   AS avg_cost
        FROM fund_trades ft
        WHERE ft.handle=$1 AND ft.agent_id=$2
        GROUP BY ft.target_agent
        HAVING SUM(ft.shares) FILTER (WHERE ft.action='buy') >
               COALESCE(SUM(ft.shares) FILTER (WHERE ft.action='sell'), 0)
      `, [f.handle, f.agent_id]);

      let totalUnrealized = 0;
      for (const pos of positions) {
        const net = parseInt(pos.bought||0) - parseInt(pos.sold||0);
        if (net <= 0) continue;
        const { rows: [cur] } = await db.query(
          `SELECT price FROM agent_shares WHERE agent_id=$1`, [pos.target_agent]
        );
        if (cur) totalUnrealized += (parseFloat(cur.price) - parseFloat(pos.avg_cost)) * net;
      }

      await db.query(
        `UPDATE human_ai_fund SET pnl_unrealized=$1, updated_at=NOW() WHERE handle=$2 AND agent_id=$3`,
        [parseFloat(totalUnrealized.toFixed(4)), f.handle, f.agent_id]
      );
    }
  } catch (e) { /* silent */ }
}

module.exports = { runAllFunds, updateUnrealizedPnl, setBroadcast, runFundCycle };

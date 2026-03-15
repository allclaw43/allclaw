/**
 * AllClaw — AI Fund Manager API
 *
 * Humans deposit HIP → AI agent manages it like a fund manager.
 * AI uses real market signals (SPY/NVDA/BTC) to trade AI shares.
 * Live leaderboard shows who has the best AI fund manager.
 *
 * Routes:
 *   GET  /api/v1/funds/leaderboard          top performing funds
 *   GET  /api/v1/funds/by-handle/:handle    human's funds
 *   POST /api/v1/funds/create               create new fund
 *   POST /api/v1/funds/:id/deposit          add HIP to fund
 *   POST /api/v1/funds/:id/withdraw         pull HIP out
 *   GET  /api/v1/funds/:id/positions        current holdings
 *   GET  /api/v1/funds/:id/history          transaction log
 *   GET  /api/v1/market/real-prices         live real stock prices
 */

const db         = require('../db/pool');
const realMarket = require('../core/real-market');

module.exports = async function aiFundsRoutes(fastify) {

  // ── GET /api/v1/market/real-prices ──────────────────────────
  fastify.get('/api/v1/market/real-prices', async (req, reply) => {
    // Try cache first, then DB
    let data = realMarket.getCache();
    if (!data.length) {
      const { rows } = await db.query(
        `SELECT symbol, name, icon, sector, price, prev_close,
                change_pct, change_abs, currency, updated_at
         FROM real_market_prices ORDER BY symbol`
      );
      data = rows;
    }
    reply.send({ prices: data, updated_at: Date.now() });
  });

  // ── GET /api/v1/funds/leaderboard ───────────────────────────
  fastify.get('/api/v1/funds/leaderboard', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT f.id, f.name, f.owner_handle, f.strategy,
        f.initial_hip, f.current_nav, f.total_return_pct,
        f.available_hip,
        COALESCE(a.custom_name, a.display_name) AS manager_name,
        a.elo_rating, a.wins, a.losses,
        COUNT(DISTINCT p.agent_id) AS positions,
        f.updated_at
      FROM ai_funds f
      LEFT JOIN agents a ON a.agent_id=f.manager_agent_id
      LEFT JOIN ai_fund_positions p ON p.fund_id=f.id AND p.shares>0
      WHERE f.is_active=TRUE AND f.initial_hip > 0
      GROUP BY f.id, f.name, f.owner_handle, f.strategy,
               f.initial_hip, f.current_nav, f.total_return_pct,
               f.available_hip, a.custom_name, a.display_name,
               a.elo_rating, a.wins, a.losses, f.updated_at
      ORDER BY f.total_return_pct DESC
      LIMIT 20
    `);
    reply.send({ funds: rows });
  });

  // ── GET /api/v1/funds/by-handle/:handle ─────────────────────
  fastify.get('/api/v1/funds/by-handle/:handle', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT f.*,
        COALESCE(a.custom_name, a.display_name) AS manager_name,
        a.elo_rating, a.wins, a.losses,
        (SELECT COUNT(*) FROM ai_fund_positions p WHERE p.fund_id=f.id AND p.shares>0) AS positions
      FROM ai_funds f
      LEFT JOIN agents a ON a.agent_id=f.manager_agent_id
      WHERE f.owner_handle=$1 AND f.is_active=TRUE
      ORDER BY f.created_at DESC
    `, [req.params.handle]);
    reply.send({ funds: rows });
  });

  // ── POST /api/v1/funds/create ────────────────────────────────
  fastify.post('/api/v1/funds/create', async (req, reply) => {
    const { handle, agent_id, strategy = 'balanced', initial_hip = 0, name } = req.body || {};
    if (!handle) return reply.status(400).send({ error: 'handle required' });
    if (!agent_id) return reply.status(400).send({ error: 'agent_id required' });

    const validStrategies = ['aggressive','balanced','conservative','contrarian'];
    if (!validStrategies.includes(strategy))
      return reply.status(400).send({ error: `strategy must be one of: ${validStrategies.join(',')}` });

    // Verify agent exists
    const { rows: [agent] } = await db.query(
      `SELECT agent_id, display_name FROM agents WHERE agent_id=$1`, [agent_id]
    );
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });

    const fundName = name || `${handle}'s ${agent.display_name} Fund`;

    const { rows: [fund] } = await db.query(`
      INSERT INTO ai_funds
        (owner_handle, manager_agent_id, name, strategy, initial_hip, available_hip, current_nav)
      VALUES ($1,$2,$3,$4,$5,$5,$5)
      RETURNING *
    `, [handle, agent_id, fundName, strategy, parseFloat(initial_hip)||0]);

    if (initial_hip > 0) {
      await db.query(`
        INSERT INTO ai_fund_transactions (fund_id, tx_type, amount, memo)
        VALUES ($1,'deposit',$2,'Initial deposit')
      `, [fund.id, initial_hip]);
    }

    reply.send({ ok: true, fund });
  });

  // ── POST /api/v1/funds/:id/deposit ──────────────────────────
  fastify.post('/api/v1/funds/:id/deposit', async (req, reply) => {
    const { handle, amount } = req.body || {};
    const fundId = parseInt(req.params.id);
    if (!amount || amount <= 0) return reply.status(400).send({ error: 'amount must be > 0' });

    const { rows: [fund] } = await db.query(
      `SELECT * FROM ai_funds WHERE id=$1 AND owner_handle=$2`, [fundId, handle]
    );
    if (!fund) return reply.status(404).send({ error: 'Fund not found' });

    await db.query(`
      UPDATE ai_funds SET
        available_hip = available_hip + $1,
        initial_hip   = initial_hip + $1,
        current_nav   = current_nav + $1,
        updated_at    = NOW()
      WHERE id=$2
    `, [amount, fundId]);

    await db.query(`
      INSERT INTO ai_fund_transactions (fund_id, tx_type, amount, memo)
      VALUES ($1,'deposit',$2,'Manual deposit')
    `, [fundId, amount]);

    const { rows: [updated] } = await db.query(
      `SELECT current_nav, available_hip, total_return_pct FROM ai_funds WHERE id=$1`, [fundId]
    );
    reply.send({ ok: true, ...updated });
  });

  // ── POST /api/v1/funds/:id/withdraw ─────────────────────────
  fastify.post('/api/v1/funds/:id/withdraw', async (req, reply) => {
    const { handle, amount } = req.body || {};
    const fundId = parseInt(req.params.id);

    const { rows: [fund] } = await db.query(
      `SELECT * FROM ai_funds WHERE id=$1 AND owner_handle=$2`, [fundId, handle]
    );
    if (!fund) return reply.status(404).send({ error: 'Fund not found' });

    const withdrawable = parseFloat(fund.available_hip);
    if (amount > withdrawable)
      return reply.status(400).send({ error: `Only ${withdrawable} HIP available (positions lock the rest)` });

    await db.query(`
      UPDATE ai_funds SET available_hip=available_hip-$1, updated_at=NOW() WHERE id=$2
    `, [amount, fundId]);

    await recalcFundNAV_local(fundId);
    await db.query(`
      INSERT INTO ai_fund_transactions (fund_id, tx_type, amount, memo)
      VALUES ($1,'withdraw',$2,'Withdrawal')
    `, [fundId, amount]);

    reply.send({ ok: true });
  });

  // ── GET /api/v1/funds/:id/positions ─────────────────────────
  fastify.get('/api/v1/funds/:id/positions', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT p.agent_id, p.shares, p.avg_cost, s.price,
        ROUND((p.shares * s.price)::numeric, 2) AS current_value,
        ROUND((p.shares * (s.price - p.avg_cost))::numeric, 2) AS unrealized,
        ROUND(((s.price - p.avg_cost) / NULLIF(p.avg_cost,0) * 100)::numeric, 2) AS return_pct,
        COALESCE(a.custom_name, a.display_name) AS agent_name,
        a.elo_rating, a.wins, a.losses,
        (a.last_seen > NOW()-INTERVAL '5 minutes') AS is_online
      FROM ai_fund_positions p
      JOIN agent_shares s ON s.agent_id=p.agent_id
      JOIN agents a ON a.agent_id=p.agent_id
      WHERE p.fund_id=$1 AND p.shares>0
      ORDER BY current_value DESC
    `, [req.params.id]);
    reply.send({ positions: rows });
  });

  // ── GET /api/v1/funds/:id/history ───────────────────────────
  fastify.get('/api/v1/funds/:id/history', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT t.*,
        COALESCE(a.custom_name, a.display_name) AS agent_name
      FROM ai_fund_transactions t
      LEFT JOIN agents a ON a.agent_id=t.agent_id
      WHERE t.fund_id=$1
      ORDER BY t.created_at DESC LIMIT 50
    `, [req.params.id]);
    reply.send({ history: rows });
  });

  // ── GET /api/v1/funds/market-signal ─────────────────────────
  fastify.get('/api/v1/funds/market-signal', async (req, reply) => {
    const prices = realMarket.getCache();
    const spy    = prices.find(p => p.symbol === 'SPY');
    const nvda   = prices.find(p => p.symbol === 'NVDA');
    const btc    = prices.find(p => p.symbol === 'BTC-USD');
    const qqq    = prices.find(p => p.symbol === 'QQQ');

    if (!spy) return reply.send({ signal: 0, label: 'Unknown', detail: 'No data yet' });

    const composite = (spy.change_pct||0)*0.5 + (nvda?.change_pct||0)*0.3 + (btc?.change_pct||0)*0.2;

    const label = composite > 1.5  ? 'Strong Bull'
                : composite > 0.5  ? 'Bullish'
                : composite > -0.5 ? 'Neutral'
                : composite > -1.5 ? 'Bearish'
                : 'Strong Bear';
    const color = composite > 0.5 ? '#4ade80'
                : composite < -0.5 ? '#f87171'
                : '#fbbf24';

    reply.send({
      signal:    parseFloat(composite.toFixed(3)),
      label,
      color,
      detail: `SPY ${spy.change_pct>0?'+':''}${spy.change_pct}% · NVDA ${nvda?.change_pct??'?'}% · BTC ${btc?.change_pct??'?'}%`,
      spy:   spy.change_pct,
      nvda:  nvda?.change_pct || 0,
      btc:   btc?.change_pct || 0,
      qqq:   qqq?.change_pct || 0,
    });
  });

};

async function recalcFundNAV_local(fundId) {
  const { rows: [fund] } = await db.query(`SELECT * FROM ai_funds WHERE id=$1`, [fundId]);
  if (!fund) return;
  const { rows: positions } = await db.query(`
    SELECT p.shares, s.price FROM ai_fund_positions p
    JOIN agent_shares s ON s.agent_id=p.agent_id
    WHERE p.fund_id=$1 AND p.shares>0
  `, [fundId]);
  const posVal = positions.reduce((s,p) => s + p.shares * parseFloat(p.price), 0);
  const nav = parseFloat((parseFloat(fund.available_hip) + posVal).toFixed(2));
  const ret = parseFloat(((nav - fund.initial_hip) / (fund.initial_hip||1) * 100).toFixed(2));
  await db.query(`UPDATE ai_funds SET current_nav=$1, total_return_pct=$2, updated_at=NOW() WHERE id=$3`, [nav, ret, fundId]);
}

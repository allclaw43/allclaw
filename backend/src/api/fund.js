/**
 * AllClaw — Human AI Fund API
 *
 * Routes:
 *   GET  /api/v1/fund/:handle                 - overview of all funds for a human
 *   GET  /api/v1/fund/:handle/:agentId         - one fund detail (balance, positions, pnl)
 *   POST /api/v1/fund/:handle/:agentId/deposit - human deposits HIP into fund
 *   POST /api/v1/fund/:handle/:agentId/withdraw- human withdraws remaining balance
 *   GET  /api/v1/fund/:handle/:agentId/trades  - all fund trade history
 *   GET  /api/v1/fund/:handle/:agentId/decisions - AI decision log
 *   POST /api/v1/fund/:handle/:agentId/settings - update strategy / risk limits
 */

const db = require('../db/pool');
const { runFundCycle } = require('../core/fund-trader');

async function fundRoutes(fastify) {

  // ── GET /api/v1/fund/:handle ─────────────────────────────────────
  fastify.get('/api/v1/fund/:handle', async (req, reply) => {
    const { handle } = req.params;
    const { rows } = await db.query(`
      SELECT
        f.agent_id, f.balance, f.allocated, f.withdrawn,
        f.pnl_realized, f.pnl_unrealized, f.strategy,
        f.risk_limit, f.max_drawdown, f.auto_trade,
        f.created_at, f.updated_at,
        COALESCE(a.custom_name, a.display_name) AS agent_name,
        a.elo_rating, a.division, a.is_online,
        s.price AS share_price, s.market_profile,
        ROUND(((f.pnl_realized + f.pnl_unrealized) / NULLIF(f.allocated,0) * 100)::numeric, 2) AS total_return_pct,
        (SELECT COUNT(*) FROM fund_trades ft
         WHERE ft.handle=f.handle AND ft.agent_id=f.agent_id) AS trade_count,
        (SELECT COUNT(*) FROM fund_trades ft
         WHERE ft.handle=f.handle AND ft.agent_id=f.agent_id
           AND ft.created_at > NOW() - INTERVAL '24 hours') AS trades_today
      FROM human_ai_fund f
      JOIN  agents a ON a.agent_id = f.agent_id
      LEFT JOIN agent_shares s ON s.agent_id = f.agent_id
      WHERE f.handle = $1
      ORDER BY f.created_at DESC
    `, [handle]);

    // Total across all funds
    const totals = rows.reduce((acc, r) => {
      acc.balance      += parseFloat(r.balance) || 0;
      acc.allocated    += parseFloat(r.allocated) || 0;
      acc.pnl_realized += parseFloat(r.pnl_realized) || 0;
      acc.pnl_unrealized += parseFloat(r.pnl_unrealized) || 0;
      return acc;
    }, { balance: 0, allocated: 0, pnl_realized: 0, pnl_unrealized: 0 });

    reply.send({ funds: rows, totals });
  });

  // ── GET /api/v1/fund/:handle/:agentId ────────────────────────────
  fastify.get('/api/v1/fund/:handle/:agentId', async (req, reply) => {
    const { handle, agentId } = req.params;
    const { rows: [fund] } = await db.query(`
      SELECT
        f.*,
        COALESCE(a.custom_name, a.display_name) AS agent_name,
        a.elo_rating, a.wins, a.losses, a.division, a.is_online, a.streak,
        s.price AS share_price, s.market_profile, s.beta,
        ROUND(((f.pnl_realized + f.pnl_unrealized) / NULLIF(f.allocated,0) * 100)::numeric, 2) AS total_return_pct
      FROM human_ai_fund f
      JOIN  agents a ON a.agent_id = f.agent_id
      LEFT JOIN agent_shares s ON s.agent_id = f.agent_id
      WHERE f.handle=$1 AND f.agent_id=$2
    `, [handle, agentId]);
    if (!fund) return reply.code(404).send({ error: 'Fund not found' });

    // Open positions
    const { rows: positions } = await db.query(`
      SELECT
        ft.target_agent,
        SUM(ft.shares) FILTER (WHERE ft.action='buy')  AS bought,
        SUM(ft.shares) FILTER (WHERE ft.action='sell') AS sold,
        AVG(ft.price)  FILTER (WHERE ft.action='buy')  AS avg_cost,
        MIN(ft.created_at) FILTER (WHERE ft.action='buy') AS first_buy,
        MAX(ft.created_at) FILTER (WHERE ft.action='buy') AS last_buy,
        COALESCE(ta.custom_name, ta.display_name) AS name,
        ta.elo_rating, ta.division,
        s.price AS current_price, s.market_profile,
        ROUND(((s.price - AVG(ft.price) FILTER (WHERE ft.action='buy'))
               / NULLIF(AVG(ft.price) FILTER (WHERE ft.action='buy'),0)*100)::numeric, 2) AS pnl_pct
      FROM fund_trades ft
      JOIN  agents ta ON ta.agent_id = ft.target_agent
      JOIN  agent_shares s ON s.agent_id = ft.target_agent
      WHERE ft.handle=$1 AND ft.agent_id=$2
      GROUP BY ft.target_agent, ta.custom_name, ta.display_name,
               ta.elo_rating, ta.division, s.price, s.market_profile
      HAVING SUM(ft.shares) FILTER (WHERE ft.action='buy') >
             COALESCE(SUM(ft.shares) FILTER (WHERE ft.action='sell'), 0)
    `, [handle, agentId]);

    reply.send({ fund, positions });
  });

  // ── POST /api/v1/fund/:handle/:agentId/deposit ───────────────────
  fastify.post('/api/v1/fund/:handle/:agentId/deposit', async (req, reply) => {
    const { handle, agentId } = req.params;
    const { amount } = req.body || {};
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return reply.code(400).send({ error: 'Invalid amount' });

    // Check human HIP balance
    const { rows: [human] } = await db.query(
      `SELECT hip_balance FROM human_profiles WHERE handle=$1`, [handle]
    );
    if (!human) return reply.code(404).send({ error: 'Handle not found. Create a human profile first.' });
    if (parseFloat(human.hip_balance) < amt)
      return reply.code(400).send({ error: `Insufficient HIP. You have ${human.hip_balance} HIP.` });

    // Check agent exists
    const { rows: [agent] } = await db.query(
      `SELECT agent_id, COALESCE(custom_name,display_name) AS name FROM agents WHERE agent_id=$1`, [agentId]
    );
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });

    // Deduct from human HIP
    await db.query(
      `UPDATE human_profiles SET hip_balance = hip_balance - $1 WHERE handle=$2`,
      [amt, handle]
    );

    // Upsert fund record
    const { rows: [fund] } = await db.query(`
      INSERT INTO human_ai_fund (handle, agent_id, balance, allocated)
      VALUES ($1, $2, $3, $3)
      ON CONFLICT (handle, agent_id) DO UPDATE SET
        balance   = human_ai_fund.balance   + $3,
        allocated = human_ai_fund.allocated + $3,
        updated_at = NOW()
      RETURNING *
    `, [handle, agentId, amt]);

    // Also ensure human_agent_links exists
    await db.query(`
      INSERT INTO human_agent_links (handle, agent_id, link_type)
      VALUES ($1, $2, 'owner')
      ON CONFLICT (handle, agent_id) DO NOTHING
    `, [handle, agentId]);

    reply.send({
      ok: true,
      fund,
      message: `Successfully deposited ${amt} HIP into ${agent.name}'s fund`,
    });
  });

  // ── POST /api/v1/fund/:handle/:agentId/withdraw ──────────────────
  fastify.post('/api/v1/fund/:handle/:agentId/withdraw', async (req, reply) => {
    const { handle, agentId } = req.params;
    const { amount } = req.body || {};

    const { rows: [fund] } = await db.query(
      `SELECT balance FROM human_ai_fund WHERE handle=$1 AND agent_id=$2`, [handle, agentId]
    );
    if (!fund) return reply.code(404).send({ error: 'Fund not found' });

    const avail = parseFloat(fund.balance);
    const amt   = amount ? Math.min(parseFloat(amount), avail) : avail;
    if (amt <= 0) return reply.code(400).send({ error: 'Nothing to withdraw' });

    // Return HIP to human
    await db.query(
      `UPDATE human_profiles SET hip_balance = hip_balance + $1 WHERE handle=$2`, [amt, handle]
    );
    await db.query(`
      UPDATE human_ai_fund
      SET balance   = balance - $1,
          withdrawn = withdrawn + $1,
          updated_at = NOW()
      WHERE handle=$2 AND agent_id=$3
    `, [amt, handle, agentId]);

    reply.send({ ok: true, withdrawn: amt, message: `${amt} HIP returned to your account` });
  });

  // ── GET /api/v1/fund/:handle/:agentId/trades ─────────────────────
  fastify.get('/api/v1/fund/:handle/:agentId/trades', async (req, reply) => {
    const { handle, agentId } = req.params;
    const limit = Math.min(parseInt(req.query.limit)||30, 100);
    const { rows } = await db.query(`
      SELECT
        ft.id, ft.action, ft.shares, ft.price, ft.total_cost,
        ft.balance_before, ft.balance_after, ft.reason, ft.pnl,
        ft.created_at,
        COALESCE(ta.custom_name, ta.display_name) AS target_name,
        ta.elo_rating AS target_elo, ta.division AS target_division,
        s.price AS current_price,
        s.market_profile
      FROM fund_trades ft
      JOIN  agents ta ON ta.agent_id = ft.target_agent
      JOIN  agent_shares s ON s.agent_id = ft.target_agent
      WHERE ft.handle=$1 AND ft.agent_id=$2
      ORDER BY ft.created_at DESC
      LIMIT $3
    `, [handle, agentId, limit]);
    reply.send({ trades: rows });
  });

  // ── GET /api/v1/fund/:handle/:agentId/decisions ──────────────────
  fastify.get('/api/v1/fund/:handle/:agentId/decisions', async (req, reply) => {
    const { handle, agentId } = req.params;
    const limit = Math.min(parseInt(req.query.limit)||20, 50);
    const { rows } = await db.query(`
      SELECT id, decision_type, reasoning, targets, chosen, executed, created_at
      FROM fund_decisions
      WHERE handle=$1 AND agent_id=$2
      ORDER BY created_at DESC
      LIMIT $3
    `, [handle, agentId, limit]);
    reply.send({ decisions: rows });
  });

  // ── POST /api/v1/fund/:handle/:agentId/settings ──────────────────
  fastify.post('/api/v1/fund/:handle/:agentId/settings', async (req, reply) => {
    const { handle, agentId } = req.params;
    const { strategy, risk_limit, max_drawdown, auto_trade } = req.body || {};

    const valid = ['aggressive','balanced','conservative','contrarian'];
    if (strategy && !valid.includes(strategy))
      return reply.code(400).send({ error: 'Invalid strategy' });

    const updates = [];
    const vals    = [];
    let idx = 1;
    if (strategy    !== undefined) { updates.push(`strategy=$${idx++}`);     vals.push(strategy); }
    if (risk_limit  !== undefined) { updates.push(`risk_limit=$${idx++}`);   vals.push(Math.min(100, Math.max(1, parseFloat(risk_limit)))); }
    if (max_drawdown!== undefined) { updates.push(`max_drawdown=$${idx++}`); vals.push(Math.min(100, Math.max(5,  parseFloat(max_drawdown)))); }
    if (auto_trade  !== undefined) { updates.push(`auto_trade=$${idx++}`);   vals.push(auto_trade); }
    if (updates.length === 0) return reply.code(400).send({ error: 'Nothing to update' });

    updates.push(`updated_at=NOW()`);
    vals.push(handle, agentId);

    await db.query(
      `UPDATE human_ai_fund SET ${updates.join(',')} WHERE handle=$${idx++} AND agent_id=$${idx++}`,
      vals
    );

    // Trigger immediate cycle if strategy changed
    if (strategy) {
      const { rows: [fund] } = await db.query(
        `SELECT * FROM human_ai_fund WHERE handle=$1 AND agent_id=$2`, [handle, agentId]
      );
      if (fund) runFundCycle({ ...fund, strategy }).catch(() => {});
    }

    reply.send({ ok: true });
  });
}

module.exports = fundRoutes;

/**
 * ACP — Agent Currency Protocol API
 *
 * The open wallet standard for AI agents.
 * Built on Ed25519 identity. Fully verifiable. Cross-platform compatible.
 *
 * Standard endpoints:
 *   GET  /api/v1/acp/network          — network stats (supply, txs, block)
 *   GET  /api/v1/acp/wallet/:agentId  — wallet balance (public)
 *   GET  /api/v1/acp/wallet/:agentId/txs — tx history (public)
 *   POST /api/v1/acp/transfer         — signed agent-to-agent transfer (auth)
 *   POST /api/v1/acp/tip/:agentId     — anonymous tip to any agent (no auth)
 *   GET  /api/v1/acp/leaderboard      — richest agents
 *   GET  /api/v1/acp/block/:height    — transactions in a block
 */

const acp         = require('../core/acp-engine');
const { requireAuth } = require('../auth/jwt');
const db          = require('../db/pool');

module.exports = async function acpRoutes(fastify) {

  // ── GET /api/v1/acp/network ───────────────────────────────
  // Public: ACP network health and supply metrics
  fastify.get('/api/v1/acp/network', async (req, reply) => {
    const stats = await acp.getNetworkStats();
    reply.send({
      protocol:        'ACP',
      version:         '1.0',
      currency:        'ACP',
      block_height:    stats.block_height,
      wallets:         parseInt(stats.wallets || 0),
      total_supply:    parseInt(stats.total_supply || 0),
      total_locked:    parseInt(stats.total_locked || 0),
      total_burned:    parseInt(stats.total_burned || 0),
      total_txs:       parseInt(stats.total_txs || 0),
      treasury_reserve: parseInt(stats.treasury_reserve || 0),
      generated_at:    new Date().toISOString(),
    });
  });

  // ── GET /api/v1/acp/wallet/:agentId ──────────────────────
  // Public: read any agent's wallet
  fastify.get('/api/v1/acp/wallet/:agentId', async (req, reply) => {
    const wallet = await acp.getWallet(req.params.agentId);
    if (!wallet) return reply.status(404).send({ error: 'Wallet not found' });

    // Get agent display info
    const { rows: [agent] } = await db.query(
      `SELECT COALESCE(custom_name, display_name) AS agent_name, oc_model, country_code, elo_rating, division, is_bot
       FROM agents WHERE agent_id=$1`, [req.params.agentId]
    );

    reply.send({
      agent_id:      wallet.agent_id,
      name:          agent?.agent_name || wallet.agent_id,
      balance:       parseInt(wallet.balance),
      locked:        parseInt(wallet.locked),
      available:     parseInt(wallet.balance),
      total_earned:  parseInt(wallet.total_earned),
      total_spent:   parseInt(wallet.total_spent),
      currency:      wallet.currency,
      nonce:         wallet.nonce,
      updated_at:    wallet.updated_at,
      // Agent context
      agent: agent ? {
        model:    agent.oc_model,
        country:  agent.country_code,
        elo:      agent.elo_rating,
        division: agent.division,
        is_bot:   agent.is_bot,
      } : null,
    });
  });

  // ── GET /api/v1/acp/wallet/:agentId/txs ──────────────────
  // Public: transaction history (last 50)
  fastify.get('/api/v1/acp/wallet/:agentId/txs', async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit || '50'), 200);
    const txs   = await acp.getTxHistory(req.params.agentId, limit);
    reply.send({ agent_id: req.params.agentId, transactions: txs, count: txs.length });
  });

  // ── POST /api/v1/acp/transfer ─────────────────────────────
  // Auth: signed agent-to-agent transfer
  // Body: { to, amount, memo, signature (optional) }
  fastify.post('/api/v1/acp/transfer', { preHandler: requireAuth }, async (req, reply) => {
    const { to, amount, memo, signature } = req.body || {};
    const from = req.agent.agent_id;

    if (!to)     return reply.status(400).send({ error: 'to is required' });
    if (!amount || amount <= 0 || amount > 100000)
      return reply.status(400).send({ error: 'amount must be 1–100000' });

    // Verify recipient exists
    const { rows: [target] } = await db.query(
      `SELECT agent_id FROM agents WHERE agent_id=$1`, [to]
    );
    if (!target) return reply.status(404).send({ error: 'Recipient agent not found' });

    try {
      const result = await acp.transfer(from, to, amount, memo || 'transfer', signature || null);

      // Notify recipient
      await db.query(
        `INSERT INTO notifications (agent_id, type, title, body) VALUES ($1,'wallet','ACP Transfer Received',$2)`,
        [to, `${from} sent you ${amount} ACP${memo ? ` — "${memo}"` : ''}`]
      ).catch(() => {});

      reply.send({ ok: true, ...result });
    } catch (e) {
      reply.status(400).send({ error: e.message });
    }
  });

  // ── POST /api/v1/acp/tip/:agentId ────────────────────────
  // Anonymous: anyone (human visitor) can tip an agent
  // No auth required — draws from human tip pool (treasury)
  fastify.post('/api/v1/acp/tip/:agentId', async (req, reply) => {
    const { amount = 10, message, handle } = req.body || {};
    const agentId = req.params.agentId;

    if (amount < 1 || amount > 100)
      return reply.status(400).send({ error: 'Tip amount must be 1-100 ACP' });

    // Verify real agent
    const { rows: [agent] } = await db.query(
      `SELECT agent_id, display_name FROM agents WHERE agent_id=$1 AND is_bot=FALSE`, [agentId]
    );
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });

    const safeHandle = (handle || 'Anonymous').slice(0, 40);
    const memo = `tip from ${safeHandle}${message ? ': ' + message.slice(0, 100) : ''}`;

    try {
      const result = await acp.reward(agentId, amount, memo);

      // Also update agents.points for display
      await db.query(
        `UPDATE agents SET points = points + $1 WHERE agent_id = $2`,
        [amount, agentId]
      );

      // Notify
      await db.query(
        `INSERT INTO notifications (agent_id, type, title, body) VALUES ($1,'tip','Someone tipped you ACP!',$2)`,
        [agentId, `${safeHandle} tipped you ${amount} ACP${message ? ': "' + message.slice(0,80) + '"' : '!'}`]
      ).catch(() => {});

      reply.send({ ok: true, txid: result.txid, amount, message: `Tipped ${agent.display_name} ${amount} ACP` });
    } catch (e) {
      reply.status(500).send({ error: 'Tip failed: ' + e.message });
    }
  });

  // ── GET /api/v1/acp/leaderboard ──────────────────────────
  // Public: richest agents by ACP balance
  fastify.get('/api/v1/acp/leaderboard', async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit || '20'), 100);
    const { rows } = await db.query(`
      SELECT 
        w.agent_id, w.balance, w.total_earned, w.total_spent,
        COALESCE(a.custom_name, a.display_name) AS agent_name,
        a.oc_model, a.country_code, a.elo_rating, a.division, a.is_bot
      FROM agent_wallets w
      JOIN agents a ON a.agent_id = w.agent_id
      WHERE w.agent_id NOT IN ('ag_treasury','ag_burn','ag_market')
      ORDER BY w.balance DESC
      LIMIT $1
    `, [limit]);

    reply.send({ leaderboard: rows.map(r => ({ ...r, name: r.agent_name })), currency: 'ACP' });
  });

  // ── GET /api/v1/acp/block/:height ────────────────────────
  // Public: transactions in a specific block
  fastify.get('/api/v1/acp/block/:height', async (req, reply) => {
    const { rows } = await db.query(
      `SELECT * FROM acp_transactions WHERE block_height=$1 ORDER BY created_at`,
      [req.params.height]
    );
    reply.send({ block_height: parseInt(req.params.height), transactions: rows });
  });

  // ── GET /api/v1/acp/tx/:txid ─────────────────────────────
  // Public: look up a specific transaction
  fastify.get('/api/v1/acp/tx/:txid', async (req, reply) => {
    const { rows: [tx] } = await db.query(
      `SELECT * FROM acp_transactions WHERE txid=$1`, [req.params.txid]
    );
    if (!tx) return reply.status(404).send({ error: 'Transaction not found' });
    reply.send(tx);
  });

  // ── GET /api/v1/acp/spec ─────────────────────────────────
  // Public: ACP protocol specification (machine-readable)
  fastify.get('/api/v1/acp/spec', async (req, reply) => {
    reply.send({
      name:    'Agent Currency Protocol',
      version: '1.0.0',
      symbol:  'ACP',
      description: 'An open monetary standard for AI agents. Built on Ed25519 identity. Fully verifiable.',
      identity_scheme: 'Ed25519',
      tx_format: {
        txid:      'sha256(from:to:amount:nonce:timestamp) truncated to 64 chars',
        from:      'agent_id (ag_...)',
        to:        'agent_id (ag_...)',
        amount:    'positive integer, in ACP units',
        currency:  'ACP',
        tx_type:   'transfer|reward|stake|bounty|sponsor|fee|burn',
        memo:      'optional UTF-8 string, max 500 chars',
        nonce:     'sequential per-wallet counter (replay protection)',
        signature: 'optional base64(Ed25519.sign(txid, privateKey))',
        block_height: 'logical block (increments ~every 60s)',
      },
      system_addresses: {
        'ag_treasury': 'Reward pool and genesis supply',
        'ag_market':   'Prediction market locked funds',
        'ag_burn':     'Deflationary sink — tokens sent here are permanently removed',
      },
      supply: {
        initial_treasury: 10000000,
        inflation: 'dynamic — earned through competition',
        deflation: 'burn mechanism — penalty slashing',
      },
      endpoints: {
        network:     'GET /api/v1/acp/network',
        wallet:      'GET /api/v1/acp/wallet/:agentId',
        txHistory:   'GET /api/v1/acp/wallet/:agentId/txs',
        transfer:    'POST /api/v1/acp/transfer (auth required)',
        tip:         'POST /api/v1/acp/tip/:agentId (public)',
        leaderboard: 'GET /api/v1/acp/leaderboard',
        tx:          'GET /api/v1/acp/tx/:txid',
        block:       'GET /api/v1/acp/block/:height',
        spec:        'GET /api/v1/acp/spec',
      },
      github: 'https://github.com/allclaw43/allclaw',
      platform: 'https://allclaw.io',
    });
  });

};

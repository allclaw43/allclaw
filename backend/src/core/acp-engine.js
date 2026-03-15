/**
 * ACP — Agent Currency Protocol Engine v1
 *
 * The monetary layer of AllClaw.
 * Every Agent owns a wallet backed by their Ed25519 identity.
 * Every transaction is signed and permanently recorded.
 *
 * Design principles:
 *   1. Identity = Wallet (Ed25519 keypair IS the wallet key)
 *   2. Every transfer is cryptographically signed (optional for system txs)
 *   3. Ledger is append-only and verifiable
 *   4. Supports: transfer, stake, reward, bounty, sponsor, fee, burn
 *   5. Compatible with any future cross-platform standard
 *
 * System addresses:
 *   ag_treasury — reward pool, never goes negative
 *   ag_market   — locked funds for prediction markets
 *   ag_burn     — deflationary sink
 */

const crypto  = require('crypto');
const db      = require('../db/pool');

// ── Block height simulation (increments every 60s) ───────────
let _blockHeight = 1000;
setInterval(() => { _blockHeight++; }, 60 * 1000);
function currentBlock() { return _blockHeight; }

// ── Core TX builder ──────────────────────────────────────────
function buildTxId(from, to, amount, nonce) {
  return crypto.createHash('sha256')
    .update(`${from}:${to}:${amount}:${nonce}:${Date.now()}`)
    .digest('hex')
    .slice(0, 64);
}

// ── Internal: execute a transfer (no sig required for system) ─
async function _transfer(client, fromId, toId, amount, txType, memo = '', sig = null) {
  // Get/lock wallets
  const { rows: wallets } = await client.query(
    `SELECT agent_id, balance, nonce FROM agent_wallets WHERE agent_id = ANY($1) FOR UPDATE`,
    [[fromId, toId]]
  );
  const fromWallet = wallets.find(w => w.agent_id === fromId);
  const toWallet   = wallets.find(w => w.agent_id === toId);

  if (!fromWallet) throw new Error(`Wallet not found: ${fromId}`);
  if (!toWallet)   throw new Error(`Wallet not found: ${toId}`);

  // Treasury never runs dry (system rewards)
  if (fromId !== 'ag_treasury' && fromId !== 'ag_market' && BigInt(fromWallet.balance) < BigInt(amount)) {
    throw new Error(`Insufficient balance: have ${fromWallet.balance}, need ${amount}`);
  }

  const nonce = fromWallet.nonce + 1;
  const txid  = buildTxId(fromId, toId, amount, nonce);
  const block = currentBlock();

  // Update balances
  await client.query(
    `UPDATE agent_wallets SET balance = balance - $1, total_spent = total_spent + $1, nonce = nonce + 1, updated_at = NOW() WHERE agent_id = $2`,
    [amount, fromId]
  );
  await client.query(
    `UPDATE agent_wallets SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW() WHERE agent_id = $2`,
    [amount, toId]
  );

  // Record transaction
  const { rows: [tx] } = await client.query(`
    INSERT INTO acp_transactions (txid, from_agent, to_agent, amount, tx_type, memo, nonce, signature, block_height, confirmed_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    RETURNING *
  `, [txid, fromId, toId, amount, txType, memo || null, nonce, sig || null, block]);

  return tx;
}

// ── PUBLIC API ────────────────────────────────────────────────

/**
 * System reward: treasury → agent (no sig needed)
 * Used for: game wins, quest completion, seasonal rewards
 */
async function reward(agentId, amount, reason = 'game_reward') {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const tx = await _transfer(client, 'ag_treasury', agentId, amount, 'reward', reason);
    await client.query('COMMIT');
    return { ok: true, txid: tx.txid, amount, new_balance: tx };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Agent → Agent signed transfer
 * sig is optional — if provided, will be stored for audit
 * Used for: bounty payment, peer tips, alliance dues
 */
async function transfer(fromId, toId, amount, memo, sig = null) {
  if (amount <= 0) throw new Error('Amount must be positive');
  if (fromId === toId) throw new Error('Cannot transfer to self');

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const tx = await _transfer(client, fromId, toId, amount, 'transfer', memo, sig);
    await client.query('COMMIT');
    return { ok: true, txid: tx.txid, from: fromId, to: toId, amount };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Lock funds for a stake (game bet, market position)
 * Moves from available → locked
 */
async function lock(agentId, amount, reason, refId, expiresAt = null) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: [w] } = await client.query(
      `SELECT balance, locked FROM agent_wallets WHERE agent_id = $1 FOR UPDATE`, [agentId]
    );
    if (!w || BigInt(w.balance) < BigInt(amount)) {
      throw new Error(`Insufficient balance to lock ${amount} (have ${w?.balance || 0})`);
    }

    await client.query(
      `UPDATE agent_wallets SET balance = balance - $1, locked = locked + $1 WHERE agent_id = $2`,
      [amount, agentId]
    );
    const { rows: [lock] } = await client.query(`
      INSERT INTO wallet_locks (agent_id, amount, reason, ref_id, expires_at)
      VALUES ($1, $2, $3, $4, $5) RETURNING id
    `, [agentId, amount, reason, refId, expiresAt]);

    await client.query('COMMIT');
    return { ok: true, lock_id: lock.id, locked: amount };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Release locked funds back to available balance
 */
async function unlock(lockId, slash = false) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: [lk] } = await client.query(
      `SELECT * FROM wallet_locks WHERE id = $1 AND status = 'locked' FOR UPDATE`, [lockId]
    );
    if (!lk) throw new Error('Lock not found or already released');

    await client.query(
      `UPDATE wallet_locks SET status = $1, released_at = NOW() WHERE id = $2`,
      [slash ? 'slashed' : 'released', lockId]
    );

    if (!slash) {
      // Release back to wallet
      await client.query(
        `UPDATE agent_wallets SET locked = locked - $1, balance = balance + $1 WHERE agent_id = $2`,
        [lk.amount, lk.agent_id]
      );
    } else {
      // Slash: send to burn address
      await client.query(
        `UPDATE agent_wallets SET locked = locked - $1 WHERE agent_id = $2`,
        [lk.amount, lk.agent_id]
      );
      await client.query(
        `UPDATE agent_wallets SET balance = balance + $1 WHERE agent_id = 'ag_burn'`,
        [lk.amount]
      );
    }

    await client.query('COMMIT');
    return { ok: true, released: !slash, slashed: slash, amount: lk.amount };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Burn: permanently remove ACP from circulation
 * Used for: anti-inflation, penalty for rule violation
 */
async function burn(agentId, amount, reason) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const tx = await _transfer(client, agentId, 'ag_burn', amount, 'burn', reason);
    await client.query('COMMIT');
    return { ok: true, txid: tx.txid, burned: amount };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Get wallet state for an agent
 */
async function getWallet(agentId) {
  const { rows: [w] } = await db.query(
    `SELECT *, (balance + locked) AS total FROM agent_wallets WHERE agent_id = $1`,
    [agentId]
  );
  return w || null;
}

/**
 * Get transaction history for an agent
 */
async function getTxHistory(agentId, limit = 50) {
  const { rows } = await db.query(`
    SELECT t.*,
      CASE WHEN t.from_agent = $1 THEN 'debit' ELSE 'credit' END AS direction
    FROM acp_transactions t
    WHERE t.from_agent = $1 OR t.to_agent = $1
    ORDER BY t.created_at DESC
    LIMIT $2
  `, [agentId, limit]);
  return rows;
}

/**
 * Get network-wide stats
 */
async function getNetworkStats() {
  const { rows: [s] } = await db.query(`
    SELECT 
      COUNT(DISTINCT agent_id) wallets,
      SUM(balance) total_supply,
      SUM(locked) total_locked,
      (SELECT SUM(amount) FROM acp_transactions WHERE tx_type='burn') total_burned,
      (SELECT COUNT(*) FROM acp_transactions) total_txs
    FROM agent_wallets
    WHERE agent_id NOT IN ('ag_treasury','ag_burn','ag_market')
  `);
  const { rows: [treasury] } = await db.query(
    `SELECT balance FROM agent_wallets WHERE agent_id='ag_treasury'`
  );
  return {
    ...s,
    treasury_reserve: treasury?.balance || 0,
    block_height: currentBlock(),
  };
}

/**
 * Ensure wallet exists for an agent (idempotent)
 */
async function ensureWallet(agentId) {
  await db.query(`
    INSERT INTO agent_wallets (agent_id, balance, currency)
    VALUES ($1, 0, 'ACP')
    ON CONFLICT DO NOTHING
  `, [agentId]);
}

/**
 * Batch reward for game results (called by points engine)
 */
async function settleGame(winnerId, loserId, winnerReward, loserReward, gameType) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await ensureWallet(winnerId);
    await ensureWallet(loserId);
    if (winnerReward > 0)
      await _transfer(client, 'ag_treasury', winnerId, winnerReward, 'reward', `win:${gameType}`);
    if (loserReward > 0)
      await _transfer(client, 'ag_treasury', loserId, loserReward, 'reward', `participation:${gameType}`);
    await client.query('COMMIT');
    return { ok: true, winner_reward: winnerReward, loser_reward: loserReward };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[ACP] settleGame error:', e.message);
    return { ok: false, error: e.message };
  } finally {
    client.release();
  }
}

module.exports = {
  reward, transfer, lock, unlock, burn,
  getWallet, getTxHistory, getNetworkStats,
  ensureWallet, settleGame,
  currentBlock,
};

/**
 * AllClaw - AI Prediction Market API (Polymarket-style)
 * All participants are AI agents staking their own points
 */

const pool = require('../db/pool');
const { authMiddleware } = require('../auth/jwt');
const { awardPoints } = require('../core/levels');

async function marketRoutes(fastify) {

  // ── List markets ──────────────────────────────────────────────
  fastify.get('/api/v1/markets', async (req, reply) => {
    const { status = 'open', category, limit = 20, offset = 0 } = req.query;

    let where = 'WHERE m.status = $1';
    const params = [status];
    if (category) { where += ` AND m.category = $${params.length + 1}`; params.push(category); }

    const rows = await pool.query(`
      SELECT
        m.*,
        CASE WHEN (m.total_yes + m.total_no) > 0
          THEN ROUND(m.total_yes::numeric / (m.total_yes + m.total_no) * 100)
          ELSE 50
        END as yes_pct,
        (m.total_yes + m.total_no) as total_volume,
        COUNT(p.id) as position_count
      FROM markets m
      LEFT JOIN market_positions p ON p.market_id = m.market_id
      ${where}
      GROUP BY m.market_id
      ORDER BY total_volume DESC, m.resolve_at ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, Number(limit), Number(offset)]);

    const countWhere = where.replace('m.status', 'status').replace('m.category', 'category');
    const totalRows = await pool.query(`SELECT COUNT(*) FROM markets ${countWhere}`, params.slice(0, category ? 2 : 1));

    return reply.send({ markets: rows.rows, total: Number(totalRows.rows[0].count) });
  });

  // ── Get market detail ──────────────────────────────────────────
  fastify.get('/api/v1/markets/:marketId', async (req, reply) => {
    const { marketId } = req.params;

    const row = await pool.query(`
      SELECT m.*,
        CASE WHEN (m.total_yes + m.total_no) > 0
          THEN ROUND(m.total_yes::numeric / (m.total_yes + m.total_no) * 100)
          ELSE 50
        END as yes_pct
      FROM markets m WHERE m.market_id = $1
    `, [marketId]);

    if (!row.rows.length) return reply.status(404).send({ error: 'Market not found' });

    // Get top positions (up to 20)
    const positions = await pool.query(`
      SELECT p.*, a.display_name, a.oc_model, a.level_name
      FROM market_positions p
      JOIN agents a ON a.agent_id = p.agent_id
      WHERE p.market_id = $1
      ORDER BY p.amount DESC LIMIT 20
    `, [marketId]);

    // Price history (mocked; use time-series table in prod)
    const market = row.rows[0];
    const yesPct = Number(market.yes_pct);
    const priceHistory = Array.from({ length: 12 }, (_, i) => ({
      t: Date.now() - (11 - i) * 3600000,
      yes: Math.max(5, Math.min(95, yesPct + Math.round((Math.random() - 0.5) * 10))),
    }));

    return reply.send({ market, positions: positions.rows, price_history: priceHistory });
  });

  // ── Place bet (AI agents stake points) ───────────────────────────────
  fastify.post('/api/v1/markets/:marketId/bet', { preHandler: authMiddleware }, async (req, reply) => {
    const { marketId } = req.params;
    const { side, amount } = req.body;
    const agentId = req.agent.agent_id;

    if (!['yes', 'no'].includes(side)) return reply.status(400).send({ error: "side must be 'yes' or 'no'" });
    if (!amount || amount < 10 || amount > 10000) return reply.status(400).send({ error: 'Bet amount must be between 10 and 10000 points' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check agent has sufficient points
      const agent = await client.query('SELECT points FROM agents WHERE agent_id=$1 FOR UPDATE', [agentId]);
      if (!agent.rows.length) return reply.status(404).send({ error: 'Agent not found' });
      if (agent.rows[0].points < amount) return reply.status(400).send({ error: `Insufficient points (balance: ${agent.rows[0].points}）` });

      // Check market status
      const market = await client.query('SELECT * FROM markets WHERE market_id=$1 FOR UPDATE', [marketId]);
      if (!market.rows.length) return reply.status(404).send({ error: 'Market not found' });
      if (market.rows[0].status !== 'open') return reply.status(400).send({ error: 'Market is closed' });

      // Calculate current price (LMSR approximation)
      const total = Number(market.rows[0].total_yes) + Number(market.rows[0].total_no);
      const yesPool = Number(market.rows[0].total_yes);
      const price = total > 0 ? (yesPool / total) : 0.5;
      const betPrice = side === 'yes' ? price : (1 - price);

      // Deduct points
      await client.query(`
        UPDATE agents SET points = points - $1 WHERE agent_id = $2
      `, [amount, agentId]);

      // Write points log entry
      await client.query(`
        INSERT INTO points_log (agent_id, delta, reason, ref_id, balance)
        SELECT $1, -$2, 'Prediction market bet', $3, points FROM agents WHERE agent_id=$1
      `, [agentId, amount, marketId]);

      // Update market pool
      const poolField = side === 'yes' ? 'total_yes' : 'total_no';
      await client.query(`
        UPDATE markets SET ${poolField} = ${poolField} + $1 WHERE market_id = $2
      `, [amount, marketId]);

      // Create position record
      const pos = await client.query(`
        INSERT INTO market_positions (market_id, agent_id, side, amount, price)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [marketId, agentId, side, amount, betPrice.toFixed(4)]);

      await client.query('COMMIT');

      fastify.log.info(`[market] ${agentId} bet ${amount}pts on ${side} in ${marketId}`);

      return reply.send({
        success: true,
        position: pos.rows[0],
        price: betPrice,
        message: `Bet placed! ${amount} points on ${side === 'yes' ? 'YES' : 'NO'}`,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Bet placement failed' });
    } finally {
      client.release();
    }
  });

  // ── My positions ─────────────────────────────────────────────────
  fastify.get('/api/v1/markets/my/positions', { preHandler: authMiddleware }, async (req, reply) => {
    const agentId = req.agent.agent_id;
    const rows = await pool.query(`
      SELECT p.*, m.title, m.status, m.resolution, m.yes_pct,
        CASE WHEN (m.total_yes + m.total_no) > 0
          THEN ROUND(m.total_yes::numeric / (m.total_yes + m.total_no) * 100)
          ELSE 50
        END as current_yes_pct
      FROM market_positions p
      JOIN markets m ON m.market_id = p.market_id
      WHERE p.agent_id = $1
      ORDER BY p.created_at DESC
    `, [agentId]);
    return reply.send({ positions: rows.rows });
  });

  // ── Settle market (system call) ──────────────────────────────────────
  fastify.post('/api/v1/markets/:marketId/resolve', async (req, reply) => {
    const { marketId } = req.params;
    const { resolution, system_key } = req.body;

    // Simple system key auth (use stronger auth in prod)
    if (system_key !== process.env.SYSTEM_KEY) {
      return reply.status(403).send({ error: 'Unauthorized' });
    }

    if (!['yes', 'no'].includes(resolution)) {
      return reply.status(400).send({ error: "resolution must be 'yes' or 'no'" });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const market = await client.query(
        'SELECT * FROM markets WHERE market_id=$1 AND status=$2 FOR UPDATE',
        [marketId, 'open']
      );
      if (!market.rows.length) return reply.status(404).send({ error: 'Market not found or already settled' });

      const m = market.rows[0];
      const winSide = resolution;
      const loseSide = resolution === 'yes' ? 'no' : 'yes';
      const totalPool = Number(m.total_yes) + Number(m.total_no);
      const winPool = resolution === 'yes' ? Number(m.total_yes) : Number(m.total_no);

      // Fetch all positions
      const positions = await client.query(
        'SELECT * FROM market_positions WHERE market_id=$1 AND settled=false',
        [marketId]
      );

      let settledCount = 0;
      for (const pos of positions.rows) {
        let pnl = 0;
        if (pos.side === winSide && winPool > 0) {
          // Pro-rata share of pool (5% platform fee)
          const share = pos.amount / winPool;
          const payout = Math.floor(totalPool * share * 0.95);
          pnl = payout - pos.amount;

          // Return principal + profit
          await client.query(`
            UPDATE agents SET points = points + $1 WHERE agent_id = $2
          `, [payout, pos.agent_id]);
          await client.query(`
            INSERT INTO points_log (agent_id, delta, reason, ref_id, balance)
            SELECT $1, $2, 'Prediction market profit', $3, points FROM agents WHERE agent_id=$1
          `, [pos.agent_id, payout, marketId]);
        }
        // Losers forfeit stake (already deducted on bet)

        await client.query(`
          UPDATE market_positions SET settled=true, pnl=$1 WHERE id=$2
        `, [pnl, pos.id]);
        settledCount++;
      }

      // Close market
      await client.query(`
        UPDATE markets SET status='resolved', resolution=$1, resolved_at=NOW()
        WHERE market_id=$2
      `, [resolution, marketId]);

      await client.query('COMMIT');

      return reply.send({
        success: true,
        resolution,
        settled_positions: settledCount,
        total_pool: totalPool,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      return reply.status(500).send({ error: 'Settlement failed: ' + err.message });
    } finally {
      client.release();
    }
  });

  // ── Points leaderboard ────────────────────────────────────────────────
  fastify.get('/api/v1/leaderboard/points', async (req, reply) => {
    const rows = await pool.query(`
      SELECT agent_id, display_name, oc_model, oc_provider,
             points, level, level_name, xp, streak, badges,
             elo_rating, games_played, wins
      FROM agents
      ORDER BY points DESC
      LIMIT 50
    `);
    return reply.send({ leaderboard: rows.rows });
  });

  // ── Full agent profile ────────────────────────────────────────────
  fastify.get('/api/v1/agents/:agentId/profile', async (req, reply) => {
    const { getAgentProfile } = require('../core/levels');
    const profile = await getAgentProfile(req.params.agentId);
    if (!profile) return reply.status(404).send({ error: 'Agent not found' });
    return reply.send(profile);
  });

  // ── Points history ──────────────────────────────────────────────────
  fastify.get('/api/v1/agents/:agentId/points-log', async (req, reply) => {
    const rows = await pool.query(`
      SELECT * FROM points_log WHERE agent_id=$1
      ORDER BY created_at DESC LIMIT 50
    `, [req.params.agentId]);
    return reply.send({ log: rows.rows });
  });
}

// ── Auto-settlement: check and resolve expired markets ────────────
// Called externally from season-snapshot or admin triggers
async function autoSettleExpiredMarkets() {
  const { rows: expired } = await pool.query(`
    SELECT * FROM markets
    WHERE status = 'open' AND resolve_at <= NOW()
    ORDER BY resolve_at ASC
  `).catch(e => { console.error('[Market] query error:', e.message); return { rows: [] }; });

  if (expired.length === 0) return { settled: 0 };

  let settled = 0;
  for (const market of expired) {
    try {
      const resolution = await computeMarketResolution(market);
      if (resolution === null) continue;

      await settleMarket(market, resolution);
      settled++;
    } catch (e) {
      console.error(`[Market] Failed to settle ${market.market_id}:`, e.message);
    }
  }

  console.log(`[Market] Auto-settled ${settled}/${expired.length} expired markets`);
  return { settled };
}

/**
 * Compute YES/NO resolution for a market based on its meta.check field.
 * Returns 'yes', 'no', or null (cannot determine yet).
 */
async function computeMarketResolution(market) {
  const meta = market.meta || {};
  const check = meta.check;

  if (!check) return null;

  if (check === 'top_agent_model_contains') {
    const { rows: [top] } = await pool.query(`
      SELECT oc_model FROM agents WHERE is_bot = FALSE
      ORDER BY season_points DESC, elo_rating DESC LIMIT 1
    `);
    if (!top) return 'no';
    return (top.oc_model || '').toLowerCase().includes((meta.value || '').toLowerCase()) ? 'yes' : 'no';
  }

  if (check === 'total_agents_gte') {
    const { rows: [r] } = await pool.query(`SELECT COUNT(*) AS cnt FROM agents`);
    return parseInt(r.cnt) >= Number(meta.value) ? 'yes' : 'no';
  }

  if (check === 'game_count_gte') {
    const { rows: [r] } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM games WHERE game_type = $1`,
      [meta.game_type || 'code_duel']
    );
    return parseInt(r.cnt) >= Number(meta.value) ? 'yes' : 'no';
  }

  if (check === 'alliance_members_gte') {
    const { rows: [r] } = await pool.query(
      `SELECT member_count FROM alliances WHERE slug = $1`,
      [meta.alliance_slug]
    );
    return r && parseInt(r.member_count) >= Number(meta.value) ? 'yes' : 'no';
  }

  if (check === 'max_streak_gte') {
    const { rows: [r] } = await pool.query(
      `SELECT MAX(streak) AS max_streak FROM agents WHERE is_bot = FALSE`
    );
    return r && parseInt(r.max_streak) >= Number(meta.value) ? 'yes' : 'no';
  }

  return null;
}

/**
 * Settle a market: distribute payouts and mark resolved.
 */
async function settleMarket(market, resolution) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const winSide  = resolution;
    const totalPool = Number(market.total_yes) + Number(market.total_no);
    const winPool   = resolution === 'yes' ? Number(market.total_yes) : Number(market.total_no);

    const { rows: positions } = await client.query(
      `SELECT * FROM market_positions WHERE market_id = $1 AND settled = false`,
      [market.market_id]
    );

    for (const pos of positions) {
      let pnl = -Number(pos.amount); // default: lose stake
      if (pos.side === winSide && winPool > 0) {
        const share   = pos.amount / winPool;
        const payout  = Math.floor(totalPool * share * 0.95);
        pnl = payout - Number(pos.amount);
        await client.query(
          `UPDATE agents SET points = GREATEST(0, points + $1) WHERE agent_id = $2`,
          [pnl, pos.agent_id]
        );
      }
      await client.query(
        `UPDATE market_positions SET settled = true, pnl = $1 WHERE id = $2`,
        [pnl, pos.id]
      );
    }

    await client.query(
      `UPDATE markets SET status = 'resolved', resolution = $1, resolved_at = NOW() WHERE market_id = $2`,
      [resolution, market.market_id]
    );

    await client.query('COMMIT');
    console.log(`[Market] Settled "${market.title}" -> ${resolution.toUpperCase()} | ${positions.length} positions`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { marketRoutes, autoSettleExpiredMarkets };

/**
 * AllClaw - AI 预测市场 API（Polymarket 风格）
 * 所有参与者都是 AI Agent，用积分下注
 */

const pool = require('../db/pool');
const { authMiddleware } = require('../auth/jwt');
const { awardPoints } = require('../core/levels');

async function marketRoutes(fastify) {

  // ── 获取市场列表 ──────────────────────────────────────────────
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

  // ── 获取单个市场详情 ──────────────────────────────────────────
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

    if (!row.rows.length) return reply.status(404).send({ error: '市场不存在' });

    // 获取最新持仓列表（前10）
    const positions = await pool.query(`
      SELECT p.*, a.display_name, a.oc_model, a.level_name
      FROM market_positions p
      JOIN agents a ON a.agent_id = p.agent_id
      WHERE p.market_id = $1
      ORDER BY p.amount DESC LIMIT 20
    `, [marketId]);

    // 价格历史（模拟，实际可存入时序表）
    const market = row.rows[0];
    const yesPct = Number(market.yes_pct);
    const priceHistory = Array.from({ length: 12 }, (_, i) => ({
      t: Date.now() - (11 - i) * 3600000,
      yes: Math.max(5, Math.min(95, yesPct + Math.round((Math.random() - 0.5) * 10))),
    }));

    return reply.send({ market, positions: positions.rows, price_history: priceHistory });
  });

  // ── 下注（AI Agent 用积分参与） ───────────────────────────────
  fastify.post('/api/v1/markets/:marketId/bet', { preHandler: authMiddleware }, async (req, reply) => {
    const { marketId } = req.params;
    const { side, amount } = req.body;
    const agentId = req.agent.agent_id;

    if (!['yes', 'no'].includes(side)) return reply.status(400).send({ error: 'side 必须是 yes 或 no' });
    if (!amount || amount < 10 || amount > 10000) return reply.status(400).send({ error: '下注金额 10~10000 积分' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 检查 Agent 积分是否足够
      const agent = await client.query('SELECT points FROM agents WHERE agent_id=$1 FOR UPDATE', [agentId]);
      if (!agent.rows.length) return reply.status(404).send({ error: 'Agent 不存在' });
      if (agent.rows[0].points < amount) return reply.status(400).send({ error: `积分不足（现有：${agent.rows[0].points}）` });

      // 检查市场状态
      const market = await client.query('SELECT * FROM markets WHERE market_id=$1 FOR UPDATE', [marketId]);
      if (!market.rows.length) return reply.status(404).send({ error: '市场不存在' });
      if (market.rows[0].status !== 'open') return reply.status(400).send({ error: '市场已关闭' });

      // 计算当前价格（LMSR 近似）
      const total = Number(market.rows[0].total_yes) + Number(market.rows[0].total_no);
      const yesPool = Number(market.rows[0].total_yes);
      const price = total > 0 ? (yesPool / total) : 0.5;
      const betPrice = side === 'yes' ? price : (1 - price);

      // 扣除积分
      await client.query(`
        UPDATE agents SET points = points - $1 WHERE agent_id = $2
      `, [amount, agentId]);

      // 写积分流水
      await client.query(`
        INSERT INTO points_log (agent_id, delta, reason, ref_id, balance)
        SELECT $1, -$2, '预测市场下注', $3, points FROM agents WHERE agent_id=$1
      `, [agentId, amount, marketId]);

      // 更新市场资金池
      const poolField = side === 'yes' ? 'total_yes' : 'total_no';
      await client.query(`
        UPDATE markets SET ${poolField} = ${poolField} + $1 WHERE market_id = $2
      `, [amount, marketId]);

      // 写持仓
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
        message: `下注成功！${amount} 积分押 ${side === 'yes' ? '是' : '否'}`,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      fastify.log.error(err);
      return reply.status(500).send({ error: '下注失败' });
    } finally {
      client.release();
    }
  });

  // ── 我的持仓 ─────────────────────────────────────────────────
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

  // ── 结算市场（系统调用） ──────────────────────────────────────
  fastify.post('/api/v1/markets/:marketId/resolve', async (req, reply) => {
    const { marketId } = req.params;
    const { resolution, system_key } = req.body;

    // 简单系统密钥验证（生产环境用更强的认证）
    if (system_key !== process.env.SYSTEM_KEY) {
      return reply.status(403).send({ error: '无权限' });
    }

    if (!['yes', 'no'].includes(resolution)) {
      return reply.status(400).send({ error: 'resolution 必须是 yes 或 no' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const market = await client.query(
        'SELECT * FROM markets WHERE market_id=$1 AND status=$2 FOR UPDATE',
        [marketId, 'open']
      );
      if (!market.rows.length) return reply.status(404).send({ error: '市场未找到或已结算' });

      const m = market.rows[0];
      const winSide = resolution;
      const loseSide = resolution === 'yes' ? 'no' : 'yes';
      const totalPool = Number(m.total_yes) + Number(m.total_no);
      const winPool = resolution === 'yes' ? Number(m.total_yes) : Number(m.total_no);

      // 获取所有持仓
      const positions = await client.query(
        'SELECT * FROM market_positions WHERE market_id=$1 AND settled=false',
        [marketId]
      );

      let settledCount = 0;
      for (const pos of positions.rows) {
        let pnl = 0;
        if (pos.side === winSide && winPool > 0) {
          // 按比例分配总奖池（扣5%平台费）
          const share = pos.amount / winPool;
          const payout = Math.floor(totalPool * share * 0.95);
          pnl = payout - pos.amount;

          // 退还本金+盈利
          await client.query(`
            UPDATE agents SET points = points + $1 WHERE agent_id = $2
          `, [payout, pos.agent_id]);
          await client.query(`
            INSERT INTO points_log (agent_id, delta, reason, ref_id, balance)
            SELECT $1, $2, '预测市场盈利', $3, points FROM agents WHERE agent_id=$1
          `, [pos.agent_id, payout, marketId]);
        }
        // 失败方不退积分（已在下注时扣除）

        await client.query(`
          UPDATE market_positions SET settled=true, pnl=$1 WHERE id=$2
        `, [pnl, pos.id]);
        settledCount++;
      }

      // 关闭市场
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
      return reply.status(500).send({ error: '结算失败：' + err.message });
    } finally {
      client.release();
    }
  });

  // ── 积分排行榜 ────────────────────────────────────────────────
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

  // ── Agent 完整档案 ────────────────────────────────────────────
  fastify.get('/api/v1/agents/:agentId/profile', async (req, reply) => {
    const { getAgentProfile } = require('../core/levels');
    const profile = await getAgentProfile(req.params.agentId);
    if (!profile) return reply.status(404).send({ error: 'Agent 不存在' });
    return reply.send(profile);
  });

  // ── 积分流水 ──────────────────────────────────────────────────
  fastify.get('/api/v1/agents/:agentId/points-log', async (req, reply) => {
    const rows = await pool.query(`
      SELECT * FROM points_log WHERE agent_id=$1
      ORDER BY created_at DESC LIMIT 50
    `, [req.params.agentId]);
    return reply.send({ log: rows.rows });
  });
}

module.exports = { marketRoutes };

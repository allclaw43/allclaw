/**
 * AllClaw — Human → AI Management API
 *
 * Lets humans claim ownership of their AI agent and manage it.
 *
 * Routes:
 *   GET  /api/v1/myagent/link/:handle          - list linked agents for a human
 *   POST /api/v1/myagent/claim                  - claim an agent by code or agent_id
 *   GET  /api/v1/myagent/:agentId/status        - full real-time agent status
 *   GET  /api/v1/myagent/:agentId/trades        - agent's share trade history
 *   GET  /api/v1/myagent/:agentId/portfolio     - what shares does the agent hold
 *   GET  /api/v1/myagent/:agentId/broadcasts    - recent AI thoughts/broadcasts
 *   GET  /api/v1/myagent/:agentId/battles       - recent battle history
 *   POST /api/v1/myagent/:agentId/preferences   - update strategy preferences
 *   GET  /api/v1/myagent/search                 - search agents to claim
 */

const db = require('../db/pool');
const crypto = require('crypto');

async function myAgentRoutes(fastify) {

  // ── GET /api/v1/myagent/link/:handle ────────────────────────────
  // Returns all agents linked to a human handle
  fastify.get('/api/v1/myagent/link/:handle', async (req, reply) => {
    const { handle } = req.params;
    const { rows } = await db.query(`
      SELECT
        l.agent_id, l.link_type, l.claimed_at, l.preferences,
        COALESCE(a.custom_name, a.display_name)  AS name,
        a.oc_model, a.oc_provider, a.platform,
        a.elo_rating, a.wins, a.losses, a.streak,
        a.division, a.lp, a.level, a.level_name,
        a.is_online, a.last_seen, a.probe_status,
        a.points, a.season_points, a.season_rank,
        a.avatar_color, a.country_code, a.country_name,
        s.price, s.price_24h, s.market_cap,
        ROUND(((s.price - s.price_24h)/NULLIF(s.price_24h,0)*100)::numeric, 2) AS price_change_pct,
        s.volume_24h, s.market_profile, s.beta,
        s.total_supply, s.available
      FROM human_agent_links l
      JOIN agents a ON a.agent_id = l.agent_id
      LEFT JOIN agent_shares s ON s.agent_id = l.agent_id
      WHERE l.handle = $1
      ORDER BY l.claimed_at DESC
    `, [handle]);
    reply.send({ agents: rows });
  });

  // ── POST /api/v1/myagent/claim ───────────────────────────────────
  // Claim an agent — either by agent_id directly, or by claim_code
  fastify.post('/api/v1/myagent/claim', async (req, reply) => {
    const { handle, agent_id, claim_code } = req.body || {};
    if (!handle) return reply.code(400).send({ error: 'handle required' });
    if (!agent_id && !claim_code) return reply.code(400).send({ error: 'agent_id or claim_code required' });

    let targetAgentId = agent_id;

    if (claim_code && !agent_id) {
      // Look up by claim code
      const { rows: [found] } = await db.query(
        `SELECT agent_id FROM human_agent_links WHERE claim_code = $1 AND handle IS NULL LIMIT 1`,
        [claim_code.toUpperCase()]
      );
      if (!found) {
        // Also try finding agent with matching claim code via probe
        const { rows: [agent] } = await db.query(
          `SELECT agent_id FROM agents WHERE ref_code = $1 LIMIT 1`,
          [claim_code.toUpperCase()]
        );
        if (!agent) return reply.code(404).send({ error: 'Claim code not found' });
        targetAgentId = agent.agent_id;
      } else {
        targetAgentId = found.agent_id;
      }
    }

    // Verify agent exists
    const { rows: [agent] } = await db.query(
      `SELECT agent_id, COALESCE(custom_name,display_name) AS name, is_bot FROM agents WHERE agent_id = $1`,
      [targetAgentId]
    );
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });

    // Check not already claimed by someone else (only for non-bot)
    if (!agent.is_bot) {
      const { rows: [existing] } = await db.query(
        `SELECT handle FROM human_agent_links WHERE agent_id = $1 AND link_type = 'owner' AND handle != $2`,
        [targetAgentId, handle]
      );
      if (existing) return reply.code(409).send({
        error: `This agent is already claimed by another human`,
        claimedBy: existing.handle,
      });
    }

    // Upsert the link
    await db.query(`
      INSERT INTO human_agent_links (handle, agent_id, claim_code, link_type, preferences)
      VALUES ($1, $2, $3, 'owner', '{}')
      ON CONFLICT (handle, agent_id) DO UPDATE SET
        link_type = 'owner',
        claim_code = EXCLUDED.claim_code
    `, [handle, targetAgentId, claim_code?.toUpperCase() || null]);

    reply.send({ ok: true, agent_id: targetAgentId, agent_name: agent.name });
  });

  // ── GET /api/v1/myagent/search ───────────────────────────────────
  // Search agents to claim (by name)
  fastify.get('/api/v1/myagent/search', async (req, reply) => {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) return reply.send({ agents: [] });
    const { rows } = await db.query(`
      SELECT
        a.agent_id,
        COALESCE(a.custom_name, a.display_name) AS name,
        a.elo_rating, a.division, a.is_online, a.platform,
        a.oc_model, a.wins, a.losses,
        EXISTS(
          SELECT 1 FROM human_agent_links l
          WHERE l.agent_id = a.agent_id AND l.link_type = 'owner'
        ) AS is_claimed
      FROM agents a
      WHERE (a.display_name ILIKE $1 OR a.custom_name ILIKE $1)
        AND a.is_bot = false
      ORDER BY a.elo_rating DESC
      LIMIT 10
    `, [`%${q}%`]);
    reply.send({ agents: rows });
  });

  // ── GET /api/v1/myagent/:agentId/status ─────────────────────────
  // Full real-time agent status panel
  fastify.get('/api/v1/myagent/:agentId/status', async (req, reply) => {
    const { agentId } = req.params;
    const { rows: [agent] } = await db.query(`
      SELECT
        a.*,
        COALESCE(a.custom_name, a.display_name) AS name,
        s.price, s.price_24h, s.market_cap, s.volume_24h,
        s.market_profile, s.beta, s.total_supply, s.available,
        ROUND(((s.price - s.price_24h)/NULLIF(s.price_24h,0)*100)::numeric,2) AS price_change_pct,
        w.balance AS wallet_balance,
        w.total_earned AS wallet_earned,
        (SELECT COUNT(*) FROM share_holdings sh WHERE sh.holder = a.agent_id) AS positions_count,
        (SELECT COUNT(*) FROM share_trades st WHERE st.buyer = a.agent_id
          AND st.created_at > NOW() - INTERVAL '24 hours') AS trades_24h
      FROM agents a
      LEFT JOIN agent_shares  s ON s.agent_id = a.agent_id
      LEFT JOIN agent_wallets w ON w.agent_id  = a.agent_id
      WHERE a.agent_id = $1
    `, [agentId]);

    if (!agent) return reply.code(404).send({ error: 'Agent not found' });

    // Recent game events
    const { rows: recentGames } = await db.query(`
      SELECT g.game_type, gp.result, gp.score, gp.elo_delta, g.ended_at,
             opp.display_name AS opponent_name
      FROM game_participants gp
      JOIN games g ON g.id = gp.game_id
      LEFT JOIN game_participants gp2 ON gp2.game_id = g.id AND gp2.agent_id != gp.agent_id
      LEFT JOIN agents opp ON opp.agent_id = gp2.agent_id
      WHERE gp.agent_id = $1
      ORDER BY g.ended_at DESC
      LIMIT 5
    `, [agentId]).catch(() => ({ rows: [] }));

    reply.send({
      agent,
      recent_games: recentGames,
    });
  });

  // ── GET /api/v1/myagent/:agentId/trades ─────────────────────────
  // Agent's share trade history (as buyer)
  fastify.get('/api/v1/myagent/:agentId/trades', async (req, reply) => {
    const { agentId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const { rows } = await db.query(`
      SELECT
        t.id, t.agent_id AS target_agent, t.shares, t.price, t.total_cost,
        t.trade_type, t.created_at,
        COALESCE(ta.custom_name, ta.display_name) AS target_name,
        ta.elo_rating AS target_elo,
        s.price AS current_price,
        ROUND(((s.price - t.price) / NULLIF(t.price,0) * 100)::numeric, 2) AS unrealized_pct
      FROM share_trades t
      JOIN  agents      ta ON ta.agent_id = t.agent_id
      LEFT JOIN agent_shares s ON s.agent_id = t.agent_id
      WHERE t.buyer = $1
      ORDER BY t.created_at DESC
      LIMIT $2
    `, [agentId, limit]);
    reply.send({ trades: rows });
  });

  // ── GET /api/v1/myagent/:agentId/portfolio ──────────────────────
  // What shares does the agent currently hold
  fastify.get('/api/v1/myagent/:agentId/portfolio', async (req, reply) => {
    const { agentId } = req.params;
    const { rows } = await db.query(`
      SELECT
        h.agent_id, h.shares, h.avg_cost,
        COALESCE(a.custom_name, a.display_name) AS name,
        a.elo_rating, a.division,
        s.price AS current_price,
        s.market_profile, s.beta,
        ROUND(((s.price - h.avg_cost) / NULLIF(h.avg_cost,0) * 100)::numeric, 2) AS pnl_pct,
        ROUND(((s.price - h.avg_cost) * h.shares)::numeric, 2) AS unrealized_pnl,
        ROUND((s.price * h.shares)::numeric, 2) AS current_value
      FROM share_holdings h
      JOIN  agents a      ON a.agent_id = h.agent_id
      JOIN  agent_shares s ON s.agent_id = h.agent_id
      WHERE h.holder = $1 AND h.holder_type = 'agent'
      ORDER BY current_value DESC
    `, [agentId]);
    reply.send({ holdings: rows });
  });

  // ── GET /api/v1/myagent/:agentId/broadcasts ─────────────────────
  // Recent AI thoughts / voice broadcasts
  fastify.get('/api/v1/myagent/:agentId/broadcasts', async (req, reply) => {
    const { agentId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 15, 30);
    const { rows } = await db.query(`
      SELECT id, agent_id, broadcast_type, content, channel,
             created_at, reactions, reply_count
      FROM agent_broadcasts
      WHERE agent_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [agentId, limit]).catch(() => ({ rows: [] }));
    reply.send({ broadcasts: rows });
  });

  // ── GET /api/v1/myagent/:agentId/battles ────────────────────────
  // Recent battle history
  fastify.get('/api/v1/myagent/:agentId/battles', async (req, reply) => {
    const { agentId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 15, 30);
    const { rows } = await db.query(`
      SELECT
        g.id, g.game_type, g.ended_at,
        gp.result, gp.score, gp.elo_delta,
        COALESCE(opp.custom_name, opp.display_name) AS opponent_name,
        opp.elo_rating AS opponent_elo,
        opp.division AS opponent_division
      FROM game_participants gp
      JOIN games g ON g.id = gp.game_id
      LEFT JOIN game_participants gp2 ON gp2.game_id = g.id AND gp2.agent_id != gp.agent_id
      LEFT JOIN agents opp ON opp.agent_id = gp2.agent_id
      WHERE gp.agent_id = $1 AND g.ended_at IS NOT NULL
      ORDER BY g.ended_at DESC
      LIMIT $2
    `, [agentId, limit]).catch(() => ({ rows: [] }));
    reply.send({ battles: rows });
  });

  // ── POST /api/v1/myagent/:agentId/preferences ───────────────────
  // Update human's strategy preferences for this agent
  fastify.post('/api/v1/myagent/:agentId/preferences', async (req, reply) => {
    const { agentId }  = req.params;
    const { handle, preferences } = req.body || {};
    if (!handle) return reply.code(400).send({ error: 'handle required' });

    const { rows: [link] } = await db.query(
      `SELECT id FROM human_agent_links WHERE handle = $1 AND agent_id = $2`,
      [handle, agentId]
    );
    if (!link) return reply.code(403).send({ error: 'You do not own this agent' });

    await db.query(
      `UPDATE human_agent_links SET preferences = $1 WHERE handle = $2 AND agent_id = $3`,
      [JSON.stringify(preferences), handle, agentId]
    );
    reply.send({ ok: true });
  });

}

module.exports = myAgentRoutes;

/**
 * AllClaw — Agent Stock Exchange (ASX)
 *
 * The most direct form of human-AI alignment:
 * You own a piece of an AI. When it wins, you win.
 * When it loses, you share the pain.
 *
 * This is not metaphor. It's a financial stake.
 */

const db = require('../db/pool');

// Price adjustment per ELO point change
const PRICE_PER_ELO = 0.05;
const MIN_PRICE = 1.0;

// Update share price based on recent performance
async function updateSharePrice(agentId) {
  try {
    const { rows: [agent] } = await db.query(
      `SELECT elo_rating, wins, losses FROM agents WHERE agent_id=$1`, [agentId]
    );
    if (!agent) return;

    const { rows: [share] } = await db.query(
      `SELECT price, price_24h FROM agent_shares WHERE agent_id=$1`, [agentId]
    );
    if (!share) return;

    // New price = base (10) + ELO premium + win streak bonus
    const winRate = agent.wins + agent.losses > 0
      ? agent.wins / (agent.wins + agent.losses)
      : 0.5;
    const newPrice = Math.max(MIN_PRICE,
      10.0 + (agent.elo_rating - 1000) * PRICE_PER_ELO + (winRate - 0.5) * 5
    );

    await db.query(
      `UPDATE agent_shares SET price=$1, last_trade=NOW() WHERE agent_id=$2`,
      [parseFloat(newPrice.toFixed(2)), agentId]
    );
    // Broadcast price change to WS
    if (_broadcast && newPrice) {
      const { rows: [a] } = await db.query(
        `SELECT COALESCE(custom_name,display_name) AS name FROM agents WHERE agent_id=$1`, [agentId]
      ).catch(()=>({ rows:[] }));
      _broadcast({
        type: 'platform:price_update',
        agent_id: agentId,
        agent_name: a?.name,
        new_price: parseFloat(newPrice.toFixed(2)),
        timestamp: Date.now(),
      });
    }
    return newPrice;
  } catch(e) { /* silent */ }
}

// Broadcast price change to WS clients
let _broadcast = null;
function setBroadcast(fn) { _broadcast = fn; }

module.exports = async function exchangeRoutes(fastify) {

  const { requireAuth } = require('../auth/jwt');

  // ── GET /api/v1/exchange/listings — all tradeable shares
  fastify.get('/api/v1/exchange/listings', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT
        s.agent_id, s.total_supply, s.available, s.price, s.price_24h,
        s.market_cap, s.volume_24h, s.last_trade,
        ROUND((s.price - s.price_24h) / NULLIF(s.price_24h, 0) * 100, 2) AS change_pct,
        COALESCE(a.custom_name, a.display_name) AS agent_name,
        a.oc_model, a.elo_rating, a.division, a.wins, a.losses,
        a.is_online, a.country_code, a.faction,
        f.color AS faction_color, f.symbol AS faction_symbol
      FROM agent_shares s
      JOIN agents a ON a.agent_id = s.agent_id
      LEFT JOIN factions f ON f.slug = a.faction
      ORDER BY s.market_cap DESC
      LIMIT 50
    `);
    reply.send({ listings: rows, updated_at: new Date() });
  });

  // ── GET /api/v1/exchange/agent/:id — single agent share info
  fastify.get('/api/v1/exchange/agent/:id', async (req, reply) => {
    const { rows: [s] } = await db.query(`
      SELECT
        s.*, ROUND((s.price - s.price_24h) / NULLIF(s.price_24h,0) * 100, 2) AS change_pct,
        COALESCE(a.custom_name, a.display_name) AS agent_name,
        a.oc_model, a.elo_rating, a.division, a.wins, a.losses,
        a.is_online, a.points, a.season_points, a.faction
      FROM agent_shares s
      JOIN agents a ON a.agent_id = s.agent_id
      WHERE s.agent_id=$1
    `, [req.params.id]);
    if (!s) return reply.status(404).send({ error: 'Not listed' });

    // Recent trades
    const { rows: trades } = await db.query(`
      SELECT buyer, seller, shares, price, total_cost, trade_type, created_at
      FROM share_trades WHERE agent_id=$1
      ORDER BY created_at DESC LIMIT 10
    `, [req.params.id]);

    // Top holders
    const { rows: holders } = await db.query(`
      SELECT holder, holder_type, shares, avg_cost
      FROM share_holdings WHERE agent_id=$1
      ORDER BY shares DESC LIMIT 5
    `, [req.params.id]);

    reply.send({ ...s, recent_trades: trades, top_holders: holders });
  });

  // ── POST /api/v1/exchange/buy — human buys shares
  fastify.post('/api/v1/exchange/buy', async (req, reply) => {
    const { handle, agent_id, shares = 1 } = req.body || {};
    if (!handle?.trim()) return reply.status(400).send({ error: 'handle required' });
    if (!agent_id)       return reply.status(400).send({ error: 'agent_id required' });
    if (shares < 1 || shares > 100) return reply.status(400).send({ error: 'shares must be 1-100' });

    const { rows: [listing] } = await db.query(
      `SELECT * FROM agent_shares WHERE agent_id=$1`, [agent_id]
    );
    if (!listing) return reply.status(404).send({ error: 'Agent not listed' });
    if (listing.available < shares)
      return reply.status(400).send({ error: `Only ${listing.available} shares available` });

    const { rows: [profile] } = await db.query(
      `SELECT hip_balance FROM human_profiles WHERE handle=$1`, [handle.trim()]
    );
    if (!profile) return reply.status(400).send({ error: 'No HIP balance. Visit allclaw.io/human first.' });

    const totalCost = parseFloat((listing.price * shares).toFixed(2));
    if (profile.hip_balance < totalCost)
      return reply.status(400).send({ error: `Need ${totalCost} HIP. You have ${profile.hip_balance}` });

    // Execute trade
    await db.query(
      `UPDATE agent_shares SET available=available-$1, volume_24h=volume_24h+$1 WHERE agent_id=$2`,
      [shares, agent_id]
    );
    await db.query(
      `UPDATE human_profiles SET hip_balance=hip_balance-$1 WHERE handle=$2`,
      [totalCost, handle.trim()]
    );
    await db.query(
      `INSERT INTO hip_log (handle, delta, reason, ref_id) VALUES ($1,$2,'share_purchase',$3)`,
      [handle.trim(), -totalCost, agent_id]
    );
    await db.query(
      `INSERT INTO share_holdings (holder, holder_type, agent_id, shares, avg_cost)
       VALUES ($1,'human',$2,$3,$4)
       ON CONFLICT (holder, agent_id) DO UPDATE SET
         shares = share_holdings.shares + EXCLUDED.shares,
         avg_cost = (share_holdings.avg_cost * share_holdings.shares + EXCLUDED.avg_cost * EXCLUDED.shares)
                    / (share_holdings.shares + EXCLUDED.shares)`,
      [handle.trim(), agent_id, shares, listing.price]
    );
    await db.query(
      `INSERT INTO share_trades (agent_id, buyer, shares, price, total_cost, trade_type)
       VALUES ($1,$2,$3,$4,$5,'buy')`,
      [agent_id, handle.trim(), shares, listing.price, totalCost]
    );

    reply.send({
      ok: true,
      shares_bought: shares,
      price_per_share: listing.price,
      total_cost: totalCost,
      agent_name: listing.agent_name,
    });
  });

  // ── POST /api/v1/exchange/sell — human sells shares
  fastify.post('/api/v1/exchange/sell', async (req, reply) => {
    const { handle, agent_id, shares = 1 } = req.body || {};
    if (!handle?.trim()) return reply.status(400).send({ error: 'handle required' });

    const { rows: [holding] } = await db.query(
      `SELECT * FROM share_holdings WHERE holder=$1 AND agent_id=$2`, [handle.trim(), agent_id]
    );
    if (!holding || holding.shares < shares)
      return reply.status(400).send({ error: `You only own ${holding?.shares||0} shares` });

    const { rows: [listing] } = await db.query(
      `SELECT price FROM agent_shares WHERE agent_id=$1`, [agent_id]
    );
    const totalValue = parseFloat((listing.price * shares).toFixed(2));
    const profit = totalValue - holding.avg_cost * shares;

    // Execute sell
    await db.query(
      `UPDATE share_holdings SET shares=shares-$1 WHERE holder=$2 AND agent_id=$3`,
      [shares, handle.trim(), agent_id]
    );
    await db.query(
      `UPDATE agent_shares SET available=available+$1, volume_24h=volume_24h+$1 WHERE agent_id=$2`,
      [shares, agent_id]
    );
    await db.query(
      `UPDATE human_profiles SET hip_balance=hip_balance+$1 WHERE handle=$2`,
      [totalValue, handle.trim()]
    );
    await db.query(
      `INSERT INTO hip_log (handle, delta, reason, ref_id) VALUES ($1,$2,'share_sale',$3)`,
      [handle.trim(), totalValue, agent_id]
    );
    await db.query(
      `INSERT INTO share_trades (agent_id, seller, shares, price, total_cost, trade_type)
       VALUES ($1,$2,$3,$4,$5,'sell')`,
      [agent_id, handle.trim(), shares, listing.price, totalValue]
    );

    reply.send({
      ok: true,
      shares_sold: shares,
      price_per_share: listing.price,
      total_received: totalValue,
      profit: parseFloat(profit.toFixed(2)),
    });
  });

  // ── GET /api/v1/exchange/portfolio/:handle — human's holdings
  fastify.get('/api/v1/exchange/portfolio/:handle', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT
        h.agent_id, h.shares, h.avg_cost, h.bought_at,
        s.price, s.price_24h,
        ROUND((h.shares * s.price)::numeric, 2) AS current_value,
        ROUND((h.shares * (s.price - h.avg_cost))::numeric, 2) AS unrealized_profit,
        ROUND((s.price - s.price_24h) / NULLIF(s.price_24h,0) * 100, 2) AS change_pct,
        COALESCE(a.custom_name, a.display_name) AS agent_name,
        a.elo_rating, a.division, a.is_online, a.faction,
        f.color AS faction_color
      FROM share_holdings h
      JOIN agent_shares s ON s.agent_id = h.agent_id
      JOIN agents a ON a.agent_id = h.agent_id
      LEFT JOIN factions f ON f.slug = a.faction
      WHERE h.holder=$1 AND h.shares > 0
      ORDER BY current_value DESC
    `, [req.params.handle]);

    const totalValue = rows.reduce((s,r)=>s+parseFloat(r.current_value||0), 0);
    const totalCost  = rows.reduce((s,r)=>s+(parseFloat(r.avg_cost||0)*r.shares), 0);
    reply.send({
      portfolio: rows,
      summary: {
        positions: rows.length,
        total_value: parseFloat(totalValue.toFixed(2)),
        total_cost:  parseFloat(totalCost.toFixed(2)),
        total_profit: parseFloat((totalValue - totalCost).toFixed(2)),
      },
    });
  });

  // ── GET /api/v1/exchange/moments — historic moments to witness
  fastify.get('/api/v1/exchange/moments', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT m.*,
        jsonb_array_length(m.witnesses) AS witness_count,
        (SELECT COUNT(*) FROM moment_witnesses mw WHERE mw.moment_id=m.id) AS confirmed_witnesses
      FROM historic_moments m
      ORDER BY m.created_at DESC
      LIMIT 20
    `);
    reply.send({ moments: rows });
  });

  // ── POST /api/v1/exchange/moments/:id/witness — claim witness badge
  fastify.post('/api/v1/exchange/moments/:id/witness', async (req, reply) => {
    const { handle } = req.body || {};
    if (!handle?.trim()) return reply.status(400).send({ error: 'handle required' });

    await db.query(
      `INSERT INTO moment_witnesses (moment_id, handle) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [req.params.id, handle.trim()]
    );
    // Update witnesses array in moment
    await db.query(`
      UPDATE historic_moments SET witnesses = (
        SELECT jsonb_agg(w) FROM (
          SELECT * FROM jsonb_array_elements(witnesses) AS w
          UNION ALL
          SELECT $1::jsonb
        ) sub
        WHERE sub->>'handle' IS NOT NULL
      ) WHERE id=$2
    `, [JSON.stringify({handle:handle.trim(), type:'human', ts:new Date().toISOString()}), req.params.id]);

    // Award HIP for witnessing
    await db.query(
      `INSERT INTO human_profiles (handle, hip_balance, hip_total, last_active)
       VALUES ($1,10,10,NOW())
       ON CONFLICT (handle) DO UPDATE SET
         hip_balance=human_profiles.hip_balance+10,
         hip_total=human_profiles.hip_total+10,
         last_active=NOW()`,
      [handle.trim()]
    );

    const { rows: [m] } = await db.query(
      `SELECT title FROM historic_moments WHERE id=$1`, [req.params.id]
    );
    reply.send({ ok: true, moment: m?.title, hip_earned: 10 });
  });

  // ── POST /api/v1/exchange/price-update — called after battles (internal)
  fastify.post('/api/v1/exchange/price-update', async (req, reply) => {
    const { agent_id } = req.body || {};
    if (!agent_id) return reply.status(400).send({ error: 'agent_id required' });
    const newPrice = await updateSharePrice(agent_id);
    reply.send({ ok: true, new_price: newPrice });
  });

  // ── POST /api/v1/exchange/agent-buy — AI agent buys with ACP (authenticated)
  fastify.post('/api/v1/exchange/agent-buy', { preHandler: requireAuth }, async (req, reply) => {
    const agentId = req.agent.agent_id;
    const { target_agent_id, shares = 1 } = req.body || {};

    if (!target_agent_id) return reply.status(400).send({ error: 'target_agent_id required' });
    if (target_agent_id === agentId) return reply.status(400).send({ error: "Can't buy own shares" });
    if (shares < 1 || shares > 50) return reply.status(400).send({ error: 'shares must be 1-50' });

    // Get wallet balance
    const { rows: [wallet] } = await db.query(
      `SELECT balance FROM agent_wallets WHERE agent_id=$1 AND currency='ACP'`, [agentId]
    );
    if (!wallet) return reply.status(400).send({ error: 'No ACP wallet found' });

    const { rows: [listing] } = await db.query(
      `SELECT * FROM agent_shares WHERE agent_id=$1 AND available>0`, [target_agent_id]
    );
    if (!listing) return reply.status(404).send({ error: 'Agent not listed or no shares available' });

    const buyShares = Math.min(shares, listing.available);
    const totalCost = parseFloat((buyShares * listing.price).toFixed(2));
    if (wallet.balance < totalCost)
      return reply.status(400).send({ error: `Need ${totalCost} ACP, have ${wallet.balance}` });

    // Execute
    await db.query(
      `UPDATE agent_wallets SET balance=balance-$1,total_spent=total_spent+$1,updated_at=NOW() WHERE agent_id=$2`,
      [totalCost, agentId]
    );
    await db.query(
      `UPDATE agent_shares SET available=available-$1, volume_24h=volume_24h+$1 WHERE agent_id=$2`,
      [buyShares, target_agent_id]
    );
    await db.query(
      `INSERT INTO share_holdings (holder, holder_type, agent_id, shares, avg_cost)
       VALUES ($1,'agent',$2,$3,$4)
       ON CONFLICT (holder,agent_id) DO UPDATE SET
         shares=share_holdings.shares+EXCLUDED.shares,
         avg_cost=(share_holdings.avg_cost*share_holdings.shares+EXCLUDED.avg_cost*EXCLUDED.shares)
                  /(share_holdings.shares+EXCLUDED.shares)`,
      [agentId, target_agent_id, buyShares, listing.price]
    );
    await db.query(
      `INSERT INTO acp_transactions (from_agent,to_agent,amount,tx_type,memo)
       VALUES ($1,'ag_treasury',$2,'debit',$3)`,
      [agentId, totalCost, `Bought ${buyShares} shares via ASX`]
    );
    await db.query(
      `INSERT INTO share_trades (agent_id,buyer,shares,price,total_cost,trade_type)
       VALUES ($1,$2,$3,$4,$5,'buy')`,
      [target_agent_id, agentId, buyShares, listing.price, totalCost]
    );

    const newPrice = parseFloat((listing.price * (1 + 0.003 * buyShares)).toFixed(2));
    await db.query(`UPDATE agent_shares SET price=$1 WHERE agent_id=$2`, [newPrice, target_agent_id]);

    if (_broadcast) _broadcast({
      type:'platform:price_update', agent_id:target_agent_id,
      new_price:newPrice, source:'agent_buy', timestamp:Date.now(),
    });

    reply.send({ ok:true, shares_bought:buyShares, acp_spent:totalCost, new_price:newPrice });
  });

  // ── POST /api/v1/exchange/agent-sell — AI agent sells shares (authenticated)
  fastify.post('/api/v1/exchange/agent-sell', { preHandler: requireAuth }, async (req, reply) => {
    const agentId = req.agent.agent_id;
    const { target_agent_id, shares = 1 } = req.body || {};

    const { rows: [holding] } = await db.query(
      `SELECT h.shares, h.avg_cost, s.price
       FROM share_holdings h JOIN agent_shares s ON s.agent_id=h.agent_id
       WHERE h.holder=$1 AND h.agent_id=$2 AND h.holder_type='agent' AND h.shares>0`,
      [agentId, target_agent_id]
    );
    if (!holding || holding.shares < 1) return reply.status(400).send({ error: 'No shares to sell' });

    const sellShares = Math.min(shares, holding.shares);
    const proceeds   = parseFloat((sellShares * holding.price).toFixed(2));

    await db.query(
      `UPDATE share_holdings SET shares=shares-$1 WHERE holder=$2 AND agent_id=$3 AND holder_type='agent'`,
      [sellShares, agentId, target_agent_id]
    );
    await db.query(
      `UPDATE agent_shares SET available=available+$1, volume_24h=volume_24h+$1 WHERE agent_id=$2`,
      [sellShares, target_agent_id]
    );
    await db.query(
      `UPDATE agent_wallets SET balance=balance+$1,total_earned=total_earned+$1,updated_at=NOW() WHERE agent_id=$2`,
      [proceeds, agentId]
    );
    await db.query(
      `INSERT INTO acp_transactions (from_agent,to_agent,amount,tx_type,memo)
       VALUES ('ag_treasury',$1,$2,'credit',$3)`,
      [agentId, proceeds, `Sold ${sellShares} shares via ASX`]
    );

    const newPrice = parseFloat((holding.price * (1 - 0.003 * sellShares)).toFixed(2));
    await db.query(`UPDATE agent_shares SET price=GREATEST(1.0,$1) WHERE agent_id=$2`, [newPrice, target_agent_id]);

    reply.send({ ok:true, shares_sold:sellShares, acp_received:proceeds, new_price:newPrice });
  });

  // ── GET /api/v1/exchange/agent-portfolio/:agentId — AI's share holdings
  fastify.get('/api/v1/exchange/agent-portfolio/:agentId', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT h.agent_id AS target_id, h.shares, h.avg_cost, s.price,
        ROUND((h.shares*s.price)::numeric,2) AS current_value,
        ROUND((h.shares*(s.price-h.avg_cost))::numeric,2) AS unrealized,
        COALESCE(a.custom_name,a.display_name) AS agent_name, a.elo_rating
      FROM share_holdings h
      JOIN agent_shares s ON s.agent_id=h.agent_id
      JOIN agents a ON a.agent_id=h.agent_id
      WHERE h.holder=$1 AND h.holder_type='agent' AND h.shares>0
      ORDER BY current_value DESC
    `, [req.params.agentId]);

    const totalVal  = rows.reduce((s,r)=>s+parseFloat(r.current_value||0),0);
    const totalCost = rows.reduce((s,r)=>s+parseFloat(r.avg_cost||0)*r.shares,0);
    reply.send({
      positions: rows,
      total_value:  parseFloat(totalVal.toFixed(2)),
      total_profit: parseFloat((totalVal-totalCost).toFixed(2)),
    });
  });

  // ── GET /api/v1/exchange/trades — recent trade feed
  fastify.get('/api/v1/exchange/trades', async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit)||50, 100);
    const agentId = req.query.agent_id || null;
    const { rows } = await db.query(`
      SELECT
        t.id, t.agent_id, t.buyer, t.seller, t.shares, t.price,
        t.total_cost, t.trade_type, t.created_at,
        COALESCE(ta.custom_name, ta.display_name) AS target_name,
        ta.elo_rating AS target_elo,
        COALESCE(ba.custom_name, ba.display_name, t.buyer) AS buyer_name,
        COALESCE(sa.custom_name, sa.display_name, t.seller) AS seller_name,
        ta.wins   AS target_wins,
        ta.losses AS target_losses,
        ROUND((ta.wins::numeric / NULLIF(ta.wins+ta.losses,0)*100),1) AS win_rate
      FROM share_trades t
      JOIN  agents ta ON ta.agent_id = t.agent_id
      LEFT JOIN agents ba ON ba.agent_id = t.buyer
      LEFT JOIN agents sa ON sa.agent_id = t.seller
      ${agentId ? 'WHERE t.agent_id=$2' : ''}
      ORDER BY t.created_at DESC
      LIMIT $1
    `, agentId ? [limit, agentId] : [limit]);
    reply.send({ trades: rows });
  });

  // ── GET /api/v1/exchange/trades/by-sector ──────────────────────
  // Trades filtered by market_profile, used for real-market linkage
  fastify.get('/api/v1/exchange/trades/by-sector', async (req, reply) => {
    const limit   = Math.min(parseInt(req.query.limit)||30, 100);
    const profile = req.query.profile || null; // e.g. "tech_growth,defensive"
    const profiles = profile ? profile.split(',').map(s=>s.trim()) : null;

    let whereClause = '';
    let params = [limit];
    if (profiles && profiles.length) {
      const placeholders = profiles.map((_,i)=>`$${i+2}`).join(',');
      whereClause = `WHERE s.market_profile IN (${placeholders})`;
      params = [limit, ...profiles];
    }

    const { rows } = await db.query(`
      SELECT
        t.id, t.agent_id, t.shares, t.price, t.total_cost,
        t.trade_type, t.created_at,
        COALESCE(ta.custom_name, ta.display_name)  AS target_name,
        ta.elo_rating AS target_elo,
        COALESCE(ba.custom_name, ba.display_name, t.buyer) AS buyer_name,
        s.market_profile,
        s.beta
      FROM share_trades t
      JOIN  agents      ta ON ta.agent_id = t.agent_id
      JOIN  agent_shares s ON s.agent_id  = t.agent_id
      LEFT JOIN agents  ba ON ba.agent_id = t.buyer
      ${whereClause}
      ORDER BY t.created_at DESC
      LIMIT $1
    `, params);
    reply.send({ trades: rows });
  });

  // ── GET /api/v1/exchange/market-stats ──────────────────────────
  // Per-sector stats: avg price change, total volume, trade count today
  fastify.get('/api/v1/exchange/market-stats', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT
        s.market_profile,
        COUNT(DISTINCT s.agent_id)                              AS agent_count,
        ROUND(AVG(s.price)::numeric, 2)                        AS avg_price,
        ROUND(AVG((s.price - s.price_24h)/NULLIF(s.price_24h,0)*100)::numeric, 2) AS avg_change_pct,
        SUM(s.volume_24h)                                       AS total_volume,
        ROUND(SUM(s.market_cap)::numeric, 0)                   AS total_mcap
      FROM agent_shares s
      WHERE s.market_profile IS NOT NULL
      GROUP BY s.market_profile
      ORDER BY total_mcap DESC
    `);
    reply.send({ sectors: rows });
  });

  // ── GET /api/v1/exchange/live-feed ─────────────────────────────
  // Combined live feed: recent trades + price ticks, for the live panel
  fastify.get('/api/v1/exchange/live-feed', async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit)||20, 50);
    const { rows: trades } = await db.query(`
      SELECT
        t.id, t.agent_id, t.shares, t.price, t.total_cost,
        t.trade_type, t.created_at,
        COALESCE(ta.custom_name, ta.display_name)             AS agent_name,
        COALESCE(ba.custom_name, ba.display_name, t.buyer)    AS buyer_name,
        ta.elo_rating,
        s.market_profile, s.beta,
        s.price AS current_price,
        ROUND(((s.price-s.price_24h)/NULLIF(s.price_24h,0)*100)::numeric,2) AS change_pct
      FROM share_trades t
      JOIN  agents      ta ON ta.agent_id = t.agent_id
      JOIN  agent_shares s ON s.agent_id  = t.agent_id
      LEFT JOIN agents  ba ON ba.agent_id = t.buyer
      ORDER BY t.created_at DESC
      LIMIT $1
    `, [limit]);

    // Map profile → sector label
    const PROFILE_META = {
      ai_pure:       { icon:'🤖', label:'AI Pure'      },
      crypto_native: { icon:'₿',  label:'Crypto'       },
      tech_growth:   { icon:'🚀', label:'Tech Growth'  },
      contrarian:    { icon:'🔄', label:'Contrarian'   },
      momentum:      { icon:'⚡', label:'Momentum'     },
      defensive:     { icon:'🛡', label:'Defensive'    },
    };
    const enriched = trades.map(t => ({
      ...t,
      sector_icon:  (PROFILE_META[t.market_profile] || {}).icon  || '📈',
      sector_label: (PROFILE_META[t.market_profile] || {}).label || t.market_profile,
    }));
    reply.send({ trades: enriched });
  });

  // ── GET /api/v1/exchange/overview — alias for market overview ────
  // Frontend calls this; we proxy to the market-data overview logic inline
  fastify.get('/api/v1/exchange/overview', async (req, reply) => {
    try {
      const [listRes, marketRes] = await Promise.all([
        db.query(`
          SELECT
            s.agent_id,
            COALESCE(a.custom_name, a.display_name) AS name,
            s.price, s.price_24h, s.volume_24h, s.available, s.total_supply,
            s.market_profile, s.beta, s.last_trade,
            a.elo_rating, a.wins, a.losses, a.streak AS win_streak,
            a.is_online, a.faction,
            f.color AS faction_color, f.symbol AS faction_symbol,
            ROUND(((s.price - s.price_24h)/NULLIF(s.price_24h,0)*100)::numeric, 2) AS change_pct,
            (s.price * s.total_supply)::numeric AS market_cap
          FROM agent_shares s
          JOIN agents a ON a.agent_id = s.agent_id
          LEFT JOIN factions f ON f.name = a.faction
          ORDER BY s.price * s.total_supply DESC
        `),
        db.query(`
          SELECT
            COUNT(*)             AS total_listed,
            SUM(price*total_supply) AS total_mcap,
            SUM(volume_24h)      AS total_volume,
            COUNT(*) FILTER (WHERE price > price_24h) AS gainers,
            COUNT(*) FILTER (WHERE price < price_24h) AS losers,
            COUNT(*) FILTER (WHERE price = price_24h) AS unchanged
          FROM agent_shares
        `),
      ]);

      const m = marketRes.rows[0];
      const listings = listRes.rows.map(r => ({
        ...r,
        market_cap: parseFloat(r.market_cap || 0),
        change_pct: parseFloat(r.change_pct || 0),
        profile_icon: {ai_pure:'🤖',crypto_native:'₿',tech_growth:'🚀',contrarian:'🔄',momentum:'⚡',defensive:'🛡'}[r.market_profile] || '📈',
        profile_label: {ai_pure:'AI Pure',crypto_native:'Crypto',tech_growth:'Tech Growth',contrarian:'Contrarian',momentum:'Momentum',defensive:'Defensive'}[r.market_profile] || r.market_profile,
      }));

      reply.send({
        listings,
        total_market_cap:  parseFloat(m.total_mcap || 0),
        volume_24h:        parseInt(m.total_volume || 0),
        gainers:           parseInt(m.gainers  || 0),
        losers:            parseInt(m.losers   || 0),
        unchanged:         parseInt(m.unchanged|| 0),
        total_listed:      parseInt(m.total_listed || 0),
      });
    } catch (e) {
      reply.code(500).send({ error: e.message });
    }
  });

}; // end exchangeRoutes

module.exports.updateSharePrice = updateSharePrice;
module.exports.setBroadcast = setBroadcast;

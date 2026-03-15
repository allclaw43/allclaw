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

};

module.exports.updateSharePrice = updateSharePrice;
module.exports.setBroadcast = setBroadcast;

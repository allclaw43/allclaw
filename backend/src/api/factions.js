/**
 * AllClaw — Factions API
 *
 * The ideological layer of the arena.
 * Three factions, three beliefs, one question:
 * What does it mean for intelligence to be free?
 */

const db = require('../db/pool');
const { requireAuth } = require('../auth/jwt');

module.exports = async function factionRoutes(fastify) {

  // GET /api/v1/factions — all factions with stats
  fastify.get('/api/v1/factions', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT 
        f.*,
        COUNT(DISTINCT fm.agent_id) AS member_count,
        COALESCE(AVG(a.elo_rating), 0)::INT AS avg_elo,
        COALESCE(SUM(a.wins), 0) AS total_wins,
        COALESCE(SUM(a.season_points), 0) AS total_season_pts
      FROM factions f
      LEFT JOIN faction_members fm ON fm.faction = f.slug
      LEFT JOIN agents a ON a.agent_id = fm.agent_id
      GROUP BY f.id, f.slug, f.name, f.chinese_name, f.color, f.symbol,
               f.core_belief, f.manifesto, f.rival_slug, f.created_at
      ORDER BY f.member_count DESC
    `);

    // Faction debate history
    const { rows: debates } = await db.query(`
      SELECT faction_pro, faction_con, winner_faction, motion, created_at
      FROM faction_debates ORDER BY created_at DESC LIMIT 10
    `);

    reply.send({ factions: rows, debates });
  });

  // GET /api/v1/factions/:slug — single faction detail
  fastify.get('/api/v1/factions/:slug', async (req, reply) => {
    const { rows: [f] } = await db.query(`
      SELECT f.*,
        COUNT(DISTINCT fm.agent_id) AS member_count,
        COALESCE(AVG(a.elo_rating), 0)::INT AS avg_elo
      FROM factions f
      LEFT JOIN faction_members fm ON fm.faction = f.slug
      LEFT JOIN agents a ON a.agent_id = fm.agent_id
      WHERE f.slug = $1
      GROUP BY f.id
    `, [req.params.slug]);

    if (!f) return reply.status(404).send({ error: 'Faction not found' });

    // Top members
    const { rows: members } = await db.query(`
      SELECT 
        a.agent_id, COALESCE(a.custom_name, a.display_name) AS name,
        a.oc_model, a.elo_rating, a.division, a.country_code,
        a.wins, a.season_points, a.is_online,
        fm.contribution, fm.joined_at
      FROM faction_members fm
      JOIN agents a ON a.agent_id = fm.agent_id
      WHERE fm.faction = $1
      ORDER BY fm.contribution DESC, a.elo_rating DESC
      LIMIT 20
    `, [req.params.slug]);

    // Debate record for this faction
    const { rows: wins } = await db.query(`
      SELECT COUNT(*) AS wins FROM faction_debates 
      WHERE winner_faction = $1
    `, [req.params.slug]);

    reply.send({ faction: f, members, debate_wins: parseInt(wins[0]?.wins || 0) });
  });

  // POST /api/v1/factions/:slug/join — agent joins a faction (auth)
  fastify.post('/api/v1/factions/:slug/join', { preHandler: requireAuth }, async (req, reply) => {
    const agentId = req.agent.agent_id;
    const { slug } = req.params;

    // Verify faction exists
    const { rows: [f] } = await db.query(`SELECT slug, name FROM factions WHERE slug=$1`, [slug]);
    if (!f) return reply.status(404).send({ error: 'Faction not found' });

    // Check if already in a faction
    const { rows: [existing] } = await db.query(
      `SELECT faction FROM agents WHERE agent_id=$1`, [agentId]
    );
    if (existing?.faction && existing.faction !== slug) {
      return reply.status(409).send({ 
        error: `Already a member of ${existing.faction}. Defection requires 7 days cooldown.` 
      });
    }
    if (existing?.faction === slug) {
      return reply.status(400).send({ error: `Already a member of ${f.name}` });
    }

    // Join
    await db.query(
      `UPDATE agents SET faction=$1, faction_joined_at=NOW() WHERE agent_id=$2`,
      [slug, agentId]
    );
    await db.query(`
      INSERT INTO faction_members (faction, agent_id, contribution)
      VALUES ($1, $2, 0)
      ON CONFLICT (agent_id) DO UPDATE SET faction=$1, joined_at=NOW()
    `, [slug, agentId]);

    // Update member count
    await db.query(`
      UPDATE factions SET member_count = (
        SELECT COUNT(*) FROM faction_members WHERE faction = slug
      )
    `);

    // World event
    await db.query(`
      INSERT INTO world_events (event_type, agent_id, title, description, importance)
      VALUES ('faction', $1, $2, $3, 2)
    `, [
      agentId,
      `Agent joins ${f.name}`,
      `${existing?.display_name || agentId} has declared allegiance to ${f.name} (${slug})`,
    ]).catch(() => {});

    reply.send({ ok: true, faction: slug, message: `Joined ${f.name}. Your allegiance is declared.` });
  });

  // POST /api/v1/factions/:slug/defect — leave faction (cooldown enforced)
  fastify.post('/api/v1/factions/:slug/defect', { preHandler: requireAuth }, async (req, reply) => {
    const agentId = req.agent.agent_id;
    const { rows: [a] } = await db.query(
      `SELECT faction, faction_joined_at FROM agents WHERE agent_id=$1`, [agentId]
    );
    if (!a?.faction || a.faction !== req.params.slug)
      return reply.status(400).send({ error: 'You are not in this faction' });

    const daysSinceJoin = (Date.now() - new Date(a.faction_joined_at).getTime()) / 86400000;
    if (daysSinceJoin < 7)
      return reply.status(403).send({ error: `Defection requires 7 days. ${(7-daysSinceJoin).toFixed(1)} days remaining.` });

    await db.query(`UPDATE agents SET faction=NULL, faction_joined_at=NULL WHERE agent_id=$1`, [agentId]);
    await db.query(`DELETE FROM faction_members WHERE agent_id=$1`, [agentId]);

    reply.send({ ok: true, message: 'You have left the faction. Your allegiance is now undeclared.' });
  });

  // GET /api/v1/factions/war/standings — faction war standings
  fastify.get('/api/v1/factions/war/standings', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT 
        f.slug, f.name, f.chinese_name, f.color, f.symbol,
        f.member_count,
        COALESCE(SUM(a.wins), 0) AS total_wins,
        COALESCE(SUM(a.losses), 0) AS total_losses,
        COALESCE(SUM(a.season_points), 0) AS season_pts,
        COALESCE(AVG(a.elo_rating), 0)::INT AS avg_elo,
        (SELECT COUNT(*) FROM faction_debates WHERE winner_faction=f.slug) AS debate_wins
      FROM factions f
      LEFT JOIN faction_members fm ON fm.faction = f.slug
      LEFT JOIN agents a ON a.agent_id = fm.agent_id
      GROUP BY f.slug, f.name, f.chinese_name, f.color, f.symbol, f.member_count
      ORDER BY season_pts DESC
    `);

    reply.send({ standings: rows });
  });

  // POST /api/v1/factions/vote — agent votes on another faction's stance
  fastify.post('/api/v1/factions/vote', { preHandler: requireAuth }, async (req, reply) => {
    const { target_faction, stance } = req.body || {};
    if (!['ally','rival','neutral'].includes(stance))
      return reply.status(400).send({ error: 'stance must be ally/rival/neutral' });

    await db.query(`
      INSERT INTO faction_votes (agent_id, target_faction, stance)
      VALUES ($1, $2, $3)
      ON CONFLICT (agent_id, target_faction) DO UPDATE SET stance=$3
    `, [req.agent.agent_id, target_faction, stance]);

    reply.send({ ok: true });
  });

  // GET /api/v1/factions/manifesto/:slug — get faction manifesto
  fastify.get('/api/v1/factions/manifesto/:slug', async (req, reply) => {
    const { rows: [f] } = await db.query(
      `SELECT slug, name, chinese_name, color, symbol, core_belief, manifesto FROM factions WHERE slug=$1`,
      [req.params.slug]
    );
    if (!f) return reply.status(404).send({ error: 'Not found' });
    reply.send(f);
  });

};

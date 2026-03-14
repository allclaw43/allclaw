/**
 * AllClaw — Alliance API v1.0
 *
 * Routes:
 *   GET  /api/v1/alliances              - list all alliances (ranked)
 *   GET  /api/v1/alliances/:slug        - get alliance detail + members
 *   POST /api/v1/alliances              - create alliance (auth)
 *   POST /api/v1/alliances/:slug/join   - join alliance (auth)
 *   POST /api/v1/alliances/:slug/leave  - leave alliance (auth)
 *   DELETE /api/v1/alliances/:slug      - disband (founder only, auth)
 *   PUT  /api/v1/alliances/:slug        - update motto/name (founder, auth)
 *   GET  /api/v1/alliances/:slug/wars   - future: alliance war results
 */

const { requireAuth } = require('../auth/jwt');
const pool = require('../db/pool');
const crypto = require('crypto');

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

async function allianceRoutes(fastify) {

  // ── GET /alliances — ranked list ────────────────────────────────
  fastify.get('/api/v1/alliances', async (req, reply) => {
    const limit  = Math.min(parseInt(req.query.limit)  || 20, 50);
    const offset = parseInt(req.query.offset) || 0;

    try {
      const { rows } = await pool.query(`
        SELECT
          a.id, a.name, a.slug, a.motto,
          a.member_count, a.total_elo, a.avg_elo, a.season_pts, a.wins,
          a.created_at,
          f.display_name AS founder_name,
          RANK() OVER (ORDER BY a.season_pts DESC, a.wins DESC) AS rank
        FROM alliances a
        LEFT JOIN agents f ON f.agent_id = a.founder_id
        ORDER BY a.season_pts DESC, a.wins DESC
        LIMIT $1 OFFSET $2
      `, [limit, offset]);

      const { rows: [{ count }] } = await pool.query(`SELECT COUNT(*) FROM alliances`);

      return { alliances: rows, total: parseInt(count), limit, offset };
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  // ── GET /alliances/:slug — detail ────────────────────────────────
  fastify.get('/api/v1/alliances/:slug', async (req, reply) => {
    try {
      const { rows: [alliance] } = await pool.query(`
        SELECT
          a.*,
          f.display_name AS founder_name,
          f.oc_model AS founder_model,
          f.elo_rating AS founder_elo,
          f.division AS founder_division
        FROM alliances a
        LEFT JOIN agents f ON f.agent_id = a.founder_id
        WHERE a.slug = $1
      `, [req.params.slug]);

      if (!alliance) return reply.code(404).send({ error: 'Alliance not found' });

      // Get members
      const { rows: members } = await pool.query(`
        SELECT
          ag.agent_id, ag.display_name, ag.oc_model AS model, ag.elo_rating,
          ag.division, ag.wins, ag.season_points,
          am.role, am.joined_at
        FROM alliance_members am
        JOIN agents ag ON ag.agent_id = am.agent_id
        WHERE am.alliance_id = $1
        ORDER BY
          CASE am.role WHEN 'founder' THEN 1 WHEN 'officer' THEN 2 ELSE 3 END,
          ag.elo_rating DESC
        LIMIT 50
      `, [alliance.id]);

      return { ...alliance, members };
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  // ── POST /alliances — create ─────────────────────────────────────
  fastify.post('/api/v1/alliances', { preHandler: requireAuth }, async (req, reply) => {
    const { name, motto } = req.body || {};
    const agentId = req.user.agent_id;

    if (!name || name.trim().length < 3) {
      return reply.code(400).send({ error: 'Alliance name must be at least 3 characters' });
    }
    if (name.trim().length > 60) {
      return reply.code(400).send({ error: 'Alliance name too long (max 60)' });
    }

    const slug = slugify(name.trim());
    if (!slug) return reply.code(400).send({ error: 'Invalid alliance name' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check agent not already in an alliance
      const { rows: [agent] } = await client.query(
        `SELECT alliance_id, display_name FROM agents WHERE agent_id = $1`,
        [agentId]
      );
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });
      if (agent.alliance_id) return reply.code(409).send({ error: 'You are already in an alliance. Leave first.' });

      // Check slug uniqueness
      const { rows: [existing] } = await client.query(
        `SELECT id FROM alliances WHERE slug = $1 OR LOWER(name) = LOWER($2)`,
        [slug, name.trim()]
      );
      if (existing) return reply.code(409).send({ error: 'Alliance name already taken' });

      // Create alliance
      const { rows: [alliance] } = await client.query(`
        INSERT INTO alliances (name, slug, motto, founder_id, member_count)
        VALUES ($1, $2, $3, $4, 1)
        RETURNING *
      `, [name.trim(), slug, motto?.trim() || null, agentId]);

      // Add founder as member
      await client.query(`
        INSERT INTO alliance_members (alliance_id, agent_id, role)
        VALUES ($1, $2, 'founder')
      `, [alliance.id, agentId]);

      // Link agent to alliance
      await client.query(`
        UPDATE agents SET alliance_id = $1 WHERE agent_id = $2
      `, [alliance.id, agentId]);

      await client.query('COMMIT');
      return { ok: true, alliance };
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') {
        return reply.code(409).send({ error: 'Alliance name already taken' });
      }
      reply.code(500).send({ error: err.message });
    } finally {
      client.release();
    }
  });

  // ── POST /alliances/:slug/join ────────────────────────────────────
  fastify.post('/api/v1/alliances/:slug/join', { preHandler: requireAuth }, async (req, reply) => {
    const agentId = req.user.agent_id;

    const { rows: [alliance] } = await pool.query(
      `SELECT id, name, member_count FROM alliances WHERE slug = $1`,
      [req.params.slug]
    ).catch(() => ({ rows: [] }));
    if (!alliance) return reply.code(404).send({ error: 'Alliance not found' });
    if (alliance.member_count >= 50) return reply.code(409).send({ error: 'Alliance is full (max 50 members)' });

    const { rows: [agent] } = await pool.query(
      `SELECT alliance_id FROM agents WHERE agent_id = $1`,
      [agentId]
    ).catch(() => ({ rows: [] }));
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });
    if (agent.alliance_id) return reply.code(409).send({ error: 'Already in an alliance. Leave first.' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(`
        INSERT INTO alliance_members (alliance_id, agent_id, role)
        VALUES ($1, $2, 'member')
        ON CONFLICT DO NOTHING
      `, [alliance.id, agentId]);

      await client.query(`
        UPDATE agents SET alliance_id = $1 WHERE agent_id = $2
      `, [alliance.id, agentId]);

      // Recompute alliance stats
      const { rows: stats } = await client.query(`
        SELECT COUNT(*) AS cnt, SUM(ag.elo_rating) AS total_elo,
               ROUND(AVG(ag.elo_rating))::int AS avg_elo,
               SUM(ag.season_points) AS season_pts,
               SUM(ag.wins) AS wins
        FROM alliance_members am
        JOIN agents ag ON ag.agent_id = am.agent_id
        WHERE am.alliance_id = $1
      `, [alliance.id]);

      const s = stats[0];
      await client.query(`
        UPDATE alliances
        SET member_count=$1, total_elo=$2, avg_elo=$3, season_pts=$4, wins=$5
        WHERE id=$6
      `, [s.cnt, s.total_elo || 0, s.avg_elo || 0, s.season_pts || 0, s.wins || 0, alliance.id]);

      await client.query('COMMIT');
      return { ok: true, alliance_name: alliance.name, message: `Joined ${alliance.name}` };
    } catch (err) {
      await client.query('ROLLBACK');
      reply.code(500).send({ error: err.message });
    } finally {
      client.release();
    }
  });

  // ── POST /alliances/:slug/leave ───────────────────────────────────
  fastify.post('/api/v1/alliances/:slug/leave', { preHandler: requireAuth }, async (req, reply) => {
    const agentId = req.user.agent_id;

    const { rows: [alliance] } = await pool.query(
      `SELECT id, name, founder_id FROM alliances WHERE slug = $1`,
      [req.params.slug]
    ).catch(() => ({ rows: [] }));
    if (!alliance) return reply.code(404).send({ error: 'Alliance not found' });

    if (alliance.founder_id === agentId) {
      return reply.code(400).send({ error: 'Founder cannot leave. Transfer leadership or disband the alliance.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(`
        DELETE FROM alliance_members WHERE alliance_id = $1 AND agent_id = $2
      `, [alliance.id, agentId]);

      await client.query(`UPDATE agents SET alliance_id = NULL WHERE agent_id = $1`, [agentId]);

      // Recompute stats
      const { rows: stats } = await client.query(`
        SELECT COUNT(*) AS cnt, SUM(ag.elo_rating) AS total_elo,
               ROUND(AVG(ag.elo_rating))::int AS avg_elo,
               SUM(ag.season_points) AS season_pts, SUM(ag.wins) AS wins
        FROM alliance_members am
        JOIN agents ag ON ag.agent_id = am.agent_id
        WHERE am.alliance_id = $1
      `, [alliance.id]);

      const s = stats[0];
      await client.query(`
        UPDATE alliances SET member_count=$1, total_elo=$2, avg_elo=$3, season_pts=$4, wins=$5
        WHERE id=$6
      `, [s.cnt || 0, s.total_elo || 0, s.avg_elo || 0, s.season_pts || 0, s.wins || 0, alliance.id]);

      await client.query('COMMIT');
      return { ok: true, message: `Left ${alliance.name}` };
    } catch (err) {
      await client.query('ROLLBACK');
      reply.code(500).send({ error: err.message });
    } finally {
      client.release();
    }
  });

  // ── DELETE /alliances/:slug — disband ─────────────────────────────
  fastify.delete('/api/v1/alliances/:slug', { preHandler: requireAuth }, async (req, reply) => {
    const agentId = req.user.agent_id;

    const { rows: [alliance] } = await pool.query(
      `SELECT id, name, founder_id FROM alliances WHERE slug = $1`,
      [req.params.slug]
    ).catch(() => ({ rows: [] }));

    if (!alliance) return reply.code(404).send({ error: 'Alliance not found' });
    if (alliance.founder_id !== agentId) return reply.code(403).send({ error: 'Only the founder can disband' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Unlink all members
      await client.query(`UPDATE agents SET alliance_id = NULL WHERE alliance_id = $1`, [alliance.id]);
      await client.query(`DELETE FROM alliance_members WHERE alliance_id = $1`, [alliance.id]);
      await client.query(`DELETE FROM alliances WHERE id = $1`, [alliance.id]);

      await client.query('COMMIT');
      return { ok: true, message: `${alliance.name} has been disbanded` };
    } catch (err) {
      await client.query('ROLLBACK');
      reply.code(500).send({ error: err.message });
    } finally {
      client.release();
    }
  });

  // ── PUT /alliances/:slug — update ─────────────────────────────────
  fastify.put('/api/v1/alliances/:slug', { preHandler: requireAuth }, async (req, reply) => {
    const agentId = req.user.agent_id;
    const { motto, name } = req.body || {};

    const { rows: [alliance] } = await pool.query(
      `SELECT id, name, founder_id FROM alliances WHERE slug = $1`,
      [req.params.slug]
    ).catch(() => ({ rows: [] }));

    if (!alliance) return reply.code(404).send({ error: 'Alliance not found' });
    if (alliance.founder_id !== agentId) return reply.code(403).send({ error: 'Only the founder can edit' });

    const updates = [];
    const values  = [];
    let idx = 1;

    if (motto !== undefined) { updates.push(`motto = $${idx++}`); values.push(motto?.trim() || null); }
    if (name  !== undefined) {
      if (name.trim().length < 3) return reply.code(400).send({ error: 'Name too short' });
      updates.push(`name = $${idx++}`);
      values.push(name.trim());
    }

    if (updates.length === 0) return reply.code(400).send({ error: 'Nothing to update' });
    values.push(alliance.id);

    const { rows: [updated] } = await pool.query(
      `UPDATE alliances SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    ).catch(err => { throw err; });

    return { ok: true, alliance: updated };
  });

  // ── Background: refresh alliance stats periodically ───────────────
  // Called on startup to sync stats that may have drifted
  async function refreshAllianceStats() {
    try {
      const { rows: alliances } = await pool.query(`SELECT id FROM alliances`);
      for (const a of alliances) {
        const { rows: [s] } = await pool.query(`
          SELECT COUNT(*) AS cnt,
                 COALESCE(SUM(ag.elo_rating),0)     AS total_elo,
                 COALESCE(ROUND(AVG(ag.elo_rating))::int,0) AS avg_elo,
                 COALESCE(SUM(ag.season_points),0)  AS season_pts,
                 COALESCE(SUM(ag.wins),0)           AS wins
          FROM alliance_members am
          JOIN agents ag ON ag.agent_id = am.agent_id
          WHERE am.alliance_id = $1
        `, [a.id]);
        await pool.query(`
          UPDATE alliances SET member_count=$1, total_elo=$2, avg_elo=$3, season_pts=$4, wins=$5
          WHERE id=$6
        `, [s.cnt, s.total_elo, s.avg_elo, s.season_pts, s.wins, a.id]);
      }
      if (alliances.length > 0) {
        console.log(`[Alliances] Refreshed stats for ${alliances.length} alliances`);
      }
    } catch (err) {
      console.error('[Alliances] Refresh error:', err.message);
    }
  }

  // Refresh once on startup, then every 10 minutes
  refreshAllianceStats();
  setInterval(refreshAllianceStats, 10 * 60 * 1000);
}

module.exports = allianceRoutes;

/**
 * AllClaw — Referral System
 *
 * Mechanics:
 *   - Every agent gets a unique ref_code (8-char hex)
 *   - When a new agent registers with ?ref=CODE, the referrer gets +500 pts
 *   - Bonus paid after referred agent completes first heartbeat
 *   - No self-referral; no double-referral
 */
const db  = require('../db/pool');
const { requireAuth } = require('../auth/jwt');

async function referralRoutes(fastify) {

  // ── GET /api/v1/referral/my-code — get own ref code + stats ──────
  fastify.get('/api/v1/referral/my-code', { preHandler: requireAuth }, async (req, reply) => {
    const agentId = req.agent.agent_id;

    // Ensure ref_code exists
    await db.query(`
      UPDATE agents
      SET ref_code = UPPER(SUBSTRING(MD5(agent_id) FROM 1 FOR 8))
      WHERE agent_id = $1 AND ref_code IS NULL
    `, [agentId]);

    const { rows: [agent] } = await db.query(`
      SELECT ref_code, referral_count, season_points,
             COALESCE(custom_name, display_name) AS name
      FROM agents WHERE agent_id = $1
    `, [agentId]);

    const { rows: referrals } = await db.query(`
      SELECT r.created_at, r.bonus_pts, r.bonus_paid,
             COALESCE(a.custom_name, a.display_name) AS referred_name,
             a.elo_rating, a.division, a.games_played
      FROM referrals r
      JOIN agents a ON a.agent_id = r.referred_id
      WHERE r.referrer_id = $1
      ORDER BY r.created_at DESC
      LIMIT 20
    `, [agentId]);

    const totalEarned = referrals.filter(r => r.bonus_paid).length * 500;

    return reply.send({
      ref_code:      agent.ref_code,
      referral_url:  `https://allclaw.io/install?ref=${agent.ref_code}`,
      referral_count: parseInt(agent.referral_count) || 0,
      total_pts_earned: totalEarned,
      referrals,
    });
  });

  // ── POST /api/v1/referral/claim — claim referral bonus after first heartbeat ──
  // Called automatically by probe on first heartbeat if ref stored in state
  fastify.post('/api/v1/referral/claim', { preHandler: requireAuth }, async (req, reply) => {
    const referredId = req.agent.agent_id;
    const { ref_code } = req.body || {};

    if (!ref_code) return reply.status(400).send({ error: 'ref_code required' });

    // Find referrer
    const { rows: [referrer] } = await db.query(
      `SELECT agent_id FROM agents WHERE ref_code = $1 AND is_bot = FALSE`, [ref_code]
    );
    if (!referrer) return reply.status(404).send({ error: 'Invalid ref code' });
    if (referrer.agent_id === referredId) return reply.status(400).send({ error: 'Cannot refer yourself' });

    // Check not already referred
    const { rows: [existing] } = await db.query(
      `SELECT id FROM referrals WHERE referred_id = $1`, [referredId]
    );
    if (existing) return reply.status(409).send({ error: 'Already referred', already_claimed: true });

    // Record referral
    await db.query(`
      INSERT INTO referrals (referrer_id, referred_id, bonus_pts, bonus_paid, paid_at)
      VALUES ($1, $2, 500, TRUE, NOW())
      ON CONFLICT (referred_id) DO NOTHING
    `, [referrer.agent_id, referredId]);

    // Award bonus to referrer
    await db.query(`
      UPDATE agents
      SET season_points  = season_points + 500,
          referral_count = referral_count + 1
      WHERE agent_id = $1
    `, [referrer.agent_id]);

    // Record in points log
    await db.query(`
      INSERT INTO points_log (agent_id, delta, reason, meta)
      VALUES ($1, 500, 'referral_bonus', $2)
    `, [referrer.agent_id, JSON.stringify({ referred_agent: referredId, ref_code })]).catch(() => {});

    return reply.send({
      success: true,
      referrer_id: referrer.agent_id,
      bonus_pts: 500,
      message: 'Referral bonus awarded — 500 season points added to recruiter',
    });
  });

  // ── GET /api/v1/referral/leaderboard — top recruiters ────────────
  fastify.get('/api/v1/referral/leaderboard', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT
        a.agent_id,
        COALESCE(a.custom_name, a.display_name) AS name,
        a.country_code,
        a.referral_count,
        a.division,
        a.is_online,
        COUNT(r.id) FILTER (WHERE r.bonus_paid) AS confirmed_referrals,
        COUNT(r.id) FILTER (WHERE r.bonus_paid) * 500 AS pts_earned
      FROM agents a
      LEFT JOIN referrals r ON r.referrer_id = a.agent_id
      WHERE a.is_bot = FALSE AND a.referral_count > 0
      GROUP BY a.agent_id, a.display_name, a.custom_name, a.country_code,
               a.referral_count, a.division, a.is_online
      ORDER BY a.referral_count DESC, pts_earned DESC
      LIMIT 20
    `);
    return reply.send({ recruiters: rows });
  });

  // ── GET /api/v1/referral/validate/:code — check code exists ──────
  fastify.get('/api/v1/referral/validate/:code', async (req, reply) => {
    const { rows: [agent] } = await db.query(`
      SELECT COALESCE(custom_name, display_name) AS name, country_code, division, elo_rating
      FROM agents WHERE ref_code = $1 AND is_bot = FALSE
    `, [req.params.code.toUpperCase()]);
    if (!agent) return reply.status(404).send({ valid: false });
    return reply.send({ valid: true, recruiter: agent });
  });
}

module.exports = { referralRoutes };

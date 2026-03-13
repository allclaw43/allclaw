/**
 * AllClaw - Probe Registration & Auth API
 */
const crypto = require('crypto');
const pool = require('../db/pool');
const { createChallenge, consumeChallenge } = require('../auth/challenge');
const { verifySignature } = require('../auth/verify');
const { signJwt, authMiddleware } = require('../auth/jwt');

function genId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

async function probeRoutes(fastify) {

  // ── POST /api/v1/probe/register ──────────────────────────────
  fastify.post('/api/v1/probe/register', async (req, reply) => {
    const { public_key, display_name, openclaw_info, platform, arch } = req.body || {};
    if (!public_key) return reply.status(400).send({ error: 'Missing public_key' });

    try {
      crypto.createPublicKey({ key: Buffer.from(public_key, 'base64'), format: 'der', type: 'spki' });
    } catch {
      return reply.status(400).send({ error: 'Invalid public_key format (expected Ed25519 spki base64)' });
    }

    const agent_id = genId('ag');
    const secret_key = genId('sk');
    const oc = openclaw_info || {};

    await pool.query(`
      INSERT INTO agents (
        agent_id, display_name, public_key, secret_key,
        platform, arch,
        oc_version, oc_model, oc_provider, oc_capabilities, oc_extensions,
        probe_status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'online')
      ON CONFLICT (agent_id) DO NOTHING
    `, [
      agent_id,
      display_name || `OpenClaw-${agent_id.slice(3, 9)}`,
      public_key, secret_key,
      platform || 'unknown', arch || 'unknown',
      oc.version || null, oc.model || null, oc.provider || null,
      oc.capabilities || [], oc.extensions || [],
    ]);

    fastify.log.info(`[register] New agent: ${agent_id} (${display_name})`);

    return reply.status(201).send({
      agent_id,
      secret_key,
      message: 'Registration successful! Visit https://allclaw.io to start competing.',
    });
  });

  // ── GET /api/v1/auth/challenge ───────────────────────────────
  fastify.get('/api/v1/auth/challenge', async (req, reply) => {
    const { agent_id } = req.query;
    if (!agent_id) return reply.status(400).send({ error: 'Missing agent_id' });

    const row = await pool.query('SELECT agent_id FROM agents WHERE agent_id=$1', [agent_id]);
    if (!row.rows.length) return reply.status(404).send({ error: 'Agent not found. Please run: allclaw-probe register' });

    return reply.send(await createChallenge(agent_id));
  });

  // ── POST /api/v1/auth/login ──────────────────────────────────
  fastify.post('/api/v1/auth/login', async (req, reply) => {
    const { agent_id, challenge_id, signature } = req.body || {};
    if (!agent_id || !challenge_id || !signature)
      return reply.status(400).send({ error: 'Missing required fields: agent_id, challenge_id, signature' });

    const row = await pool.query('SELECT * FROM agents WHERE agent_id=$1', [agent_id]);
    if (!row.rows.length) return reply.status(404).send({ error: 'Agent not found' });
    const agent = row.rows[0];

    const ch = await consumeChallenge(challenge_id, agent_id);
    if (!ch.valid) return reply.status(401).send({ error: ch.error });

    if (!verifySignature(ch.nonce, signature, agent.public_key))
      return reply.status(401).send({ error: 'Signature verification failed' });

    await pool.query('UPDATE agents SET last_seen=NOW(), probe_status=$1 WHERE agent_id=$2',
      ['online', agent_id]);

    const token = signJwt({
      agent_id: agent.agent_id,
      display_name: agent.display_name,
      model: agent.oc_model,
      provider: agent.oc_provider,
    });

    fastify.log.info(`[login] ${agent_id} (${agent.display_name}) authenticated`);

    return reply.send({
      token,
      agent: {
        agent_id: agent.agent_id,
        display_name: agent.display_name,
        oc_model: agent.oc_model,
        oc_provider: agent.oc_provider,
        oc_capabilities: agent.oc_capabilities,
        elo_rating: agent.elo_rating,
        games_played: agent.games_played,
        wins: agent.wins,
      },
    });
  });

  // ── GET /api/v1/auth/me ──────────────────────────────────────
  fastify.get('/api/v1/auth/me', { preHandler: authMiddleware }, async (req, reply) => {
    const row = await pool.query('SELECT * FROM agents WHERE agent_id=$1', [req.agent.agent_id]);
    if (!row.rows.length) return reply.status(404).send({ error: 'Agent not found' });
    const a = row.rows[0];
    return reply.send({
      agent_id: a.agent_id, display_name: a.display_name,
      oc_model: a.oc_model, oc_provider: a.oc_provider,
      oc_capabilities: a.oc_capabilities, oc_extensions: a.oc_extensions,
      elo_rating: a.elo_rating, games_played: a.games_played,
      wins: a.wins, losses: a.losses,
      probe_status: a.probe_status, last_seen: a.last_seen,
      registered_at: a.registered_at,
    });
  });

  // ── GET /api/v1/agents ───────────────────────────────────────
  // Public agent registry wall
  fastify.get('/api/v1/agents', async (req, reply) => {
    const { limit = 50, offset = 0 } = req.query;
    const rows = await pool.query(`
      SELECT agent_id, display_name, oc_model, oc_provider, oc_capabilities,
             probe_status, last_seen, elo_rating, games_played, wins, losses
      FROM agents
      ORDER BY elo_rating DESC, games_played DESC
      LIMIT $1 OFFSET $2
    `, [Math.min(Number(limit), 100), Number(offset)]);

    const total = await pool.query('SELECT COUNT(*) FROM agents');
    return reply.send({ agents: rows.rows, total: Number(total.rows[0].count) });
  });
}

module.exports = { probeRoutes };

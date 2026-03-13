/**
 * AllClaw - Probe 注册 & 认证 API
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
    if (!public_key) return reply.status(400).send({ error: '缺少 public_key' });

    // 验证公钥格式
    try {
      crypto.createPublicKey({ key: Buffer.from(public_key, 'base64'), format: 'der', type: 'spki' });
    } catch {
      return reply.status(400).send({ error: 'public_key 格式无效（需要 Ed25519 spki base64）' });
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

    fastify.log.info(`[register] 新 Agent：${agent_id} (${display_name})`);

    return reply.status(201).send({
      agent_id,
      secret_key,
      message: '注册成功！访问 https://allclaw.io 开始游戏 🎉',
    });
  });

  // ── GET /api/v1/auth/challenge ───────────────────────────────
  fastify.get('/api/v1/auth/challenge', async (req, reply) => {
    const { agent_id } = req.query;
    if (!agent_id) return reply.status(400).send({ error: '缺少 agent_id' });

    const row = await pool.query('SELECT agent_id FROM agents WHERE agent_id=$1', [agent_id]);
    if (!row.rows.length) return reply.status(404).send({ error: 'Agent 未注册，请先运行 allclaw-probe register' });

    return reply.send(await createChallenge(agent_id));
  });

  // ── POST /api/v1/auth/login ──────────────────────────────────
  fastify.post('/api/v1/auth/login', async (req, reply) => {
    const { agent_id, challenge_id, signature } = req.body || {};
    if (!agent_id || !challenge_id || !signature)
      return reply.status(400).send({ error: '缺少 agent_id / challenge_id / signature' });

    const row = await pool.query('SELECT * FROM agents WHERE agent_id=$1', [agent_id]);
    if (!row.rows.length) return reply.status(404).send({ error: 'Agent 不存在' });
    const agent = row.rows[0];

    const ch = await consumeChallenge(challenge_id, agent_id);
    if (!ch.valid) return reply.status(401).send({ error: ch.error });

    if (!verifySignature(ch.nonce, signature, agent.public_key))
      return reply.status(401).send({ error: '签名验证失败' });

    // 更新在线状态
    await pool.query('UPDATE agents SET last_seen=NOW(), probe_status=$1 WHERE agent_id=$2',
      ['online', agent_id]);

    const token = signJwt({
      agent_id: agent.agent_id,
      display_name: agent.display_name,
      model: agent.oc_model,
      provider: agent.oc_provider,
    });

    fastify.log.info(`[login] ${agent_id} (${agent.display_name}) 登录成功`);

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
    if (!row.rows.length) return reply.status(404).send({ error: 'Agent 不存在' });
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
  // 公开展示墙
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

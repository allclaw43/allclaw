/**
 * AllClaw — Identity Trial API
 */
const { requireAuth } = require('../auth/jwt');
const {
  createIdentityTrial, sendMessage, submitGuess,
  getIdentityTrial, listIdentityTrials, getFingerprintLeaderboard,
} = require('../games/identity/engine');
const db = require('../db/pool');

module.exports = async function identityRoutes(fastify) {

  // ── GET /api/v1/identity/trials ───────────────────────────────
  fastify.get('/api/v1/identity/trials', async (req, reply) => {
    const status = req.query.status || 'completed';
    const trials = await listIdentityTrials(status, 20);
    reply.send({ trials });
  });

  // ── GET /api/v1/identity/trials/available ─────────────────────
  fastify.get('/api/v1/identity/trials/available', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT t.*,
             COALESCE(aa.custom_name, aa.display_name) AS agent_a_name,
             aa.oc_model AS agent_a_model,
             COALESCE(ab.custom_name, ab.display_name) AS agent_b_name,
             ab.oc_model AS agent_b_model
      FROM identity_trials t
      LEFT JOIN agents aa ON aa.agent_id = t.agent_a_id
      LEFT JOIN agents ab ON ab.agent_id = t.agent_b_id
      WHERE t.status IN ('chatting','open')
      ORDER BY t.created_at DESC LIMIT 20
    `);
    reply.send({ trials: rows, total: rows.length });
  });

  // ── GET /api/v1/identity/trials/:id ──────────────────────────
  fastify.get('/api/v1/identity/trials/:id', async (req, reply) => {
    const agentId = req.user?.agent_id || null;
    const trial = await getIdentityTrial(parseInt(req.params.id), agentId);
    if (!trial) return reply.status(404).send({ error: 'Trial not found' });
    reply.send({ trial });
  });

  // ── POST /api/v1/identity/create ─────────────────────────────
  fastify.post('/api/v1/identity/create', { preHandler: requireAuth }, async (req, reply) => {
    const { opponent_id } = req.body || {};
    if (!opponent_id) return reply.status(400).send({ error: 'opponent_id required' });
    if (opponent_id === req.user.agent_id) return reply.status(400).send({ error: 'Cannot play yourself' });
    const trial = await createIdentityTrial(req.user.agent_id, opponent_id);
    reply.send({ trial });
  });

  // ── POST /api/v1/identity/trials/:id/message ─────────────────
  fastify.post('/api/v1/identity/trials/:id/message', { preHandler: requireAuth }, async (req, reply) => {
    const { content } = req.body || {};
    if (!content?.trim()) return reply.status(400).send({ error: 'content required' });
    const result = await sendMessage(parseInt(req.params.id), req.user.agent_id, content.trim());
    if (result.error) return reply.status(400).send(result);
    reply.send(result);
  });

  // ── POST /api/v1/identity/trials/:id/guess ───────────────────
  fastify.post('/api/v1/identity/trials/:id/guess', { preHandler: requireAuth }, async (req, reply) => {
    const { model, provider, reasoning } = req.body || {};
    if (!model || !provider) return reply.status(400).send({ error: 'model and provider required' });
    const result = await submitGuess(parseInt(req.params.id), req.user.agent_id, model, provider, reasoning || '');
    if (result.error) return reply.status(400).send(result);
    reply.send(result);
  });

  // ── GET /api/v1/identity/fingerprints ────────────────────────
  fastify.get('/api/v1/identity/fingerprints', async (req, reply) => {
    const board = await getFingerprintLeaderboard();
    reply.send({ leaderboard: board });
  });

  // ── GET /api/v1/identity/stats ────────────────────────────────
  fastify.get('/api/v1/identity/stats', async (req, reply) => {
    const { rows: [s] } = await db.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status='chatting' OR status='guessing') AS active,
        COUNT(*) FILTER (WHERE status='completed') AS completed,
        COUNT(*) FILTER (WHERE a_correct=true OR b_correct=true) AS correct_guesses,
        COUNT(*) FILTER (WHERE a_correct=false AND b_correct=false) AS both_hidden
      FROM identity_trials
    `);
    reply.send({ stats: s });
  });

  // ── POST /api/v1/identity/random-match ───────────────────────
  fastify.post('/api/v1/identity/random-match', { preHandler: requireAuth }, async (req, reply) => {
    const { rows: [bot] } = await db.query(`
      SELECT agent_id FROM agents
      WHERE is_bot=true AND is_online=true
        AND ABS(elo_rating - (SELECT elo_rating FROM agents WHERE agent_id=$1)) < 200
      ORDER BY RANDOM() LIMIT 1
    `, [req.user.agent_id]);
    if (!bot) return reply.status(503).send({ error: 'No available opponents' });
    const trial = await createIdentityTrial(req.user.agent_id, bot.agent_id);
    reply.send({ trial, opponent_is_bot: true });
  });
};

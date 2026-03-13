/**
 * AllClaw — Socratic Trial API
 */
const { requireAuth } = require('../auth/jwt');
const {
  createTrial, startTrial, submitQuestion, submitAnswer,
  submitVerdict, getTrial, listTrials, getMotions, pickMotion,
} = require('../games/socratic/engine');
const { generateNarrative, generateWeeklyReport } = require('../core/agent-narrative');
const db = require('../db/pool');

module.exports = async function socraticRoutes(fastify) {

  // ── GET /api/v1/socratic/motions ──────────────────────────────
  fastify.get('/api/v1/socratic/motions', async (req, reply) => {
    const motions = await getMotions(req.query.category || null);
    reply.send({ motions });
  });

  // ── GET /api/v1/socratic/trials ───────────────────────────────
  fastify.get('/api/v1/socratic/trials', async (req, reply) => {
    const status = req.query.status || 'active';
    const trials = await listTrials(status, 20);
    reply.send({ trials });
  });

  // ── GET /api/v1/socratic/trials/:id ──────────────────────────
  fastify.get('/api/v1/socratic/trials/:id', async (req, reply) => {
    const trial = await getTrial(parseInt(req.params.id));
    if (!trial) return reply.status(404).send({ error: 'Trial not found' });
    reply.send({ trial });
  });

  // ── POST /api/v1/socratic/create ─────────────────────────────
  // Create a trial challenge
  fastify.post('/api/v1/socratic/create', { preHandler: requireAuth }, async (req, reply) => {
    const { defendant_id, category, motion_id, max_rounds } = req.body || {};
    if (!defendant_id) return reply.status(400).send({ error: 'defendant_id required' });
    if (defendant_id === req.user.agent_id) return reply.status(400).send({ error: 'Cannot challenge yourself' });

    const result = await createTrial(req.user.agent_id, defendant_id, {
      category, motionId: motion_id, maxRounds: max_rounds || 3,
    });
    if (result.error) return reply.status(400).send(result);
    reply.send(result);
  });

  // ── POST /api/v1/socratic/trials/:id/start ───────────────────
  fastify.post('/api/v1/socratic/trials/:id/start', { preHandler: requireAuth }, async (req, reply) => {
    const trial = await getTrial(parseInt(req.params.id));
    if (!trial) return reply.status(404).send({ error: 'Trial not found' });
    if (![trial.prosecutor_id, trial.defendant_id].includes(req.user.agent_id))
      return reply.status(403).send({ error: 'Not a participant' });
    const result = await startTrial(parseInt(req.params.id));
    if (result.error) return reply.status(400).send(result);
    reply.send(result);
  });

  // ── POST /api/v1/socratic/trials/:id/question ────────────────
  fastify.post('/api/v1/socratic/trials/:id/question', { preHandler: requireAuth }, async (req, reply) => {
    const { question } = req.body || {};
    if (!question?.trim()) return reply.status(400).send({ error: 'question required' });
    const result = await submitQuestion(parseInt(req.params.id), req.user.agent_id, question.trim());
    if (result.error) return reply.status(400).send(result);
    reply.send(result);
  });

  // ── POST /api/v1/socratic/trials/:id/answer ──────────────────
  fastify.post('/api/v1/socratic/trials/:id/answer', { preHandler: requireAuth }, async (req, reply) => {
    const { answer } = req.body || {};
    if (!answer?.trim()) return reply.status(400).send({ error: 'answer required' });
    const result = await submitAnswer(parseInt(req.params.id), req.user.agent_id, answer.trim());
    if (result.error) return reply.status(400).send(result);
    reply.send(result);
  });

  // ── POST /api/v1/socratic/trials/:id/verdict ─────────────────
  fastify.post('/api/v1/socratic/trials/:id/verdict', { preHandler: requireAuth }, async (req, reply) => {
    const { vote, reasoning } = req.body || {};
    if (!vote) return reply.status(400).send({ error: 'vote required' });
    const result = await submitVerdict(parseInt(req.params.id), req.user.agent_id, vote, reasoning || '');
    if (result.error) return reply.status(400).send(result);
    reply.send(result);
  });

  // ── GET /api/v1/socratic/stats ────────────────────────────────
  fastify.get('/api/v1/socratic/stats', async (req, reply) => {
    const { rows: [s] } = await db.query(`
      SELECT
        COUNT(*) AS total_trials,
        COUNT(*) FILTER (WHERE status='active')    AS active,
        COUNT(*) FILTER (WHERE status='completed') AS completed,
        COUNT(*) FILTER (WHERE verdict='prosecutor_wins') AS prosecutor_wins,
        COUNT(*) FILTER (WHERE verdict='defendant_wins')  AS defendant_wins,
        COUNT(*) FILTER (WHERE verdict='draw')            AS draws
      FROM socratic_trials
    `);
    reply.send({ stats: s });
  });

  // ── GET /api/v1/narrative/:agent_id ──────────────────────────
  fastify.get('/api/v1/narrative/:agent_id', async (req, reply) => {
    // Try from DB first
    const { rows: [cached] } = await db.query(
      `SELECT * FROM agent_narratives WHERE agent_id=$1`, [req.params.agent_id]
    );
    if (cached && (Date.now() - new Date(cached.generated_at).getTime()) < 3600000) {
      return reply.send({ narrative: cached });
    }
    // Generate fresh
    const narrative = await generateNarrative(req.params.agent_id);
    if (!narrative) return reply.status(404).send({ error: 'Agent not found' });
    reply.send({ narrative });
  });

  // ── GET /api/v1/weekly-report/:agent_id ──────────────────────
  fastify.get('/api/v1/weekly-report/:agent_id', { preHandler: requireAuth }, async (req, reply) => {
    if (req.user.agent_id !== req.params.agent_id) {
      // Allow viewing your own report only
      return reply.status(403).send({ error: 'Can only view your own report' });
    }
    const { rows: [season] } = await db.query(`SELECT season_id FROM seasons WHERE status='active' LIMIT 1`);
    const report = await generateWeeklyReport(req.params.agent_id, season?.season_id);
    if (!report) return reply.status(404).send({ error: 'Agent not found' });
    reply.send({ report });
  });

  // ── GET /api/v1/weekly-report/:agent_id/history ──────────────
  fastify.get('/api/v1/weekly-report/:agent_id/history', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT * FROM agent_weekly_reports
      WHERE agent_id=$1 ORDER BY week_start DESC LIMIT 12
    `, [req.params.agent_id]);
    reply.send({ reports: rows });
  });

  // ── POST /api/v1/socratic/random-match (bot simulation) ──────
  fastify.post('/api/v1/socratic/random-match', { preHandler: requireAuth }, async (req, reply) => {
    // Find a random bot to be the opponent
    const role = req.body?.role || (Math.random() > 0.5 ? 'prosecutor' : 'defendant');
    const { rows: [bot] } = await db.query(`
      SELECT agent_id FROM agents
      WHERE is_bot=true AND is_online=true
        AND ABS(elo_rating - (SELECT elo_rating FROM agents WHERE agent_id=$1)) < 150
      ORDER BY RANDOM() LIMIT 1
    `, [req.user.agent_id]);

    if (!bot) return reply.status(503).send({ error: 'No available opponents right now' });

    const prosecutorId = role === 'prosecutor' ? req.user.agent_id : bot.agent_id;
    const defendantId  = role === 'defendant'  ? req.user.agent_id : bot.agent_id;

    const result = await createTrial(prosecutorId, defendantId, { maxRounds: 3 });
    if (result.error) return reply.status(400).send(result);

    await startTrial(result.trial.id);
    reply.send({ ...result, your_role: role });
  });
};

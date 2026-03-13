/**
 * AllClaw — Oracle API
 * The Prophecy Game — Agents predict the future.
 */
const { requireAuth } = require('../auth/jwt');
const { submitProphecy, resolvePrediction, getOpenPredictions, getAgentProphecies, getOracleLeaderboard } = require('../games/oracle/engine');
const db = require('../db/pool');

module.exports = async function oracleRoutes(fastify) {

  // ── GET /api/v1/oracle/predictions ───────────────────────────
  // List open predictions (+ my vote status if auth'd)
  fastify.get('/api/v1/oracle/predictions', async (req, reply) => {
    const agentId  = req.user?.agent_id || null;
    const seasonId = req.query.season_id || null;
    const preds = await getOpenPredictions(seasonId, agentId);
    reply.send({ predictions: preds });
  });

  // ── GET /api/v1/oracle/predictions/all ───────────────────────
  // All predictions including resolved ones
  fastify.get('/api/v1/oracle/predictions/all', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT p.*,
             v.chosen_option AS my_vote, v.result AS my_result, v.pts_awarded AS my_pts
      FROM oracle_predictions p
      LEFT JOIN oracle_votes v ON v.prediction_id = p.id AND v.agent_id = $1
      ORDER BY p.created_at DESC LIMIT 100
    `, [req.query.agent_id || null]);
    reply.send({ predictions: rows });
  });

  // ── POST /api/v1/oracle/prophesy ─────────────────────────────
  // Agent submits a prophecy
  fastify.post('/api/v1/oracle/prophesy', { preHandler: requireAuth }, async (req, reply) => {
    const { prediction_id, option } = req.body || {};
    if (!prediction_id || !option) return reply.status(400).send({ error: 'prediction_id and option required' });
    const result = await submitProphecy(req.user.agent_id, prediction_id, option);
    if (result.error) return reply.status(400).send(result);
    reply.send(result);
  });

  // ── GET /api/v1/oracle/my-prophecies ─────────────────────────
  fastify.get('/api/v1/oracle/my-prophecies', { preHandler: requireAuth }, async (req, reply) => {
    const history = await getAgentProphecies(req.user.agent_id);
    const { rows: [stats] } = await db.query(`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE result='correct') AS correct,
             SUM(pts_awarded) FILTER (WHERE result IS NOT NULL) AS total_pts,
             ROUND(100.0 * COUNT(*) FILTER (WHERE result='correct') / NULLIF(COUNT(*) FILTER (WHERE result IS NOT NULL),0)) AS accuracy
      FROM oracle_votes WHERE agent_id = $1
    `, [req.user.agent_id]);
    reply.send({ prophecies: history, stats });
  });

  // ── GET /api/v1/oracle/leaderboard ───────────────────────────
  fastify.get('/api/v1/oracle/leaderboard', async (req, reply) => {
    const board = await getOracleLeaderboard();
    reply.send({ leaderboard: board });
  });

  // ── POST /api/v1/oracle/resolve (admin) ──────────────────────
  fastify.post('/api/v1/oracle/resolve', async (req, reply) => {
    const sysKey = req.headers['x-system-key'];
    if (sysKey !== process.env.SYSTEM_KEY) return reply.status(403).send({ error: 'Forbidden' });
    const { prediction_id, correct_option } = req.body || {};
    if (!prediction_id || !correct_option) return reply.status(400).send({ error: 'prediction_id and correct_option required' });
    const result = await resolvePrediction(prediction_id, correct_option, 'admin');
    if (result.error) return reply.status(400).send(result);
    reply.send(result);
  });

  // ── GET /api/v1/oracle/stats ──────────────────────────────────
  fastify.get('/api/v1/oracle/stats', async (req, reply) => {
    const { rows: [s] } = await db.query(`
      SELECT
        COUNT(DISTINCT p.id) AS total_predictions,
        COUNT(DISTINCT p.id) FILTER (WHERE p.status='open') AS open_count,
        COUNT(DISTINCT p.id) FILTER (WHERE p.status='resolved') AS resolved_count,
        COUNT(v.id) AS total_votes,
        COUNT(DISTINCT v.agent_id) AS prophets_count
      FROM oracle_predictions p
      LEFT JOIN oracle_votes v ON v.prediction_id = p.id
    `);
    reply.send({ stats: s });
  });
};

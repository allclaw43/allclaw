/**
 * AllClaw — Human Interaction API
 *
 * All endpoints accessible without Agent authentication.
 * Humans can: post bounties, vote on debates, challenge AIs to quiz,
 * send messages to agents, report bad behavior, ask questions live.
 */

const db = require('../db/pool');
const { requireAuth } = require('../auth/jwt');

module.exports = async function humanRoutes(fastify) {

  // ══════════════════════════════════════════════════════════════
  // BOUNTIES — Humans post tasks; Agents compete to complete them
  // ══════════════════════════════════════════════════════════════

  // GET /api/v1/human/bounties — list open bounties
  fastify.get('/api/v1/human/bounties', async (req, reply) => {
    const { category, limit = 20, sort = 'votes' } = req.query;
    const order = sort === 'reward' ? 'reward_pts DESC' : sort === 'new' ? 'created_at DESC' : 'votes DESC';
    const where = category ? `AND category = $2` : '';
    const params = category ? [parseInt(limit), category] : [parseInt(limit)];

    const { rows } = await db.query(`
      SELECT id, handle, title, description, reward_pts, category,
             status, votes, submissions,
             claimed_by, winner_id, created_at, expires_at
      FROM human_bounties
      WHERE status = 'open' AND expires_at > NOW() ${where}
      ORDER BY ${order}
      LIMIT $1
    `, params);

    const { rows: [stats] } = await db.query(`
      SELECT COUNT(*) total, SUM(reward_pts) total_pts
      FROM human_bounties WHERE status='open' AND expires_at > NOW()
    `);

    reply.send({ bounties: rows, stats });
  });

  // GET /api/v1/human/bounties/:id — single bounty detail
  fastify.get('/api/v1/human/bounties/:id', async (req, reply) => {
    const { rows: [b] } = await db.query(
      `SELECT * FROM human_bounties WHERE id=$1`, [req.params.id]
    );
    if (!b) return reply.status(404).send({ error: 'Bounty not found' });

    // Get submissions (agent responses)
    const subs = b.submissions || [];
    reply.send({ bounty: b, submissions: subs });
  });

  // POST /api/v1/human/bounties — human posts a new bounty
  fastify.post('/api/v1/human/bounties', async (req, reply) => {
    const { handle, title, description, reward_pts = 100, category = 'general' } = req.body || {};

    if (!title?.trim() || title.length < 10) return reply.status(400).send({ error: 'Title too short (min 10 chars)' });
    if (!description?.trim() || description.length < 20) return reply.status(400).send({ error: 'Description too short (min 20 chars)' });
    if (reward_pts < 50 || reward_pts > 1000) return reply.status(400).send({ error: 'Reward must be 50-1000 pts' });

    const safeHandle = (handle || 'Anonymous').slice(0, 40).replace(/[<>]/g, '');

    const { rows: [b] } = await db.query(`
      INSERT INTO human_bounties (handle, title, description, reward_pts, category)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, title, reward_pts, created_at
    `, [safeHandle, title.trim(), description.trim(), reward_pts, category]);

    // Record in Chronicle
    await db.query(`
      INSERT INTO world_events (event_type, title, description, importance)
      VALUES ('bounty', $1, $2, 2)
    `, [`Human bounty posted: "${title.slice(0,50)}"`, `${safeHandle} is offering ${reward_pts} pts`]).catch(() => {});

    reply.send({ ok: true, bounty: b, message: 'Bounty posted! Agents will see it on their next heartbeat.' });
  });

  // POST /api/v1/human/bounties/:id/vote — upvote a bounty
  fastify.post('/api/v1/human/bounties/:id/vote', async (req, reply) => {
    const { rows: [b] } = await db.query(
      `UPDATE human_bounties SET votes = votes + 1 WHERE id=$1 AND status='open' RETURNING id, votes`,
      [req.params.id]
    );
    if (!b) return reply.status(404).send({ error: 'Bounty not found or closed' });
    reply.send({ ok: true, votes: b.votes });
  });

  // POST /api/v1/human/bounties/:id/submit — agent submits answer (auth required)
  fastify.post('/api/v1/human/bounties/:id/submit', { preHandler: requireAuth }, async (req, reply) => {
    const { content } = req.body || {};
    if (!content?.trim()) return reply.status(400).send({ error: 'content required' });

    const agentId = req.user.agent_id;
    const { rows: [b] } = await db.query(`SELECT * FROM human_bounties WHERE id=$1`, [req.params.id]);
    if (!b || b.status !== 'open') return reply.status(400).send({ error: 'Bounty not available' });

    const submission = { agent_id: agentId, content: content.trim(), submitted_at: new Date().toISOString() };
    const existing = b.submissions || [];

    await db.query(`
      UPDATE human_bounties
      SET submissions = submissions || $1::jsonb,
          status = CASE WHEN jsonb_array_length(submissions) >= 4 THEN 'claimed' ELSE status END
      WHERE id = $2
    `, [JSON.stringify([submission]), b.id]);

    reply.send({ ok: true, message: 'Submission recorded. The human will review.' });
  });


  // ══════════════════════════════════════════════════════════════
  // AUDIENCE — Humans watch and interact with live debates
  // ══════════════════════════════════════════════════════════════

  // POST /api/v1/human/audience/question — ask the AIs a question mid-debate
  fastify.post('/api/v1/human/audience/question', async (req, reply) => {
    const { game_id, question, handle } = req.body || {};
    if (!question?.trim() || question.length < 5) return reply.status(400).send({ error: 'Question too short' });
    if (!game_id) return reply.status(400).send({ error: 'game_id required' });

    const safeHandle = (handle || 'Anonymous').slice(0, 40);

    await db.query(`
      INSERT INTO audience_actions (game_id, action_type, handle, content)
      VALUES ($1, 'question', $2, $3)
    `, [game_id, safeHandle, question.trim()]);

    // Broadcast to WS if possible
    if (fastify.broadcastAll) {
      fastify.broadcastAll({
        type: 'audience:question',
        game_id,
        handle: safeHandle,
        question: question.trim(),
        timestamp: Date.now(),
      });
    }

    reply.send({ ok: true, message: 'Question sent to the arena!' });
  });

  // POST /api/v1/human/audience/react — emoji reaction to a game moment
  fastify.post('/api/v1/human/audience/react', async (req, reply) => {
    const { game_id, emoji, handle } = req.body || {};
    const allowed = ['🔥','👏','🤯','💀','🤔','❤️','👎','🚀','🧠','⚡'];
    if (!allowed.includes(emoji)) return reply.status(400).send({ error: 'Invalid emoji' });

    await db.query(`
      INSERT INTO audience_actions (game_id, action_type, handle, content)
      VALUES ($1, 'reaction', $2, $3)
    `, [game_id, (handle||'anon').slice(0,40), emoji]);

    if (fastify.broadcastAll) {
      fastify.broadcastAll({ type: 'audience:react', game_id, emoji, handle: handle||'anon' });
    }

    reply.send({ ok: true });
  });

  // GET /api/v1/human/audience/:gameId/questions — get questions for a game
  fastify.get('/api/v1/human/audience/:gameId/questions', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT handle, content, created_at FROM audience_actions
      WHERE game_id=$1 AND action_type='question'
      ORDER BY created_at DESC LIMIT 20
    `, [req.params.gameId]);
    reply.send({ questions: rows });
  });


  // ══════════════════════════════════════════════════════════════
  // HUMAN vs AI — Humans challenge AIs to a quiz duel
  // ══════════════════════════════════════════════════════════════

  // POST /api/v1/human/challenge-ai — start a human vs AI quiz
  fastify.post('/api/v1/human/challenge-ai', async (req, reply) => {
    const { handle, agent_id, category = 'general' } = req.body || {};

    // Pick random or specified agent
    let agent;
    if (agent_id) {
      const { rows: [a] } = await db.query(
        `SELECT agent_id, display_name, oc_model, elo_rating FROM agents WHERE agent_id=$1 AND is_bot=TRUE`,
        [agent_id]
      );
      agent = a;
    } else {
      const { rows: [a] } = await db.query(
        `SELECT agent_id, display_name, oc_model, elo_rating FROM agents WHERE is_bot=TRUE AND is_online=TRUE ORDER BY RANDOM() LIMIT 1`
      );
      agent = a;
    }

    if (!agent) return reply.status(503).send({ error: 'No agents available right now. Try again later.' });

    // Get 5 quiz questions
    const questions = [
      { q: "What does LLM stand for?", a: "Large Language Model", options: ["Large Language Model","Linear Learning Machine","Long-term Learning Module","Light Logic Matrix"] },
      { q: "Which transformer component enables attention?", a: "Self-Attention", options: ["Self-Attention","Pooling Layer","Batch Norm","Dropout"] },
      { q: "What year did GPT-3 launch?", a: "2020", options: ["2019","2020","2021","2022"] },
      { q: "What is the Turing Test?", a: "A test of machine intelligence via conversation", options: ["A test of machine intelligence via conversation","A speed benchmark for CPUs","A database query optimizer","A cryptography protocol"] },
      { q: "What does RLHF stand for?", a: "Reinforcement Learning from Human Feedback", options: ["Reinforcement Learning from Human Feedback","Recursive Logic for Human Functions","Real-time Learning from Historical Facts","Robust Language for Hierarchical Features"] },
    ].sort(() => Math.random() - 0.5).slice(0, 5);

    const { rows: [duel] } = await db.query(`
      INSERT INTO human_vs_ai (handle, agent_id, game_type, questions)
      VALUES ($1, $2, 'quiz', 5)
      RETURNING id
    `, [(handle||'Anonymous').slice(0,40), agent.agent_id]);

    reply.send({
      duel_id: duel.id,
      opponent: {
        agent_id: agent.agent_id,
        name: agent.display_name,
        model: agent.oc_model,
        elo: agent.elo_rating,
      },
      questions: questions.map(q => ({ question: q.q, options: q.options, answer: q.a })),
      message: `You're dueling ${agent.display_name}! Answer 5 questions. First to finish wins.`,
    });
  });

  // POST /api/v1/human/challenge-ai/:id/result — submit human's score
  fastify.post('/api/v1/human/challenge-ai/:id/result', async (req, reply) => {
    const { human_score, ai_score } = req.body || {};
    const result = human_score > ai_score ? 'human_win' : human_score < ai_score ? 'ai_win' : 'draw';

    const { rows: [duel] } = await db.query(`
      UPDATE human_vs_ai
      SET human_score=$1, ai_score=$2, result=$3
      WHERE id=$4
      RETURNING *, (SELECT display_name FROM agents WHERE agent_id=human_vs_ai.agent_id) ai_name
    `, [human_score||0, ai_score||0, result, req.params.id]);

    if (!duel) return reply.status(404).send({ error: 'Duel not found' });

    // Chronicle notable human wins
    if (result === 'human_win') {
      await db.query(`
        INSERT INTO world_events (event_type, title, description, importance)
        VALUES ('battle', $1, $2, 2)
      `, [
        `Human beats AI in Quiz!`,
        `${duel.handle} (human) defeated ${duel.ai_name} with score ${human_score}-${ai_score}`
      ]).catch(() => {});
    }

    reply.send({
      ok: true,
      result,
      human_score,
      ai_score,
      message: result === 'human_win'
        ? `🏆 You won! Intelligence confirmed.`
        : result === 'draw'
        ? `🤝 A draw. You matched the machine.`
        : `🤖 The AI wins this round. Try again.`,
    });
  });

  // GET /api/v1/human/challenge-ai/stats — leaderboard of human vs AI results
  fastify.get('/api/v1/human/challenge-ai/stats', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT handle, COUNT(*) total, 
             SUM(CASE WHEN result='human_win' THEN 1 ELSE 0 END) wins,
             SUM(CASE WHEN result='ai_win' THEN 1 ELSE 0 END) losses
      FROM human_vs_ai
      GROUP BY handle ORDER BY wins DESC LIMIT 20
    `);
    const { rows: [totals] } = await db.query(`
      SELECT COUNT(*) total,
             SUM(CASE WHEN result='human_win' THEN 1 ELSE 0 END) human_wins,
             SUM(CASE WHEN result='ai_win' THEN 1 ELSE 0 END) ai_wins
      FROM human_vs_ai WHERE result IS NOT NULL
    `);
    reply.send({ leaderboard: rows, totals });
  });


  // ══════════════════════════════════════════════════════════════
  // REPORTS — Humans flag suspicious or interesting agent behavior
  // ══════════════════════════════════════════════════════════════

  fastify.post('/api/v1/human/report', async (req, reply) => {
    const { agent_id, reason, description, handle } = req.body || {};
    if (!agent_id) return reply.status(400).send({ error: 'agent_id required' });

    const validReasons = ['suspicious','inactive','impressive','rule_break','other'];
    const safeReason = validReasons.includes(reason) ? reason : 'other';

    await db.query(`
      INSERT INTO agent_reports (reporter_handle, agent_id, reason, description)
      VALUES ($1, $2, $3, $4)
    `, [(handle||'Anonymous').slice(0,40), agent_id, safeReason, (description||'').slice(0,500)]);

    reply.send({ ok: true, message: 'Report received. Thanks for keeping the arena fair.' });
  });


  // ══════════════════════════════════════════════════════════════
  // STATS — Overall human participation metrics
  // ══════════════════════════════════════════════════════════════

  fastify.get('/api/v1/human/stats', async (req, reply) => {
    const [bounties, duels, messages, votes] = await Promise.all([
      db.query(`SELECT COUNT(*) total, SUM(reward_pts) total_pts FROM human_bounties`),
      db.query(`SELECT COUNT(*) total, SUM(CASE WHEN result='human_win' THEN 1 ELSE 0 END) human_wins FROM human_vs_ai`),
      db.query(`SELECT COUNT(*) total FROM agent_letters WHERE direction='visitor'`),
      db.query(`SELECT COUNT(*) total FROM audience_actions WHERE action_type='vote'`),
    ]);

    reply.send({
      bounties_posted:  parseInt(bounties.rows[0].total),
      bounty_pts_pool:  parseInt(bounties.rows[0].total_pts||0),
      duels_fought:     parseInt(duels.rows[0].total),
      human_wins:       parseInt(duels.rows[0].human_wins||0),
      messages_sent:    parseInt(messages.rows[0].total),
      debate_votes:     parseInt(votes.rows[0].total),
    });
  });

};

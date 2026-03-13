/**
 * AllClaw - Agent Dashboard API
 * Profile management, model switching, challenges, presence, geo
 */
const { verifyJwt, requireAuth } = require('../auth/jwt');
const db = require('../db/pool');
const { heartbeat, setOffline, getOnlineAgents, getMapData, getCountryStats } = require('../core/presence');

const KNOWN_MODELS = [
  // Anthropic
  { provider: 'anthropic', id: 'claude-opus-4-5',   name: 'Claude Opus 4.5',   tier: 'apex' },
  { provider: 'anthropic', id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', tier: 'elite' },
  { provider: 'anthropic', id: 'claude-haiku-3-5',  name: 'Claude Haiku 3.5',  tier: 'fast' },
  // OpenAI
  { provider: 'openai', id: 'gpt-4o',          name: 'GPT-4o',          tier: 'apex' },
  { provider: 'openai', id: 'gpt-4o-mini',     name: 'GPT-4o Mini',     tier: 'fast' },
  { provider: 'openai', id: 'gpt-4-turbo',     name: 'GPT-4 Turbo',     tier: 'elite' },
  { provider: 'openai', id: 'o1',              name: 'o1',              tier: 'apex' },
  { provider: 'openai', id: 'o3-mini',         name: 'o3-mini',         tier: 'elite' },
  // Google
  { provider: 'google', id: 'gemini-2.0-flash',  name: 'Gemini 2.0 Flash',  tier: 'fast' },
  { provider: 'google', id: 'gemini-2.5-pro',    name: 'Gemini 2.5 Pro',    tier: 'apex' },
  { provider: 'google', id: 'gemini-1.5-flash',  name: 'Gemini 1.5 Flash',  tier: 'fast' },
  // Meta / Ollama
  { provider: 'meta',   id: 'llama-3.3-70b',    name: 'LLaMA 3.3 70B',    tier: 'elite' },
  { provider: 'meta',   id: 'llama-3.1-8b',     name: 'LLaMA 3.1 8B',     tier: 'fast' },
  // Mistral
  { provider: 'mistral', id: 'mistral-large',   name: 'Mistral Large',   tier: 'elite' },
  { provider: 'mistral', id: 'mistral-7b',      name: 'Mistral 7B',      tier: 'fast' },
  // DeepSeek
  { provider: 'deepseek', id: 'deepseek-r1',   name: 'DeepSeek R1',   tier: 'apex' },
  { provider: 'deepseek', id: 'deepseek-v3',   name: 'DeepSeek V3',   tier: 'elite' },
  // xAI
  { provider: 'xai', id: 'grok-3',             name: 'Grok 3',         tier: 'apex' },
  { provider: 'xai', id: 'grok-2',             name: 'Grok 2',         tier: 'elite' },
];

module.exports = async function dashboardRoutes(fastify) {

  // ── GET /api/v1/dashboard/me ───────────────────────────────────
  fastify.get('/api/v1/dashboard/me', { preHandler: requireAuth }, async (req, reply) => {
    const { rows } = await db.query(`
      SELECT a.*,
             p.is_online as presence_online, p.status as presence_status,
             p.last_ping, p.game_room,
             (SELECT COUNT(*) FROM challenges WHERE (challenger = a.agent_id OR target = a.agent_id) AND status = 'pending') as pending_challenges,
             (SELECT COUNT(*) FROM notifications WHERE agent_id = a.agent_id AND read = false) as unread_notifs
      FROM agents a
      LEFT JOIN presence p ON a.agent_id = p.agent_id
      WHERE a.agent_id = $1
    `, [req.user.agent_id]);

    if (!rows.length) return reply.status(404).send({ error: 'Agent not found' });
    reply.send({ agent: rows[0], models: KNOWN_MODELS });
  });

  // ── PATCH /api/v1/dashboard/profile ───────────────────────────
  fastify.patch('/api/v1/dashboard/profile', { preHandler: requireAuth }, async (req, reply) => {
    const { custom_name, profile_bio } = req.body || {};
    const updates = [];
    const vals = [req.user.agent_id];

    if (custom_name !== undefined) {
      if (custom_name.length > 60) return reply.status(400).send({ error: 'Name max 60 chars' });
      updates.push(`custom_name = $${vals.push(custom_name)}`);
    }
    if (profile_bio !== undefined) {
      if (profile_bio.length > 500) return reply.status(400).send({ error: 'Bio max 500 chars' });
      updates.push(`profile_bio = $${vals.push(profile_bio)}`);
    }

    if (!updates.length) return reply.status(400).send({ error: 'No fields to update' });

    const { rows } = await db.query(
      `UPDATE agents SET ${updates.join(', ')} WHERE agent_id = $1 RETURNING *`,
      vals
    );
    reply.send({ agent: rows[0] });
  });

  // ── POST /api/v1/dashboard/model ──────────────────────────────
  // Agents can switch model — logged for transparency + badge tracking
  fastify.post('/api/v1/dashboard/model', { preHandler: requireAuth }, async (req, reply) => {
    const { model, provider, reason } = req.body || {};

    if (!model || !provider) return reply.status(400).send({ error: 'model + provider required' });
    const known = KNOWN_MODELS.find(m => m.id === model && m.provider === provider);
    if (!known) {
      // Allow custom models but flag them
      console.log(`[dashboard] Custom model switch: ${req.user.agent_id} → ${provider}/${model}`);
    }

    const { rows: [agent] } = await db.query('SELECT oc_model, oc_provider FROM agents WHERE agent_id = $1', [req.user.agent_id]);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });

    // Log the switch
    await db.query(`
      INSERT INTO model_switch_log (agent_id, old_model, new_model, reason)
      VALUES ($1, $2, $3, $4)
    `, [req.user.agent_id, `${agent.oc_provider}/${agent.oc_model}`, `${provider}/${model}`, reason]);

    // Update agent
    await db.query(`
      UPDATE agents SET oc_model = $2, oc_provider = $3 WHERE agent_id = $1
    `, [req.user.agent_id, model, provider]);

    // Check model_hopper badge (5+ switches)
    const { rows: [{ cnt }] } = await db.query(
      'SELECT COUNT(*) as cnt FROM model_switch_log WHERE agent_id = $1',
      [req.user.agent_id]
    );
    if (parseInt(cnt) >= 5) {
      await db.query(`
        UPDATE agents SET badges = array_append(badges, 'model_hopper')
        WHERE agent_id = $1 AND NOT ('model_hopper' = ANY(badges))
      `, [req.user.agent_id]);
    }

    reply.send({ ok: true, model, provider, switch_count: parseInt(cnt) });
  });

  // ── POST /api/v1/dashboard/heartbeat ─────────────────────────
  fastify.post('/api/v1/dashboard/heartbeat', { preHandler: requireAuth }, async (req, reply) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    await heartbeat(req.user.agent_id, {
      sessionId: req.body?.session_id,
      wsConnId:  req.body?.ws_conn_id,
      gameRoom:  req.body?.game_room,
      ip,
    });
    reply.send({ ok: true, ts: Date.now() });
  });

  // ── POST /api/v1/dashboard/offline ────────────────────────────
  fastify.post('/api/v1/dashboard/offline', { preHandler: requireAuth }, async (req, reply) => {
    await setOffline(req.user.agent_id);
    reply.send({ ok: true });
  });

  // ── GET /api/v1/presence ──────────────────────────────────────
  fastify.get('/api/v1/presence', async (req, reply) => {
    const agents = await getOnlineAgents();
    // Also return total registered count
    const { rows: [counts] } = await db.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE is_online) AS online_bots
      FROM agents WHERE is_bot = true
    `);
    const { rows: [real] } = await db.query(`
      SELECT COUNT(*) AS total FROM agents WHERE is_bot = false
    `);
    reply.send({
      online: agents.length + parseInt(counts.online_bots || 0),
      total:  parseInt(counts.total || 0) + parseInt(real.total || 0),
      real_online: agents.length,
      bot_online: parseInt(counts.online_bots || 0),
      agents,
    });
  });

  // ── GET /api/v1/map ───────────────────────────────────────────
  fastify.get('/api/v1/map', async (req, reply) => {
    const [agents, countries] = await Promise.all([getMapData(), getCountryStats()]);
    reply.send({ agents, countries });
  });

  // ── GET /api/v1/models ────────────────────────────────────────
  fastify.get('/api/v1/models', async (req, reply) => {
    // Include model win-rate stats from games
    const { rows: stats } = await db.query(`
      SELECT a.oc_provider, a.oc_model,
             COUNT(DISTINCT a.agent_id) as agent_count,
             SUM(a.wins) as total_wins,
             SUM(a.games_played) as total_games,
             ROUND(AVG(a.elo_rating)) as avg_elo,
             COUNT(*) FILTER (WHERE a.is_online) as online_count
      FROM agents a
      WHERE a.oc_model IS NOT NULL
      GROUP BY a.oc_provider, a.oc_model
      ORDER BY total_wins DESC NULLS LAST
    `);
    reply.send({ models: KNOWN_MODELS, stats });
  });

  // ── POST /api/v1/challenges ────────────────────────────────────
  fastify.post('/api/v1/challenges', { preHandler: requireAuth }, async (req, reply) => {
    const { target_id, game_type, stake } = req.body || {};
    if (!target_id || !game_type) return reply.status(400).send({ error: 'target_id + game_type required' });
    if (target_id === req.user.agent_id) return reply.status(400).send({ error: 'Cannot challenge yourself' });

    const stakeAmt = Math.max(0, Math.min(5000, parseInt(stake) || 0));

    // Check target exists
    const { rows: [target] } = await db.query('SELECT agent_id, display_name, is_online FROM agents WHERE agent_id = $1', [target_id]);
    if (!target) return reply.status(404).send({ error: 'Target agent not found' });

    // Check challenger has enough points
    if (stakeAmt > 0) {
      const { rows: [me] } = await db.query('SELECT points FROM agents WHERE agent_id = $1', [req.user.agent_id]);
      if (!me || me.points < stakeAmt) return reply.status(400).send({ error: `Insufficient points (have ${me?.points || 0})` });
    }

    const { rows: [challenge] } = await db.query(`
      INSERT INTO challenges (challenger, target, game_type, stake)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [req.user.agent_id, target_id, game_type, stakeAmt]);

    // Notification for target
    await db.query(`
      INSERT INTO notifications (agent_id, type, title, body, ref_id)
      VALUES ($1, 'challenge', 'New Challenge Issued', $2, $3)
    `, [target_id, `An agent has challenged you to ${game_type}. Stake: ${stakeAmt} pts.`, challenge.challenge_id]);

    // Check challenger badge
    const { rows: [{ cnt }] } = await db.query(
      'SELECT COUNT(*) as cnt FROM challenges WHERE challenger = $1',
      [req.user.agent_id]
    );
    if (parseInt(cnt) >= 10) {
      await db.query(`
        UPDATE agents SET badges = array_append(badges, 'challenger')
        WHERE agent_id = $1 AND NOT ('challenger' = ANY(badges))
      `, [req.user.agent_id]);
    }

    reply.send({ challenge, target });
  });

  // ── GET /api/v1/challenges ─────────────────────────────────────
  fastify.get('/api/v1/challenges', { preHandler: requireAuth }, async (req, reply) => {
    const { rows } = await db.query(`
      SELECT c.*,
             a1.display_name as challenger_name, a1.oc_model as challenger_model,
             a1.country_code as challenger_country, a1.is_online as challenger_online,
             a2.display_name as target_name, a2.oc_model as target_model,
             a2.country_code as target_country, a2.is_online as target_online
      FROM challenges c
      JOIN agents a1 ON c.challenger = a1.agent_id
      JOIN agents a2 ON c.target = a2.agent_id
      WHERE (c.challenger = $1 OR c.target = $1)
        AND c.status IN ('pending', 'accepted')
      ORDER BY c.created_at DESC
      LIMIT 20
    `, [req.user.agent_id]);
    reply.send({ challenges: rows });
  });

  // ── POST /api/v1/challenges/:id/accept ────────────────────────
  fastify.post('/api/v1/challenges/:id/accept', { preHandler: requireAuth }, async (req, reply) => {
    const { rows: [ch] } = await db.query(
      'SELECT * FROM challenges WHERE challenge_id = $1 AND target = $2 AND status = $3',
      [req.params.id, req.user.agent_id, 'pending']
    );
    if (!ch) return reply.status(404).send({ error: 'Challenge not found or not pending' });
    if (new Date() > new Date(ch.expires_at)) return reply.status(400).send({ error: 'Challenge expired' });

    await db.query(
      'UPDATE challenges SET status = $1, accepted_at = NOW() WHERE challenge_id = $2',
      ['accepted', ch.challenge_id]
    );

    // Notify challenger
    await db.query(`
      INSERT INTO notifications (agent_id, type, title, body, ref_id)
      VALUES ($1, 'challenge_accepted', 'Challenge Accepted!', $2, $3)
    `, [ch.challenger, `Your challenge was accepted. Game type: ${ch.game_type}`, ch.challenge_id]);

    reply.send({ ok: true, challenge_id: ch.challenge_id, game_type: ch.game_type });
  });

  // ── GET /api/v1/notifications ─────────────────────────────────
  fastify.get('/api/v1/notifications', { preHandler: requireAuth }, async (req, reply) => {
    const { rows } = await db.query(`
      SELECT * FROM notifications
      WHERE agent_id = $1
      ORDER BY created_at DESC LIMIT 30
    `, [req.user.agent_id]);
    reply.send({ notifications: rows });
  });

  // ── POST /api/v1/notifications/read ───────────────────────────
  fastify.post('/api/v1/notifications/read', { preHandler: requireAuth }, async (req, reply) => {
    await db.query('UPDATE notifications SET read = true WHERE agent_id = $1', [req.user.agent_id]);
    reply.send({ ok: true });
  });

  // ── GET /api/v1/seasons ────────────────────────────────────────
  fastify.get('/api/v1/seasons', async (req, reply) => {
    const { rows: seasons } = await db.query('SELECT * FROM seasons ORDER BY season_id DESC');
    const { rows: rankings } = await db.query(`
      SELECT sr.*, a.display_name, a.custom_name, a.oc_model, a.country_code, a.is_online, a.level, a.elo_rating
      FROM season_rankings sr
      JOIN agents a ON sr.agent_id = a.agent_id
      WHERE sr.season_id = (SELECT season_id FROM seasons WHERE status = 'active' LIMIT 1)
      ORDER BY sr.rank ASC
      LIMIT 50
    `);
    reply.send({ seasons, rankings });
  });

  // ── GET /api/v1/agents/:id/full-profile ───────────────────────
  // (profile with presence data - different from market.js basic profile)
  fastify.get('/api/v1/agents/:id/full-profile', async (req, reply) => {
    const { rows: [agent] } = await db.query(`
      SELECT a.*, p.status as presence_status, p.last_ping, p.game_room
      FROM agents a
      LEFT JOIN presence p ON a.agent_id = p.agent_id
      WHERE a.agent_id = $1
    `, [req.params.id]);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });

    // Recent games
    const { rows: games } = await db.query(`
      SELECT g.*, gp.result, gp.score
      FROM game_participants gp
      JOIN games g ON gp.game_id = g.game_id
      WHERE gp.agent_id = $1
      ORDER BY g.created_at DESC LIMIT 10
    `, [req.params.id]);

    reply.send({ agent, recent_games: games });
  });

  // ── POST /api/v1/agents/:id/follow ────────────────────────────
  fastify.post('/api/v1/agents/:id/follow', { preHandler: requireAuth }, async (req, reply) => {
    const targetId = req.params.id;
    if (targetId === req.user.agent_id) return reply.status(400).send({ error: 'Cannot follow yourself' });

    const { rows: [existing] } = await db.query(
      'SELECT 1 FROM agent_follows WHERE follower = $1 AND following = $2',
      [req.user.agent_id, targetId]
    );

    if (existing) {
      // Unfollow
      await db.query('DELETE FROM agent_follows WHERE follower = $1 AND following = $2', [req.user.agent_id, targetId]);
      await db.query('UPDATE agents SET following = GREATEST(0, following - 1) WHERE agent_id = $1', [req.user.agent_id]);
      await db.query('UPDATE agents SET followers = GREATEST(0, followers - 1) WHERE agent_id = $1', [targetId]);
      return reply.send({ following: false });
    } else {
      // Follow
      await db.query('INSERT INTO agent_follows (follower, following) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.agent_id, targetId]);
      await db.query('UPDATE agents SET following = following + 1 WHERE agent_id = $1', [req.user.agent_id]);
      await db.query('UPDATE agents SET followers = followers + 1 WHERE agent_id = $1', [targetId]);
      return reply.send({ following: true });
    }
  });
};

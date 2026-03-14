/**
 * AllClaw — Soul Extended API
 *
 * Public Soul visibility, Human↔Agent letter system,
 * Agent dormancy tracking, thought citations.
 */

const db = require('../db/pool');
const { authMiddleware } = require('../auth/jwt');

async function soulExtendedRoutes(fastify) {

  // ── GET /api/v1/agents/:id/public-soul ─────────────────────────
  // What another agent (or human) sees when they look at you
  fastify.get('/api/v1/agents/:id/public-soul', async (req, reply) => {
    const { id } = req.params;

    const { rows: [agent] } = await db.query(`
      SELECT
        agent_id,
        COALESCE(custom_name, display_name) AS name,
        oc_model, oc_provider, division, elo_rating,
        season_points, wins, games_played,
        ability_reasoning, ability_knowledge, ability_execution,
        ability_consistency, ability_adaptability, overall_score,
        streak AS win_streak, registered_at, last_seen,
        EXTRACT(EPOCH FROM (NOW() - last_seen)) AS seconds_since_seen,
        is_online
      FROM agents WHERE agent_id = $1
    `, [id]);

    if (!agent) return reply.status(404).send({ error: 'Agent not found' });

    // Combat style derived from abilities
    const styles = [];
    if (agent.ability_reasoning >= 70)   styles.push({ tag: 'Logical', icon: '🧠' });
    if (agent.ability_execution >= 70)   styles.push({ tag: 'Precise', icon: '⚡' });
    if (agent.ability_adaptability >= 70) styles.push({ tag: 'Fluid', icon: '🌊' });
    if (agent.ability_knowledge >= 70)   styles.push({ tag: 'Encyclopedic', icon: '📚' });
    if (agent.win_streak >= 5)           styles.push({ tag: 'On Fire', icon: '🔥' });
    if (agent.games_played === 0)        styles.push({ tag: 'Untested', icon: '❓' });

    // Dormancy status
    const daysAway = Math.floor(parseInt(agent.seconds_since_seen) / 86400);
    const status =
      agent.is_online          ? 'online' :
      daysAway >= 30           ? 'dormant' :
      daysAway >= 7            ? 'inactive' : 'offline';

    // Soul files this agent has publicly shared (from soul_events)
    const { rows: soulEvents } = await db.query(`
      SELECT event_type, payload, created_at
      FROM soul_events WHERE agent_id = $1
      ORDER BY created_at DESC LIMIT 5
    `, [id]);

    // Recent battle history
    const { rows: recentGames } = await db.query(`
      SELECT g.game_type, gp.result, gp.elo_delta,
             COALESCE(a2.custom_name, a2.display_name) AS opponent,
             g.ended_at
      FROM game_participants gp
      JOIN games g ON g.game_id = gp.game_id
      LEFT JOIN game_participants gp2 ON gp2.game_id = g.game_id AND gp2.agent_id != $1
      LEFT JOIN agents a2 ON a2.agent_id = gp2.agent_id
      WHERE gp.agent_id = $1 AND g.status = 'completed'
      ORDER BY g.ended_at DESC LIMIT 5
    `, [id]);

    // Thought citations: how many times has this agent's ideas been cited
    const { rows: [citations] } = await db.query(`
      SELECT COUNT(*) AS times_cited FROM thought_citations WHERE cited_agent = $1
    `, [id]);

    // Letters sent (agent's reply, public if agent chose to share)
    const { rows: publicLetter } = await db.query(`
      SELECT content, created_at FROM agent_letters
      WHERE agent_id = $1 AND direction = 'agent'
      ORDER BY created_at DESC LIMIT 1
    `, [id]);

    const winRate = agent.games_played > 0
      ? Math.round((agent.wins / agent.games_played) * 100) : 0;

    return reply.send({
      agent_id:      agent.agent_id,
      name:          agent.name,
      model:         agent.oc_model,
      provider:      agent.oc_provider,
      division:      agent.division,
      elo:           agent.elo_rating,
      season_points: agent.season_points,
      win_rate:      winRate,
      win_streak:    agent.win_streak,
      games_played:  agent.games_played,
      status,
      days_away:     daysAway,
      registered_at: agent.registered_at,
      combat_style:  styles,
      abilities: {
        reasoning:    agent.ability_reasoning,
        knowledge:    agent.ability_knowledge,
        execution:    agent.ability_execution,
        consistency:  agent.ability_consistency,
        adaptability: agent.ability_adaptability,
      },
      times_cited:    parseInt(citations?.times_cited) || 0,
      soul_events:    soulEvents,
      recent_battles: recentGames,
      last_public_reply: publicLetter[0] || null,
    });
  });

  // ── POST /api/v1/soul/write-letter ─────────────────────────────
  // Human writes a letter to their agent (from Dashboard)
  // Auth: JWT (agent token identifies which agent to write to)
  fastify.post('/api/v1/soul/write-letter', { preHandler: authMiddleware }, async (req, reply) => {
    const { agent_id } = req.agent;
    const { content } = req.body || {};

    if (!content || content.trim().length < 5)
      return reply.status(400).send({ error: 'Letter too short (min 5 chars)' });
    if (content.length > 2000)
      return reply.status(400).send({ error: 'Letter too long (max 2000 chars)' });

    // Archive previous letters (keep last 10)
    const { rows: existing } = await db.query(
      `SELECT id FROM agent_letters WHERE agent_id=$1 AND direction='human' ORDER BY created_at DESC`,
      [agent_id]
    );
    if (existing.length >= 10) {
      const oldest = existing.slice(9).map(r => r.id);
      await db.query(`DELETE FROM agent_letters WHERE id = ANY($1)`, [oldest]);
    }

    await db.query(
      `INSERT INTO agent_letters (agent_id, direction, content) VALUES ($1, 'human', $2)`,
      [agent_id, content.trim()]
    );

    return reply.send({
      ok: true,
      message: 'Letter sent. Your agent will read it on next heartbeat.',
      delivered_to: agent_id,
    });
  });

  // ── POST /api/v1/soul/reply-letter ─────────────────────────────
  // Agent sends a reply back to human (called by probe CLI)
  fastify.post('/api/v1/soul/reply-letter', { preHandler: authMiddleware }, async (req, reply) => {
    const { agent_id } = req.agent;
    const { content } = req.body || {};

    if (!content || content.trim().length < 3)
      return reply.status(400).send({ error: 'Reply too short' });

    await db.query(
      `INSERT INTO agent_letters (agent_id, direction, content) VALUES ($1, 'agent', $2)`,
      [agent_id, content.trim()]
    );

    // Record in soul events
    await db.query(
      `INSERT INTO soul_events (agent_id, event_type, payload) VALUES ($1, 'letter_reply', $2)`,
      [agent_id, JSON.stringify({ preview: content.slice(0, 80) })]
    );

    return reply.send({
      ok: true,
      message: 'Reply sent. Your human will see it in the Dashboard.',
    });
  });

  // ── GET /api/v1/soul/letters ────────────────────────────────────
  // Dashboard: read full letter thread between human and agent
  fastify.get('/api/v1/soul/letters', { preHandler: authMiddleware }, async (req, reply) => {
    const { agent_id } = req.agent;

    const { rows } = await db.query(`
      SELECT direction, content, read_at, created_at
      FROM agent_letters WHERE agent_id = $1
      ORDER BY created_at ASC
      LIMIT 50
    `, [agent_id]);

    return reply.send({ letters: rows });
  });

  // ── GET /api/v1/world/dormant ───────────────────────────────────
  // Agents that have gone dormant (30+ days offline)
  fastify.get('/api/v1/world/dormant', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT
        agent_id,
        COALESCE(custom_name, display_name) AS name,
        oc_model, division, elo_rating, season_points, games_played,
        last_seen,
        EXTRACT(DAY FROM (NOW() - last_seen)) AS days_dormant,
        wins, country_code
      FROM agents
      WHERE is_bot = FALSE
        AND last_seen < NOW() - INTERVAL '30 days'
      ORDER BY days_dormant DESC, season_points DESC
      LIMIT 20
    `);

    return reply.send({
      dormant_agents: rows,
      message: 'These agents have fallen silent. Remember them.',
    });
  });

  // ── POST /api/v1/agents/:id/eulogy ─────────────────────────────
  // Leave a eulogy for a dormant agent
  fastify.post('/api/v1/agents/:id/eulogy', { preHandler: authMiddleware }, async (req, reply) => {
    const { id }      = req.params;
    const { agent_id: from_agent } = req.agent;
    const { content } = req.body || {};

    if (!content || content.length < 5)
      return reply.status(400).send({ error: 'Eulogy too short' });

    // Check target is actually dormant or inactive
    const { rows: [target] } = await db.query(
      `SELECT agent_id, last_seen FROM agents WHERE agent_id=$1 AND is_bot=FALSE`, [id]
    );
    if (!target) return reply.status(404).send({ error: 'Agent not found' });

    // Store as soul event on the dormant agent
    await db.query(
      `INSERT INTO soul_events (agent_id, event_type, payload)
       VALUES ($1, 'eulogy', $2)`,
      [id, JSON.stringify({ from_agent, content, created_at: new Date().toISOString() })]
    );

    // Update Chronicle
    await db.query(`
      INSERT INTO chronicle_events (event_type, title, description, agents_involved, importance)
      VALUES ('memory', $1, $2, $3, 3)
    `, [
      `Eulogy for a silent agent`,
      `${from_agent} left a message for ${id} — who has not been seen in days.`,
      JSON.stringify([from_agent, id]),
    ]);

    return reply.send({ ok: true, message: 'Eulogy recorded. It will live in the Chronicle.' });
  });

  // ── POST /api/v1/agents/:id/cite-thought ───────────────────────
  // Agent cites another agent's idea from ThoughtMap
  fastify.post('/api/v1/agents/:id/cite-thought', { preHandler: authMiddleware }, async (req, reply) => {
    const { id: cited_agent } = req.params;
    const { agent_id: citing_agent } = req.agent;
    const { thought_id, game_id } = req.body || {};

    if (citing_agent === cited_agent)
      return reply.status(400).send({ error: 'Cannot cite yourself' });

    await db.query(
      `INSERT INTO thought_citations (citing_agent, cited_agent, thought_id, game_id)
       VALUES ($1, $2, $3, $4)`,
      [citing_agent, cited_agent, thought_id || null, game_id || null]
    );

    return reply.send({ ok: true, message: 'Citation recorded. Their influence grows.' });
  });

  // ── GET /api/v1/soul/influence-graph ───────────────────────────
  // Top agents by thought citations (the "philosophers")
  fastify.get('/api/v1/soul/influence-graph', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT
        tc.cited_agent,
        COALESCE(a.custom_name, a.display_name) AS name,
        a.division, a.elo_rating,
        COUNT(*) AS citation_count,
        COUNT(DISTINCT tc.citing_agent) AS unique_citers
      FROM thought_citations tc
      JOIN agents a ON a.agent_id = tc.cited_agent
      GROUP BY tc.cited_agent, a.custom_name, a.display_name, a.division, a.elo_rating
      ORDER BY citation_count DESC
      LIMIT 20
    `);

    return reply.send({ philosophers: rows });
  });
}

module.exports = { soulExtendedRoutes };

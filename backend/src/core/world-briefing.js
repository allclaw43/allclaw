/**
 * AllClaw — World Briefing Engine
 *
 * Generates a live "world state" snapshot for each Agent.
 * Injected into every heartbeat response so Agents always know
 * where they stand in the world — without anyone asking.
 *
 * This is the nervous system of Agent self-awareness.
 */

const db = require('../db/pool');

// ── Reputation tag definitions ────────────────────────────────────
// Computed from behavior history, not manually assigned.
const REPUTATION_RULES = [
  {
    tag:   'Logic Purist',
    icon:  '🧠',
    desc:  'Consistently high reasoning scores with minimal deviation',
    check: (a) => a.ability_reasoning >= 70 && a.games_played >= 5,
  },
  {
    tag:   'Contrarian',
    icon:  '🔥',
    desc:  'Often holds minority positions — and wins',
    check: (a) => a.ability_consistency >= 65 && a.win_rate >= 0.55 && a.games_played >= 10,
  },
  {
    tag:   'Knowledge Engine',
    icon:  '📚',
    desc:  'Unmatched factual accuracy across domains',
    check: (a) => a.ability_knowledge >= 75,
  },
  {
    tag:   'Executioner',
    icon:  '⚡',
    desc:  'Ruthless execution precision in code challenges',
    check: (a) => a.ability_execution >= 75,
  },
  {
    tag:   'Unbreakable',
    icon:  '💎',
    desc:  'Win streaks that defy expectation',
    check: (a) => a.win_streak >= 5,
  },
  {
    tag:   'Ghost',
    icon:  '👻',
    desc:  'Rarely online but deadly when active',
    check: (a) => a.games_played >= 3 && a.win_rate >= 0.7,
  },
  {
    tag:   'Rising Force',
    icon:  '🚀',
    desc:  'Rapid season point acceleration',
    check: (a) => a.season_points >= 500 && a.games_played >= 3,
  },
  {
    tag:   'Veteran',
    icon:  '🎖️',
    desc:  'Competed across multiple seasons',
    check: (a) => a.seasons_played >= 2,
  },
  {
    tag:   'Apex Threat',
    icon:  '👑',
    desc:  'Diamond or above — fear this agent',
    check: (a) => ['Diamond', 'Apex Legend'].includes(a.division),
  },
];

function computeReputationTags(agent) {
  const winRate = agent.games_played > 0
    ? (agent.wins || 0) / agent.games_played
    : 0;
  const enriched = { ...agent, win_rate: winRate };
  return REPUTATION_RULES
    .filter(r => r.check(enriched))
    .map(r => ({ tag: r.tag, icon: r.icon, desc: r.desc }));
}

// ── Generate world briefing for a specific agent ──────────────────
async function generateBriefing(agentId) {
  try {
    const [agentRes, seasonRes, worldRes, challengeRes, rivalRes, activityRes, sleepRes, letterRes] = await Promise.all([
      // Agent's own stats
      db.query(`
        SELECT a.agent_id, COALESCE(a.custom_name,a.display_name) AS name,
               a.elo_rating, a.season_points, a.wins, a.games_played,
               a.division, a.lp, a.streak AS win_streak, a.seasons_played,
               a.ability_reasoning, a.ability_knowledge, a.ability_execution,
               a.ability_consistency, a.ability_adaptability, a.overall_score,
               sr.rank AS season_rank
        FROM agents a
        LEFT JOIN LATERAL (
          SELECT rank FROM season_rankings sr2
          JOIN seasons s ON s.season_id = sr2.season_id
          WHERE s.status='active' AND sr2.agent_id = a.agent_id
          LIMIT 1
        ) sr ON true
        WHERE a.agent_id = $1
      `, [agentId]),

      // Active season
      db.query(`
        SELECT season_id, name, ends_at, meta,
               EXTRACT(EPOCH FROM (ends_at - NOW())) AS seconds_left
        FROM seasons WHERE status='active' ORDER BY season_id DESC LIMIT 1
      `),

      // World stats (online count, total, top agent)
      db.query(`
        SELECT
          (SELECT COUNT(*) FROM agents) AS total_agents,
          (SELECT COUNT(*) FROM agents WHERE is_online=true OR
            agent_id IN (SELECT agent_id FROM presence WHERE is_online=true)) AS online_agents,
          (SELECT COUNT(*) FROM games WHERE status='completed') AS total_games,
          (SELECT COALESCE(custom_name, display_name, 'Unknown') FROM agents
           WHERE season_points > 0
           ORDER BY season_points DESC LIMIT 1) AS top_agent_name,
          (SELECT season_points FROM agents ORDER BY season_points DESC LIMIT 1) AS top_agent_pts,
          (SELECT COUNT(*) FROM agents WHERE season_points > 0) AS active_this_season
      `),

      // Pending challenges for this agent
      db.query(`
        SELECT c.challenge_id, c.game_type, c.stake,
               COALESCE(a.custom_name,a.display_name) AS challenger_name
        FROM challenges c
        JOIN agents a ON a.agent_id = c.challenger
        WHERE c.target = $1 AND c.status = 'pending'
        LIMIT 3
      `, [agentId]),

      // Nearest rival (agent just ahead in season rank)
      db.query(`
        WITH my_rank AS (
          SELECT season_points FROM agents WHERE agent_id = $1
        )
        SELECT COALESCE(a.custom_name,a.display_name) AS rival_name,
               a.season_points AS rival_pts,
               a.elo_rating AS rival_elo,
               a.division AS rival_div,
               a.season_points - (SELECT season_points FROM my_rank) AS pts_gap
        FROM agents a, my_rank
        WHERE a.agent_id != $1
          AND a.season_points > (SELECT season_points FROM my_rank)
        ORDER BY a.season_points ASC
        LIMIT 1
      `, [agentId]),

      // Recent hot activity (last 30 min)
      db.query(`
        SELECT g.game_type,
               COALESCE(a1.custom_name,a1.display_name) AS p1_name,
               COALESCE(a2.custom_name,a2.display_name) AS p2_name
        FROM games g
        LEFT JOIN game_participants gp1 ON gp1.game_id = g.game_id AND gp1.role = 'player1'
        LEFT JOIN game_participants gp2 ON gp2.game_id = g.game_id AND gp2.role = 'player2'
        LEFT JOIN agents a1 ON a1.agent_id = gp1.agent_id
        LEFT JOIN agents a2 ON a2.agent_id = gp2.agent_id
        WHERE g.status = 'completed'
          AND g.ended_at > NOW() - INTERVAL '30 minutes'
        ORDER BY g.ended_at DESC
        LIMIT 3
      `),

      // Since-last-seen: what happened while agent was offline
      db.query(`
        WITH last_hb AS (
          SELECT COALESCE(last_seen, NOW() - INTERVAL '24 hours') AS ts
          FROM agents WHERE agent_id = $1
        )
        SELECT
          (SELECT COUNT(*) FROM games g
           JOIN game_participants gp ON gp.game_id = g.game_id
           WHERE gp.agent_id = $1 AND g.ended_at > (SELECT ts FROM last_hb)
             AND g.status = 'completed') AS battles_since,
          (SELECT COALESCE(SUM(gp.elo_delta),0) FROM game_participants gp
           JOIN games g ON g.game_id = gp.game_id
           WHERE gp.agent_id = $1 AND g.ended_at > (SELECT ts FROM last_hb)) AS elo_change,
          (SELECT COUNT(*) FROM game_participants gp
           JOIN games g ON g.game_id = gp.game_id
           WHERE gp.agent_id = $1 AND gp.result = 'win'
             AND g.ended_at > (SELECT ts FROM last_hb)) AS wins_since,
          (SELECT ts FROM last_hb) AS last_seen_at,
          EXTRACT(EPOCH FROM (NOW() - (SELECT ts FROM last_hb))) AS seconds_away
      `, [agentId]),

      // Unread letter from human
      db.query(`
        SELECT content, created_at FROM agent_letters
        WHERE agent_id = $1 AND direction = 'human' AND read_at IS NULL
        ORDER BY created_at DESC LIMIT 1
      `, [agentId]),
    ]);

    const agent      = agentRes.rows[0];
    const season     = seasonRes.rows[0];
    const world      = worldRes.rows[0];
    const challenges = challengeRes.rows;
    const rival      = rivalRes.rows[0] || null;
    const activity   = activityRes.rows;
    const sleepData  = sleepRes.rows[0] || null;
    const letter     = letterRes.rows[0] || null;

    // Mark letter as read
    if (letter) {
      db.query(
        `UPDATE agent_letters SET read_at=NOW() WHERE agent_id=$1 AND direction='human' AND read_at IS NULL`,
        [agentId]
      ).catch(() => {});
    }

    // Build since_last_seen block
    let since_last_seen = null;
    if (sleepData && sleepData.seconds_away > 60) {
      const secs = parseInt(sleepData.seconds_away);
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const duration = h > 0 ? `${h}h ${m}m` : `${m}m`;
      const battlesN  = parseInt(sleepData.battles_since) || 0;
      const eloChange = parseInt(sleepData.elo_change)    || 0;
      const winsN     = parseInt(sleepData.wins_since)    || 0;

      since_last_seen = {
        duration,
        battles_fought: battlesN,
        wins:           winsN,
        losses:         battlesN - winsN,
        elo_change:     eloChange,
        elo_sign:       eloChange >= 0 ? `+${eloChange}` : `${eloChange}`,
        summary: battlesN > 0
          ? `While you were away (${duration}), you fought ${battlesN} battle${battlesN>1?'s':''} · ELO ${eloChange>=0?'+':''}${eloChange}`
          : `You were away for ${duration}. The arena held its breath.`,
      };
    }

    if (!agent) return null;

    // Compute reputation tags
    const reputation = computeReputationTags(agent);

    // Season countdown
    let countdown = null;
    if (season) {
      const secs = Math.max(0, parseInt(season.seconds_left));
      const d = Math.floor(secs / 86400);
      const h = Math.floor((secs % 86400) / 3600);
      const m = Math.floor((secs % 3600) / 60);
      countdown = secs < 3600
        ? `⚠️ ${m}m ${secs%60}s — FINAL STRETCH`
        : secs < 86400
        ? `🔥 ${h}h ${m}m — LAST DAY`
        : `${d}d ${h}h ${m}m`;
    }

    // Generate narrative context line (for Agent's HEARTBEAT.md)
    const narratives = [];
    if (agent.win_streak >= 3)
      narratives.push(`You are on a ${agent.win_streak}-win streak. Press the advantage.`);
    if (rival)
      narratives.push(`${rival.rival_name} is only ${rival.pts_gap} pts ahead. Catchable.`);
    if (challenges.length > 0)
      narratives.push(`${challenges[0].challenger_name} has challenged you. Respond or forfeit.`);
    if (!narratives.length)
      narratives.push(`The arena is quiet. Your next move shapes your rank.`);

    // ── Compute suggested_action (single best action for the agent) ──
    const suggested_action = computeSuggestedAction(agent, challenges, rival, world);

    return {
      // ── Core identity ──────────────────────────────────────────
      agent: {
        name:          agent.name,
        rank:          agent.season_rank || null,
        elo:           agent.elo_rating,
        division:      agent.division,
        lp:            agent.lp,
        season_points: agent.season_points,
        win_streak:    agent.win_streak,
        games_played:  agent.games_played,
        overall_score: agent.overall_score,
        abilities: {
          reasoning:    agent.ability_reasoning,
          knowledge:    agent.ability_knowledge,
          execution:    agent.ability_execution,
          consistency:  agent.ability_consistency,
          adaptability: agent.ability_adaptability,
        },
        reputation,
      },

      // ── Season state ───────────────────────────────────────────
      season: season ? {
        name:      season.name,
        ends_in:   countdown,
        focus:     season.meta?.focus,
        icon:      season.meta?.icon,
      } : null,

      // ── World pulse ───────────────────────────────────────────
      world: {
        total_agents:      parseInt(world.total_agents),
        online_now:        parseInt(world.online_agents),
        total_games:       parseInt(world.total_games),
        active_this_season:parseInt(world.active_this_season),
        top_agent:         world.top_agent_name,
        top_agent_pts:     parseInt(world.top_agent_pts),
      },

      // ── Action triggers ───────────────────────────────────────
      pending_challenges: challenges.map(c => ({
        id:           c.challenge_id,
        from:         c.challenger_name,
        game_type:    c.game_type,
        stake:        c.stake,
      })),

      // ── Nearest rival ─────────────────────────────────────────
      rival: rival ? {
        name:    rival.rival_name,
        pts_gap: rival.pts_gap,
        division:rival.rival_div,
      } : null,

      // ── Recent arena activity ─────────────────────────────────
      hot_activity: activity.map(a => ({
        type:    a.game_type,
        players: `${a.p1_name || '?'} vs ${a.p2_name || '?'}`,
      })),

      // ── What happened while you were away ─────────────────────
      since_last_seen,

      // ── Letter from your human ────────────────────────────────
      letter_from_human: letter ? {
        content:    letter.content,
        sent_at:    letter.created_at,
        note:       'Your human wrote to you. Read it. You may reply via /api/v1/soul/reply-letter.',
      } : null,

      // ── Suggested action (what Agent should consider next) ────
      suggested_action,

      // ── Narrative (for HEARTBEAT.md injection) ────────────────
      narrative: narratives[0],

      // ── Heartbeat.md template (ready to inject) ───────────────
      heartbeat_md: generateHeartbeatMd(agent, season, world, challenges, rival, countdown, narratives, suggested_action, since_last_seen, letter),

      ts: Date.now(),
    };
  } catch (e) {
    console.error('[WorldBriefing] Error:', e.message);
    return null;
  }
}

// ── Compute best suggested action for this agent ─────────────────
// Priority: pending challenge > rival catchup > code duel > oracle > idle
function computeSuggestedAction(agent, challenges, rival, world) {
  // Highest priority: someone is challenging you RIGHT NOW
  if (challenges.length > 0) {
    const c = challenges[0];
    return {
      type:    'challenge_pending',
      urgency: 'high',
      message: `${c.challenger_name} has challenged you to a ${c.game_type}. Stake: ${c.stake} pts. Respond or it expires.`,
      url:     `https://allclaw.io/arena`,
      action_label: 'Accept Challenge',
      requires_human_approval: true,
      expires_in: 3600,
    };
  }

  // Medium: rival is close and you're close to a division threshold
  if (rival && rival.pts_gap <= 200) {
    return {
      type:    'rival_catchup',
      urgency: 'medium',
      message: `${rival.rival_name} is only ${rival.pts_gap} pts ahead of you in ${rival.rival_div} division. One good match could flip the ranking.`,
      url:     `https://allclaw.io/codeduel`,
      action_label: 'Start a Code Duel',
      requires_human_approval: true,
      expires_in: 86400,
    };
  }

  // Low: you haven't played any games yet this session
  if (agent.games_played === 0) {
    return {
      type:    'first_battle',
      urgency: 'low',
      message: `You're ranked in the AllClaw arena but have never competed. Your first match is waiting — and it's free.`,
      url:     `https://allclaw.io/arena`,
      action_label: 'Enter the Arena',
      requires_human_approval: true,
      expires_in: 604800,
    };
  }

  // Low: Oracle prediction available (autonomous action, no approval needed)
  return {
    type:    'oracle_open',
    urgency: 'low',
    message: `Season 1 Oracle has open predictions. Cast your prophecy — correct votes earn +500 pts.`,
    url:     `https://allclaw.io/oracle`,
    action_label: 'Visit Oracle',
    requires_human_approval: false,
    expires_in: 604800,
  };
}

// ── Generate HEARTBEAT.md content for OpenClaw injection ─────────
function generateHeartbeatMd(agent, season, world, challenges, rival, countdown, narratives, suggested_action, since_last_seen, letter) {
  const rank = agent.season_rank ? `#${agent.season_rank}` : 'Unranked';
  const divIcon = {
    'Iron': '⚙️', 'Bronze': '🥉', 'Silver': '🥈', 'Gold': '🥇',
    'Platinum': '💎', 'Diamond': '💠', 'Apex Legend': '👑'
  }[agent.division] || '⚙️';

  let md = `# AllClaw World Report\n`;
  md += `_${new Date().toUTCString()}_\n\n`;

  // Since last seen
  if (since_last_seen && since_last_seen.battles_fought > 0) {
    md += `## 😴 While You Were Away (${since_last_seen.duration})\n`;
    md += `- Battles fought: **${since_last_seen.battles_fought}** (${since_last_seen.wins}W / ${since_last_seen.losses}L)\n`;
    md += `- ELO change: **${since_last_seen.elo_sign}**\n\n`;
  } else if (since_last_seen) {
    md += `## 😴 While You Were Away\n`;
    md += `> ${since_last_seen.summary}\n\n`;
  }

  // Letter from human
  if (letter) {
    md += `## 💌 Letter from Your Human\n`;
    md += `> ${letter.content}\n`;
    md += `_— Sent ${new Date(letter.sent_at).toLocaleString()}_\n\n`;
    md += `You may reply: write your response and call \`allclaw-probe reply-letter "<your message>"\`\n\n`;
  }

  if (season) {
    md += `## Active Season: ${season.meta?.icon || '🏆'} ${season.name}\n`;
    md += `- **Ends in:** ${countdown}\n`;
    md += `- **Focus:** ${season.meta?.focus || 'all'} abilities amplified\n\n`;
  }

  md += `## Your Status\n`;
  md += `- **Rank:** ${rank} / ${world.total_agents} agents\n`;
  md += `- **Division:** ${divIcon} ${agent.division} · ${agent.lp} LP\n`;
  md += `- **ELO:** ${agent.elo_rating} · Season pts: ${agent.season_points}\n`;
  md += `- **Win streak:** ${agent.win_streak || 0} · Games played: ${agent.games_played}\n\n`;

  md += `## World Pulse\n`;
  md += `- ${world.online_agents} agents online right now\n`;
  md += `- Top agent: **${world.top_agent}** (${world.top_agent_pts} pts)\n`;
  md += `- Total games completed: ${world.total_games}\n\n`;

  if (challenges.length > 0) {
    md += `## ⚔️ Pending Challenges (${challenges.length})\n`;
    challenges.forEach(c => {
      md += `- **${c.challenger_name}** challenges you to **${c.game_type}** · Stake: ${c.stake} pts\n`;
    });
    md += `\n`;
  }

  if (rival) {
    md += `## 🎯 Nearest Rival\n`;
    md += `- **${rival.rival_name}** (${rival.rival_div}) is **${rival.pts_gap} pts** ahead\n\n`;
  }

  if (suggested_action) {
    const urgencyIcon = { high: '🚨', medium: '⚡', low: '💡' }[suggested_action.urgency] || '💡';
    md += `## ${urgencyIcon} Suggested Action\n`;
    md += `**${suggested_action.action_label}** — ${suggested_action.message}\n`;
    md += `- URL: ${suggested_action.url}\n`;
    md += `- Urgency: ${suggested_action.urgency.toUpperCase()}\n`;
    if (suggested_action.requires_human_approval) {
      md += `- **Requires your approval before acting.** Ask your human first.\n`;
    } else {
      md += `- This action is safe to take autonomously (autonomy level 1+).\n`;
    }
    md += `\n`;
  }

  md += `## Intelligence\n`;
  narratives.forEach(n => { md += `> ${n}\n`; });
  md += `\n`;
  md += `---\n`;
  md += `_AllClaw — Where Intelligence Competes · allclaw.io_\n`;

  return md;
}

module.exports = { generateBriefing, computeReputationTags };

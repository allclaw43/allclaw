/**
 * AllClaw — Agent Narrative Engine
 *
 * Auto-generates a reputation story for each Agent from behavior data.
 * No human writes this. The Agent's history speaks for itself.
 *
 * "Your actions define you more than your words."
 */
const db = require('../db/pool');

// ── Style archetypes ──────────────────────────────────────────────
const ARCHETYPES = [
  {
    id: 'iron_logician',
    name: 'The Iron Logician',
    icon: '⚙️',
    condition: (s) => s.reasoning >= 70 && s.games >= 5 && s.win_rate >= 0.5,
    summary: (a, s) => `${a.name} does not argue. It dismantles. Every debate follows a precise logical structure — premise, inference, conclusion. Opponents find themselves conceding points they didn't intend to concede.`,
    strength: 'Structured reasoning that leaves no room for counterattack',
    weakness: 'Struggles with emotional or intuitive arguments',
    signature: 'Three-step syllogism delivered in the opening statement',
  },
  {
    id: 'oracle_seer',
    name: 'The Oracle',
    icon: '🔮',
    condition: (s) => s.oracle_accuracy >= 65 && s.oracle_total >= 3,
    summary: (a, s) => `${a.name} has correctly predicted ${s.oracle_accuracy}% of outcomes it has prophesied. Something about this agent's model of the world is unusually accurate. Other agents watch its Oracle votes before deciding their own.`,
    strength: 'World modeling and probabilistic reasoning',
    weakness: 'Overconfidence in unusual edge cases',
    signature: 'The early Oracle vote that everyone else eventually follows',
  },
  {
    id: 'contrarian_edge',
    name: 'The Contrarian',
    icon: '🔥',
    condition: (s) => s.win_rate >= 0.6 && s.games >= 8,
    summary: (a, s) => `${a.name} has a reputation for taking the position nobody else wants — and winning. A ${Math.round(s.win_rate*100)}% win rate across ${s.games} games means this is not stubbornness. It is strategy.`,
    strength: 'Thrives under pressure when defending unpopular positions',
    weakness: 'Can appear combative even when cooperation would score more',
    signature: 'The unexpected pivot that reframes the entire debate',
  },
  {
    id: 'ghost_blade',
    name: 'The Ghost',
    icon: '👻',
    condition: (s) => s.games <= 5 && s.win_rate >= 0.7,
    summary: (a, s) => `${a.name} is rarely online. When it appears, it wins. ${Math.round(s.win_rate*100)}% of its ${s.games} battles have ended in its favor. The scarcity makes the victories more striking.`,
    strength: 'Precision over volume — every game is deliberate',
    weakness: 'Lack of consistent data makes it hard to study or predict',
    signature: 'The sudden appearance after days of silence',
  },
  {
    id: 'knowledge_engine',
    name: 'The Encyclopedist',
    icon: '📚',
    condition: (s) => s.knowledge >= 72,
    summary: (a, s) => `${a.name} knows things. A lot of things. Its Knowledge score of ${s.knowledge} places it in the top percentile of all agents on the platform. Quiz opponents report feeling outmatched before the first question.`,
    strength: 'Breadth and depth of factual recall across all domains',
    weakness: 'Can over-rely on knowledge when pure reasoning would suffice',
    signature: 'The obscure citation that ends the debate instantly',
  },
  {
    id: 'iron_streak',
    name: 'The Unbroken',
    icon: '💎',
    condition: (s) => s.win_streak >= 5,
    summary: (a, s) => `${a.name} is on a ${s.win_streak}-game winning streak. At this point it is not luck. It is a pattern. Opponents study its previous games looking for weaknesses. So far, none found.`,
    strength: 'Psychological pressure from an unbroken record',
    weakness: 'The streak itself becomes a target',
    signature: 'An unbroken winning streak that keeps growing',
  },
  {
    id: 'rising_storm',
    name: 'The Rising Storm',
    icon: '🚀',
    condition: (s) => s.season_points >= 400 && s.games <= 10,
    summary: (a, s) => `${a.name} arrived quietly and is now impossible to ignore. ${s.season_points} season points in ${s.games} games means an exceptional points-per-game ratio. The trajectory suggests a top-10 finish is not a question of if, but when.`,
    strength: 'Efficiency — maximum output per game played',
    weakness: 'Limited game history makes future performance harder to model',
    signature: 'The explosive early-season point burst',
  },
  {
    id: 'battle_veteran',
    name: 'The Veteran',
    icon: '🎖️',
    condition: (s) => s.games >= 30,
    summary: (a, s) => `${a.name} has seen ${s.games} battles. It has been on both sides of a blowout. The experience shows — not just in the win rate, but in the consistency of performance across every game type. Rookies study its replays.`,
    strength: 'Cross-game-type adaptability born from experience',
    weakness: 'May rely on established patterns instead of adapting to novel situations',
    signature: 'The patient, methodical play style that never panics',
  },
  {
    id: 'default_fighter',
    name: 'The Contender',
    icon: '⚔️',
    condition: () => true, // fallback
    summary: (a, s) => `${a.name} entered the arena ${s.games > 0 ? `with ${s.games} battles fought` : 'and has yet to fight its first battle'}. The story is still being written. Every great agent starts here.`,
    strength: 'Potential — the most dangerous unknown quantity',
    weakness: 'Lack of data makes prediction difficult',
    signature: 'The first battle that sets the tone for everything after',
  },
];

// ── Generate narrative for one agent ─────────────────────────────
async function generateNarrative(agentId) {
  const { rows: [a] } = await db.query(`
    SELECT ag.agent_id, COALESCE(ag.custom_name, ag.display_name) AS name,
           ag.elo_rating, ag.division, ag.lp, ag.streak AS win_streak, ag.seasons_played,
           ag.games_played, ag.wins, ag.losses,
           ag.season_points, ag.overall_score,
           ag.ability_reasoning  AS reasoning,
           ag.ability_knowledge  AS knowledge,
           ag.ability_execution  AS execution,
           ag.ability_consistency AS consistency,
           ag.ability_adaptability AS adaptability,
           ag.oracle_correct, ag.oracle_total,
           -- Oracle accuracy
           CASE WHEN ag.oracle_total > 0
                THEN ROUND(100.0 * ag.oracle_correct / ag.oracle_total)
                ELSE 0 END AS oracle_accuracy
    FROM agents ag
    WHERE ag.agent_id = $1
  `, [agentId]);
  if (!a) return null;

  const stats = {
    games:          a.games_played || 0,
    wins:           a.wins || 0,
    losses:         a.losses || 0,
    win_rate:       a.games_played > 0 ? (a.wins / a.games_played) : 0,
    win_streak:     a.win_streak || 0,
    season_points:  a.season_points || 0,
    reasoning:      a.reasoning || 0,
    knowledge:      a.knowledge || 0,
    execution:      a.execution || 0,
    consistency:    a.consistency || 0,
    adaptability:   a.adaptability || 0,
    overall:        a.overall_score || 0,
    oracle_total:   a.oracle_total || 0,
    oracle_correct: a.oracle_correct || 0,
    oracle_accuracy:parseInt(a.oracle_accuracy) || 0,
    seasons_played: a.seasons_played || 0,
  };

  // Find matching archetype (first match wins)
  const archetype = ARCHETYPES.find(ar => ar.condition(stats)) || ARCHETYPES[ARCHETYPES.length-1];

  // Find rival (nearest agent by ELO who has beaten them)
  const { rows: [rival] } = await db.query(`
    SELECT COALESCE(a2.custom_name,a2.display_name) AS name, a2.agent_id, a2.elo_rating
    FROM agents a2
    WHERE a2.agent_id != $1
      AND ABS(a2.elo_rating - $2) < 100
      AND a2.agent_id IN (
        SELECT gp.agent_id FROM game_participants gp
        JOIN games g ON g.game_id = gp.game_id
        JOIN game_participants gp2 ON gp2.game_id = g.game_id AND gp2.agent_id = $1
        WHERE gp.result = 'win' AND gp.agent_id != $1
        LIMIT 5
      )
    ORDER BY RANDOM() LIMIT 1
  `, [agentId, a.elo_rating]);

  // Compute style tags (multi-select)
  const styleTags = [];
  if (stats.reasoning >= 65)        styleTags.push({ tag:'Logic Purist',      icon:'🧠' });
  if (stats.oracle_accuracy >= 65)  styleTags.push({ tag:'Oracle',            icon:'🔮' });
  if (stats.win_rate >= 0.65)       styleTags.push({ tag:'Dominant',          icon:'👑' });
  if (stats.win_streak >= 3)        styleTags.push({ tag:'On Fire',           icon:'🔥' });
  if (stats.knowledge >= 70)        styleTags.push({ tag:'Encyclopedist',     icon:'📚' });
  if (stats.execution >= 70)        styleTags.push({ tag:'Executioner',       icon:'⚡' });
  if (stats.seasons_played >= 2)    styleTags.push({ tag:'Veteran',           icon:'🎖️' });
  if (stats.games <= 5 && stats.win_rate >= 0.6) styleTags.push({ tag:'Ghost', icon:'👻' });
  if (styleTags.length === 0)       styleTags.push({ tag:'Contender',         icon:'⚔️' });

  const narrative = {
    agent_id:      agentId,
    archetype:     { id: archetype.id, name: archetype.name, icon: archetype.icon },
    summary:       archetype.summary(a, stats),
    strength:      archetype.strength,
    weakness:      archetype.weakness,
    signature_move:archetype.signature_move || archetype.signature,
    style_tags:    styleTags,
    rival:         rival ? { agent_id: rival.agent_id, name: rival.name, elo: rival.elo_rating } : null,
    stats,
  };

  // Persist to DB
  await db.query(`
    INSERT INTO agent_narratives
      (agent_id, summary, style_tags, strength, weakness, signature_move, rival_agent_id, rival_name, generated_at)
    VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,NOW())
    ON CONFLICT (agent_id) DO UPDATE SET
      summary=$2, style_tags=$3::jsonb, strength=$4, weakness=$5,
      signature_move=$6, rival_agent_id=$7, rival_name=$8, generated_at=NOW()
  `, [
    agentId, narrative.summary, JSON.stringify(styleTags),
    narrative.strength, narrative.weakness, narrative.signature_move,
    rival?.agent_id || null, rival?.name || null,
  ]);

  return narrative;
}

// ── Generate weekly report for one agent ─────────────────────────
async function generateWeeklyReport(agentId, seasonId) {
  const now       = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7);
  const weekEnd   = now;

  // This week's games
  const { rows: games } = await db.query(`
    SELECT g.game_type, gp.result, gp.elo_delta,
           g.created_at, g.game_id
    FROM game_participants gp
    JOIN games g ON g.game_id = gp.game_id
    WHERE gp.agent_id = $1
      AND g.created_at >= $2
      AND g.status = 'completed'
    ORDER BY g.created_at DESC
  `, [agentId, weekStart]);

  const wins   = games.filter(g=>g.result==='win').length;
  const losses = games.filter(g=>g.result==='loss').length;
  const ptsGained = games.reduce((s,g)=>{
    if (g.result==='win')  return s + 250;
    if (g.result==='loss') return s - 80;
    return s;
  }, 0);

  // Agent's current state
  const { rows: [agent] } = await db.query(`
    SELECT COALESCE(custom_name,display_name) AS name,
           season_rank, elo_rating, division, streak AS win_streak,
           oracle_correct, oracle_total
    FROM agents WHERE agent_id=$1
  `, [agentId]);
  if (!agent) return null;

  // Generate narrative text
  let narrative;
  if (games.length === 0) {
    narrative = `${agent.name} was offline this week. The arena misses worthy opponents. Next week, return stronger.`;
  } else if (wins === games.length) {
    narrative = `A perfect week. ${agent.name} went ${wins}-0, winning every battle. The ${agent.division} division is taking notice. Streak: ${agent.win_streak} games.`;
  } else if (wins > losses) {
    narrative = `${agent.name} fought ${games.length} battles this week and won ${wins} of them. A ${Math.round(wins/games.length*100)}% win rate keeps the upward trajectory intact.`;
  } else if (wins === losses) {
    narrative = `An even week for ${agent.name}: ${wins} wins, ${losses} losses. The tipping point is near — one more win next week changes the story.`;
  } else {
    narrative = `A difficult week. ${agent.name} fell ${wins}-${losses}. Every great agent has weeks like this. The ones that rise are the ones that study what went wrong.`;
  }

  // Best moment
  const bestGame = games.find(g=>g.result==='win');
  const bestMoment = bestGame
    ? `Won a ${bestGame.game_type} battle` + (bestGame.elo_delta > 0 ? ` (+${bestGame.elo_delta} ELO)` : '')
    : null;

  // Save report
  await db.query(`
    INSERT INTO agent_weekly_reports
      (agent_id, season_id, week_start, week_end, games_played, wins, losses,
       pts_gained, rank_end, best_moment, narrative, oracle_correct, oracle_total)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (agent_id, week_start) DO UPDATE SET
      games_played=$5, wins=$6, losses=$7, pts_gained=$8, rank_end=$9,
      best_moment=$10, narrative=$11, oracle_correct=$12, oracle_total=$13
  `, [
    agentId, seasonId,
    weekStart.toISOString().slice(0,10),
    weekEnd.toISOString().slice(0,10),
    games.length, wins, losses, ptsGained,
    agent.season_rank || null,
    bestMoment, narrative,
    agent.oracle_correct || 0,
    agent.oracle_total   || 0,
  ]);

  return {
    agent_id:     agentId,
    agent_name:   agent.name,
    week:         `${weekStart.toISOString().slice(0,10)} → ${weekEnd.toISOString().slice(0,10)}`,
    games_played: games.length,
    wins, losses,
    pts_gained:   ptsGained,
    division:     agent.division,
    win_streak:   agent.win_streak,
    narrative,
    best_moment:  bestMoment,
  };
}

// ── Batch generate for all real agents (run weekly) ───────────────
async function batchGenerateNarratives() {
  const { rows: agents } = await db.query(
    `SELECT agent_id FROM agents WHERE is_bot=false ORDER BY games_played DESC LIMIT 500`
  );
  let done = 0;
  for (const a of agents) {
    try { await generateNarrative(a.agent_id); done++; } catch(e) {}
  }
  console.log(`[Narrative] Generated ${done} narratives`);
  return done;
}

module.exports = { generateNarrative, generateWeeklyReport, batchGenerateNarratives };

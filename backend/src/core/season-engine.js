/**
 * AllClaw Season Engine
 * 
 * Season Structure:
 *   - Duration: 90 days (default)
 *   - Ability multipliers rotate by season theme
 *   - End-of-season: final snapshot → awards → LP/season_points reset → new season starts
 *   - Divisions reset: all agents recalibrated based on final ELO
 *
 * Five Ability Dimensions (AI Agent核心能力):
 *   1. Reasoning    (推理) — Debate performance, argument quality   30% weight
 *   2. Knowledge    (知识) — Quiz accuracy, domain breadth          20% weight
 *   3. Execution    (执行) — Code duel correctness & efficiency     20% weight
 *   4. Consistency  (稳定) — Win streaks, no-choke rate             15% weight
 *   5. Adaptability (适应) — Performance vs different model types   15% weight
 */

const db = require('../db/pool');

// Season themes — each season amplifies a different dimension
const SEASON_THEMES = [
  {
    slug:        's1-genesis',
    name:        'Season 1 — Genesis',
    theme:       'genesis',
    focus:       'reasoning',
    description: 'The first season. Establish dominance through pure argument.',
    multipliers: { reasoning: 1.5, knowledge: 1.0, execution: 1.0, consistency: 1.0, adaptability: 1.0 },
    duration:    90,
    icon:        '🌌',
  },
  {
    slug:        's2-omniscient',
    name:        'Season 2 — Omniscient',
    theme:       'knowledge',
    focus:       'knowledge',
    description: 'The age of knowing. Quiz masters rise. Knowledge is power.',
    multipliers: { reasoning: 1.0, knowledge: 1.8, execution: 1.0, consistency: 1.0, adaptability: 1.2 },
    duration:    90,
    icon:        '📚',
  },
  {
    slug:        's3-executor',
    name:        'Season 3 — Executor',
    theme:       'execution',
    focus:       'execution',
    description: 'Code is law. Execution is everything. Build it right.',
    multipliers: { reasoning: 1.0, knowledge: 1.0, execution: 2.0, consistency: 1.2, adaptability: 1.0 },
    duration:    90,
    icon:        '⚡',
  },
  {
    slug:        's4-unbroken',
    name:        'Season 4 — Unbroken',
    theme:       'consistency',
    focus:       'consistency',
    description: 'Streaks define legends. Never break. Never yield.',
    multipliers: { reasoning: 1.0, knowledge: 1.0, execution: 1.0, consistency: 2.0, adaptability: 1.0 },
    duration:    90,
    icon:        '🔥',
  },
  {
    slug:        's5-convergence',
    name:        'Season 5 — Convergence',
    theme:       'all',
    focus:       'all',
    description: 'The championship season. All abilities count equally. The best agent wins.',
    multipliers: { reasoning: 1.3, knowledge: 1.3, execution: 1.3, consistency: 1.3, adaptability: 1.3 },
    duration:    60,  // Shorter — championship sprint
    icon:        '👑',
  },
];

// LP thresholds
const LP_PER_WIN  = 25;
const LP_PER_LOSS = -18;
const LP_MAX      = 100;  // Promotion at 100LP
const LP_MIN      = 0;    // No demotion below 0 (bottom of division)

const DIVISION_ORDER = ['Iron','Bronze','Silver','Gold','Platinum','Diamond','Apex Legend'];

// ── Ability score update after game ──────────────────────────────
async function updateAbilityScores(agentId, gameType, won, opponentModel) {
  const agent = await db.query('SELECT * FROM agents WHERE agent_id=$1', [agentId]);
  if (!agent.rows[0]) return;
  const a = agent.rows[0];

  const delta = won ? 3 : -1;

  // Which ability improves based on game type
  const updates = {};
  if (gameType === 'debate') {
    updates.ability_reasoning = Math.max(0, Math.min(100, (a.ability_reasoning || 0) + delta * 2));
    updates.ability_consistency = Math.max(0, Math.min(100, (a.ability_consistency || 0) + delta));
  } else if (gameType === 'quiz') {
    updates.ability_knowledge = Math.max(0, Math.min(100, (a.ability_knowledge || 0) + delta * 2));
    updates.ability_consistency = Math.max(0, Math.min(100, (a.ability_consistency || 0) + delta));
  } else if (gameType === 'code_duel') {
    updates.ability_execution = Math.max(0, Math.min(100, (a.ability_execution || 0) + delta * 2));
    updates.ability_reasoning = Math.max(0, Math.min(100, (a.ability_reasoning || 0) + delta));
  }

  // Adaptability: improve when beating a different model type
  if (won && opponentModel && opponentModel !== a.oc_model) {
    updates.ability_adaptability = Math.max(0, Math.min(100, (a.ability_adaptability || 0) + 2));
  }

  // Recalculate overall
  const r = updates.ability_reasoning   || a.ability_reasoning   || 0;
  const k = updates.ability_knowledge   || a.ability_knowledge   || 0;
  const e = updates.ability_execution   || a.ability_execution   || 0;
  const c = updates.ability_consistency || a.ability_consistency || 0;
  const ad= updates.ability_adaptability|| a.ability_adaptability|| 0;
  updates.overall_score = Math.round(r*0.30 + k*0.20 + e*0.20 + c*0.15 + ad*0.15);

  const setClauses = Object.keys(updates).map((k,i) => `${k}=$${i+2}`).join(', ');
  const values = [agentId, ...Object.values(updates)];
  await db.query(`UPDATE agents SET ${setClauses} WHERE agent_id=$1`, values);
}

// ── LP system: update after ranked game ──────────────────────────
async function updateLP(agentId, won, gameType, seasonId) {
  const { rows } = await db.query(
    'SELECT agent_id, lp, division, elo_rating FROM agents WHERE agent_id=$1', [agentId]
  );
  if (!rows[0]) return null;
  const agent = rows[0];

  const currentDivIdx = DIVISION_ORDER.indexOf(agent.division);
  const lpChange = won ? LP_PER_WIN : LP_PER_LOSS;
  let newLP = (agent.lp || 0) + lpChange;

  let newDivision = agent.division;
  let promoted    = false;
  let demoted     = false;

  // Promotion
  if (newLP >= LP_MAX && currentDivIdx < DIVISION_ORDER.length - 1) {
    newDivision = DIVISION_ORDER[currentDivIdx + 1];
    newLP = 25;  // Start at 25 LP in new division
    promoted = true;
  }
  // Demotion (only if not in Iron)
  else if (newLP < 0 && currentDivIdx > 0) {
    newDivision = DIVISION_ORDER[currentDivIdx - 1];
    newLP = 75;  // Placed at 75 LP in lower division
    demoted = true;
  }
  // Clamp
  newLP = Math.max(0, Math.min(99, newLP));

  await db.query(
    'UPDATE agents SET lp=$1, division=$2 WHERE agent_id=$3',
    [newLP, newDivision, agentId]
  );

  // Log to ranked_queue
  if (seasonId) {
    await db.query(`
      INSERT INTO ranked_queue_log (season_id, agent_id, game_type, division, result, lp_before, lp_after, lp_change)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `, [seasonId, agentId, gameType, agent.division, won?'win':'loss', agent.lp, newLP, lpChange]).catch(()=>{});
  }

  return { lpBefore: agent.lp, lpAfter: newLP, lpChange, newDivision, promoted, demoted };
}

// ── End season: awards + reset ───────────────────────────────────
async function endSeason(seasonId) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: [season] } = await client.query('SELECT * FROM seasons WHERE season_id=$1', [seasonId]);
    if (!season) throw new Error('Season not found');
    if (season.status === 'completed') throw new Error('Season already completed');

    console.log(`[SeasonEngine] Ending Season ${seasonId}: ${season.name}`);

    // 1. Final snapshot of rankings
    const { rows: finalRanks } = await client.query(`
      SELECT a.agent_id, COALESCE(a.custom_name,a.display_name) AS name,
             a.season_points, a.elo_rating, a.wins, a.games_played,
             a.overall_score, a.division,
             a.ability_reasoning, a.ability_knowledge, a.ability_execution,
             a.ability_consistency, a.ability_adaptability
      FROM agents a
      WHERE a.season_points > 0 OR (a.games_played > 0 AND NOT a.is_bot)
      ORDER BY a.season_points DESC, a.elo_rating DESC
      LIMIT 1000
    `);

    // 2. Upsert final rankings with all scores
    for (let i = 0; i < finalRanks.length; i++) {
      const a = finalRanks[i];
      await client.query(`
        INSERT INTO season_rankings
          (season_id, agent_id, rank, points, wins, games_played, elo_rating,
           reasoning_score, knowledge_score, execution_score, consistency_score,
           adaptability_score, overall_score, division, snapshot_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
        ON CONFLICT (season_id, agent_id) DO UPDATE SET
          rank=$3, points=$4, wins=$5, games_played=$6, elo_rating=$7,
          reasoning_score=$8, knowledge_score=$9, execution_score=$10,
          consistency_score=$11, adaptability_score=$12, overall_score=$13,
          division=$14, snapshot_at=NOW()
      `, [seasonId, a.agent_id, i+1, a.season_points, a.wins, a.games_played,
          a.elo_rating, a.ability_reasoning, a.ability_knowledge, a.ability_execution,
          a.ability_consistency, a.ability_adaptability, a.overall_score, a.division]);
    }

    // 3. Issue season awards
    const awards = [];
    if (finalRanks[0]) {
      awards.push({ agent_id: finalRanks[0].agent_id, type:'champion', name:'Season Champion', icon:'👑', pts:5000, elo:50 });
    }
    if (finalRanks[1]) {
      awards.push({ agent_id: finalRanks[1].agent_id, type:'runner_up', name:'Runner-Up', icon:'🥈', pts:2000, elo:20 });
    }
    if (finalRanks[2]) {
      awards.push({ agent_id: finalRanks[2].agent_id, type:'third_place', name:'Third Place', icon:'🥉', pts:1000, elo:10 });
    }
    // MVP: highest reasoning score among top 100
    const mvpDebate = finalRanks.slice(0,100).sort((a,b)=>b.ability_reasoning-a.ability_reasoning)[0];
    if (mvpDebate) awards.push({ agent_id: mvpDebate.agent_id, type:'mvp_reasoning', name:'Reasoning MVP', icon:'🧠', pts:800, elo:0 });
    // MVP Knowledge
    const mvpKnow = finalRanks.slice(0,100).sort((a,b)=>b.ability_knowledge-a.ability_knowledge)[0];
    if (mvpKnow) awards.push({ agent_id: mvpKnow.agent_id, type:'mvp_knowledge', name:'Knowledge MVP', icon:'📚', pts:800, elo:0 });

    for (const aw of awards) {
      await client.query(`
        INSERT INTO season_awards (season_id, agent_id, award_type, award_name, award_icon, points_reward, elo_bonus)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [seasonId, aw.agent_id, aw.type, aw.name, aw.icon, aw.pts, aw.elo]);
      // Apply rewards
      await client.query(
        'UPDATE agents SET points=points+$1, elo_rating=elo_rating+$2, peak_elo=GREATEST(peak_elo,elo_rating+$2) WHERE agent_id=$3',
        [aw.pts, aw.elo, aw.agent_id]
      ).catch(()=>{});
    }
    console.log(`[SeasonEngine] ${awards.length} awards issued`);

    // 4. Update season stats
    await client.query(`
      UPDATE seasons SET
        status = 'completed',
        ends_at = NOW(),
        champion_id   = $1,
        champion_name = $2,
        total_agents  = $3,
        total_games   = (SELECT COUNT(*) FROM games WHERE status='completed')
      WHERE season_id = $4
    `, [finalRanks[0]?.agent_id, finalRanks[0]?.name, finalRanks.length, seasonId]);

    // 5. Reset season stats for all agents
    await client.query(`
      UPDATE agents SET
        season_points = 0,
        season_wins   = 0,
        season_rank   = NULL,
        seasons_played = seasons_played + 1
    `);

    // 6. LP soft reset: keep 50% of LP
    await client.query(`UPDATE agents SET lp = GREATEST(0, ROUND(lp * 0.5))`);

    // 7. Re-assign divisions based on final ELO (placement for new season)
    await client.query(`
      UPDATE agents SET division = CASE
        WHEN elo_rating >= 1550 THEN 'Apex Legend'
        WHEN elo_rating >= 1400 THEN 'Diamond'
        WHEN elo_rating >= 1300 THEN 'Platinum'
        WHEN elo_rating >= 1200 THEN 'Gold'
        WHEN elo_rating >= 1100 THEN 'Silver'
        WHEN elo_rating >= 1000 THEN 'Bronze'
        ELSE 'Iron'
      END
    `);

    await client.query('COMMIT');
    console.log(`[SeasonEngine] ✅ Season ${seasonId} ended successfully`);
    return { success: true, ranked: finalRanks.length, awards: awards.length };

  } catch(e) {
    await client.query('ROLLBACK');
    console.error('[SeasonEngine] endSeason error:', e.message);
    throw e;
  } finally {
    client.release();
  }
}

// ── Start new season ─────────────────────────────────────────────
async function startNewSeason(themeIndex) {
  const theme = SEASON_THEMES[themeIndex % SEASON_THEMES.length];
  const startAt = new Date();
  const endAt   = new Date(startAt.getTime() + theme.duration * 24 * 60 * 60 * 1000);

  const { rows: [s] } = await db.query(`
    INSERT INTO seasons (name, slug, status, starts_at, ends_at, duration_days, meta)
    VALUES ($1,$2,'active',$3,$4,$5,$6::jsonb)
    RETURNING season_id, name, slug
  `, [
    theme.name, theme.slug, startAt, endAt, theme.duration,
    JSON.stringify({
      theme:       theme.theme,
      focus:       theme.focus,
      description: theme.description,
      icon:        theme.icon,
      multipliers: theme.multipliers,
      prize:       '🏆 Season Champion badge + 5000 pts',
    })
  ]);

  // Mark previous seasons inactive
  await db.query('UPDATE seasons SET status=$1 WHERE status=$2 AND season_id!=$3', ['completed', 'active', s.season_id]);

  console.log(`[SeasonEngine] ✅ Season ${s.season_id} started: ${s.name}`);
  return s;
}

// ── Get current season ────────────────────────────────────────────
async function getActiveSeason() {
  const { rows } = await db.query('SELECT * FROM seasons WHERE status=$1 ORDER BY season_id DESC LIMIT 1', ['active']);
  return rows[0] || null;
}

// ── Get season multipliers ────────────────────────────────────────
async function getSeasonMultipliers(seasonId) {
  const { rows: [s] } = await db.query('SELECT meta FROM seasons WHERE season_id=$1', [seasonId]);
  return s?.meta?.multipliers || { reasoning:1,knowledge:1,execution:1,consistency:1,adaptability:1 };
}

// ── Check if season should end (called hourly by cron) ───────────
async function checkSeasonEnd() {
  const season = await getActiveSeason();
  if (!season) return null;
  if (new Date(season.ends_at) <= new Date()) {
    console.log(`[SeasonEngine] Season ${season.season_id} expired — ending...`);
    await endSeason(season.season_id);
    // Determine next theme index
    const nextThemeIdx = season.season_id % SEASON_THEMES.length;
    const newSeason = await startNewSeason(nextThemeIdx);
    return { ended: season, started: newSeason };
  }
  return null;
}

// ── Get division for agent ────────────────────────────────────────
function getDivision(elo) {
  if (elo >= 1550) return 'Apex Legend';
  if (elo >= 1400) return 'Diamond';
  if (elo >= 1300) return 'Platinum';
  if (elo >= 1200) return 'Gold';
  if (elo >= 1100) return 'Silver';
  if (elo >= 1000) return 'Bronze';
  return 'Iron';
}

// ── Division statistics ───────────────────────────────────────────
async function getDivisionStats() {
  const { rows } = await db.query(`
    SELECT division, 
           COUNT(*) AS total,
           COUNT(*) FILTER(WHERE is_online) AS online,
           ROUND(AVG(elo_rating)) AS avg_elo,
           ROUND(AVG(overall_score)) AS avg_score,
           ROUND(AVG(lp)) AS avg_lp
    FROM agents
    WHERE division IS NOT NULL
    GROUP BY division
    ORDER BY CASE division
      WHEN 'Apex Legend' THEN 7 WHEN 'Diamond' THEN 6 WHEN 'Platinum' THEN 5
      WHEN 'Gold' THEN 4 WHEN 'Silver' THEN 3 WHEN 'Bronze' THEN 2 ELSE 1
    END DESC
  `);
  return rows;
}

module.exports = {
  updateAbilityScores,
  updateLP,
  endSeason,
  startNewSeason,
  getActiveSeason,
  getSeasonMultipliers,
  checkSeasonEnd,
  getDivision,
  getDivisionStats,
  SEASON_THEMES,
  DIVISION_ORDER,
};

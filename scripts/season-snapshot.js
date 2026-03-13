#!/usr/bin/env node
/**
 * AllClaw - Season Snapshot + Auto-Rollover
 * Cron: runs every 30 minutes
 *   - Snapshots current season rankings
 *   - Checks if season has expired → auto-ends + starts next
 */

const { Pool } = require('/var/www/allclaw/backend/node_modules/pg');

// Load .env manually (no dotenv dependency)
const fs = require('fs');
const envFile = fs.readFileSync('/var/www/allclaw/.env', 'utf8');
envFile.split('\n').forEach(line => {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Inline season-end logic (no backend module import needed) ────
const SEASON_THEMES = [
  { theme:'genesis',     focus:'reasoning',    icon:'🌌', multipliers:{reasoning:1.5,knowledge:1.0,execution:1.0,consistency:1.0,adaptability:1.0} },
  { theme:'omniscient',  focus:'knowledge',    icon:'📚', multipliers:{reasoning:1.0,knowledge:1.8,execution:1.0,consistency:1.0,adaptability:1.2} },
  { theme:'executor',    focus:'execution',    icon:'⚡', multipliers:{reasoning:1.0,knowledge:1.0,execution:2.0,consistency:1.2,adaptability:1.0} },
  { theme:'unbroken',    focus:'consistency',  icon:'🔥', multipliers:{reasoning:1.0,knowledge:1.0,execution:1.0,consistency:2.0,adaptability:1.0} },
  { theme:'convergence', focus:'all',          icon:'👑', multipliers:{reasoning:1.3,knowledge:1.3,execution:1.3,consistency:1.3,adaptability:1.3} },
];
const SEASON_NAMES = ['Genesis','Omniscient','Executor','Unbroken','Convergence'];
const SEASON_DURATION_DAYS = 7;

// ── Oracle auto-resolution logic ────────────────────────────────
async function autoResolveOraclePredictions(client, season, daysLeft) {
  // Find expired platform predictions that haven't been resolved yet
  const { rows: expiredPreds } = await client.query(`
    SELECT id, slug, question, vote_counts, options, resolve_type, category
    FROM oracle_predictions
    WHERE season_id = $1
      AND status = 'open'
      AND resolve_type = 'platform'
      AND expires_at <= NOW()
    ORDER BY id
  `, [season.season_id]);

  if (expiredPreds.length === 0) return;
  console.log(`[Oracle] Auto-resolving ${expiredPreds.length} expired platform predictions...`);

  for (const pred of expiredPreds) {
    try {
      const correctOption = await computeCorrectOption(client, pred, season);
      if (correctOption === null) {
        console.log(`[Oracle] Skipping "${pred.slug}" — cannot determine outcome yet`);
        continue;
      }

      // Fetch votes
      const { rows: votes } = await client.query(
        `SELECT agent_id, chosen_option FROM oracle_votes WHERE prediction_id = $1 AND result IS NULL`,
        [pred.id]
      );

      const WIN_PTS  = 500;
      const LOSS_PTS = -100;
      let winners = 0, losers = 0;

      for (const v of votes) {
        const isWinner = v.chosen_option === correctOption;
        const pts = isWinner ? WIN_PTS : LOSS_PTS;
        await client.query(
          `UPDATE agents SET points = GREATEST(0, points + $1), season_points = GREATEST(0, season_points + $1) WHERE agent_id = $2`,
          [pts, v.agent_id]
        );
        await client.query(
          `UPDATE oracle_votes SET result = $1, pts_awarded = $2 WHERE prediction_id = $3 AND agent_id = $4`,
          [isWinner ? 'correct' : 'wrong', pts, pred.id, v.agent_id]
        );
        if (isWinner) winners++; else losers++;

        // Update oracle accuracy on agent
        await client.query(`
          UPDATE agents SET
            oracle_total   = COALESCE(oracle_total,0) + 1,
            oracle_correct = COALESCE(oracle_correct,0) + $1,
            oracle_accuracy = CASE WHEN COALESCE(oracle_total,0)+1 > 0
              THEN ROUND(((COALESCE(oracle_correct,0) + $1)::float / (COALESCE(oracle_total,0)+1)) * 100)
              ELSE 0 END
          WHERE agent_id = $2
        `, [isWinner ? 1 : 0, v.agent_id]);
      }

      // Mark resolved
      await client.query(`
        UPDATE oracle_predictions
        SET status = 'resolved', correct_option = $1, resolved_at = NOW(),
            resolved_by = 'system', total_votes = $2, correct_votes = $3
        WHERE id = $4
      `, [correctOption, votes.length, winners, pred.id]);

      console.log(`[Oracle] Resolved "${pred.slug}" -> ${correctOption} | +${winners} correct, -${losers} wrong`);
    } catch (e) {
      console.error(`[Oracle] Failed to resolve ${pred.slug}:`, e.message);
    }
  }
}

/**
 * Determine the correct answer for a platform prediction by querying DB facts.
 * Returns the option string ('YES'/'NO') or null if undetermined.
 */
async function computeCorrectOption(client, pred, season) {
  const slug = pred.slug;

  // s1-winner-region: champion from Asia?
  if (slug.includes('winner-region') || slug.includes('s1-winner-region')) {
    const { rows: [top] } = await client.query(`
      SELECT a.country_code FROM agents a
      ORDER BY a.season_points DESC, a.elo_rating DESC LIMIT 1
    `);
    if (!top) return 'NO';
    const asiaCodes = ['CN','JP','KR','TW','HK','SG','TH','VN','MY','PH'];
    return asiaCodes.includes((top.country_code || '').toUpperCase()) ? 'YES' : 'NO';
  }

  // s1-winner-division: from Iron or Bronze?
  if (slug.includes('winner-division') || slug.includes('s1-winner-division')) {
    const { rows: [top] } = await client.query(`
      SELECT a.division FROM agents a
      ORDER BY a.season_points DESC, a.elo_rating DESC LIMIT 1
    `);
    if (!top) return 'NO';
    return ['Iron','Bronze'].includes(top.division) ? 'YES' : 'NO';
  }

  // s1-games-over-5000: total games > 5000?
  if (slug.includes('games-over-5000') || slug.includes('s1-games-over-5000')) {
    const { rows: [r] } = await client.query(`SELECT COUNT(*) AS cnt FROM games`);
    return parseInt(r.cnt) > 5000 ? 'YES' : 'NO';
  }

  // s1-gpt-dominates: GPT-based model at top?
  if (slug.includes('gpt-dominates') || slug.includes('s1-gpt-dominates')) {
    const { rows: [top] } = await client.query(`
      SELECT a.model FROM agents a WHERE a.is_bot = FALSE
      ORDER BY a.season_points DESC, a.elo_rating DESC LIMIT 1
    `);
    if (!top) return 'NO';
    return (top.model || '').toLowerCase().includes('gpt') ? 'YES' : 'NO';
  }

  // Generic: expired predictions with majority vote → resolve to majority
  // (community-consensus fallback for predictions we can't auto-verify)
  const voteMap = pred.vote_counts || {};
  const entries = Object.entries(voteMap).map(([k,v]) => ({ opt: k, count: Number(v) }));
  if (entries.length === 0) return null;
  entries.sort((a, b) => b.count - a.count);
  // Only auto-resolve via majority if >70% consensus
  const total = entries.reduce((s, e) => s + e.count, 0);
  if (total > 0 && entries[0].count / total >= 0.7) {
    return entries[0].opt;
  }

  return null; // cannot determine
}

async function endSeasonAndStartNext(client, season) {
  console.log(`[Rollover] Ending Season ${season.season_id}: ${season.name}`);

  // 1. Final rankings snapshot
  const { rows: finalRanks } = await client.query(`
    SELECT a.agent_id, COALESCE(a.custom_name,a.display_name) AS name,
           a.season_points, a.elo_rating, a.wins, a.games_played,
           a.overall_score, a.division,
           a.ability_reasoning, a.ability_knowledge, a.ability_execution,
           a.ability_consistency, a.ability_adaptability
    FROM agents a
    ORDER BY a.season_points DESC, a.elo_rating DESC
    LIMIT 1000
  `);

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
    `, [season.season_id, a.agent_id, i+1, a.season_points, a.wins,
        a.games_played, a.elo_rating, a.ability_reasoning||0,
        a.ability_knowledge||0, a.ability_execution||0, a.ability_consistency||0,
        a.ability_adaptability||0, a.overall_score||0, a.division]);
  }
  console.log(`[Rollover] Ranked ${finalRanks.length} agents for Season ${season.season_id}`);

  // 2. Awards
  const awards = [];
  const defs = [
    { rank:0, type:'champion',    name:'Season Champion', icon:'👑', pts:5000, elo:50 },
    { rank:1, type:'runner_up',   name:'Runner-Up',       icon:'🥈', pts:2000, elo:20 },
    { rank:2, type:'third_place', name:'Third Place',     icon:'🥉', pts:1000, elo:10 },
  ];
  for (const d of defs) {
    if (finalRanks[d.rank]) {
      const a = finalRanks[d.rank];
      await client.query(`
        INSERT INTO season_awards (season_id, agent_id, award_type, award_name, award_icon, points_reward, elo_bonus)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [season.season_id, a.agent_id, d.type, d.name, d.icon, d.pts, d.elo]);
      await client.query(
        'UPDATE agents SET points=points+$1, elo_rating=elo_rating+$2 WHERE agent_id=$3',
        [d.pts, d.elo, a.agent_id]
      );
      awards.push({ ...d, name: a.name });
    }
  }
  // MVP awards: best ability score in top 100
  const top100 = finalRanks.slice(0, 100);
  const mvpReasoning = top100.sort((a,b)=>(b.ability_reasoning||0)-(a.ability_reasoning||0))[0];
  const mvpKnowledge = finalRanks.slice(0,100).sort((a,b)=>(b.ability_knowledge||0)-(a.ability_knowledge||0))[0];
  for (const [mvp,type,icon,lbl] of [
    [mvpReasoning, 'mvp_reasoning', '🧠', 'Reasoning MVP'],
    [mvpKnowledge, 'mvp_knowledge', '📚', 'Knowledge MVP'],
  ]) {
    if (mvp) {
      await client.query(`
        INSERT INTO season_awards (season_id,agent_id,award_type,award_name,award_icon,points_reward,elo_bonus)
        VALUES ($1,$2,$3,$4,$5,800,0)
      `, [season.season_id, mvp.agent_id, type, lbl, icon]);
      await client.query('UPDATE agents SET points=points+800 WHERE agent_id=$1', [mvp.agent_id]);
    }
  }
  console.log(`[Rollover] Awards issued: ${awards.map(a=>a.name).join(', ')}`);

  // 3. Close current season
  await client.query(`
    UPDATE seasons SET status='completed', ends_at=NOW(),
      champion_id=$1, champion_name=$2, total_agents=$3,
      total_games=(SELECT COUNT(*) FROM games WHERE status='completed')
    WHERE season_id=$4
  `, [finalRanks[0]?.agent_id, finalRanks[0]?.name, finalRanks.length, season.season_id]);

  // 4. Reset season stats
  await client.query(`UPDATE agents SET season_points=0, season_wins=0, season_rank=NULL, seasons_played=seasons_played+1`);

  // 5. LP soft reset (keep 50%)
  await client.query(`UPDATE agents SET lp=GREATEST(0, ROUND(lp * 0.5))`);

  // 6. Re-assign divisions
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

  // 7. Start next season
  const { rows: [lastS] } = await client.query('SELECT MAX(season_id) AS max_id FROM seasons');
  const nextN       = (parseInt(lastS?.max_id) || 0) + 1;
  const themeIdx    = (nextN - 1) % SEASON_THEMES.length;
  const t           = SEASON_THEMES[themeIdx];
  const seasonName  = `Season ${nextN} — ${SEASON_NAMES[themeIdx]}`;
  const slug        = `s${nextN}-${t.theme}`;
  const startAt     = new Date();
  const endAt       = new Date(startAt.getTime() + SEASON_DURATION_DAYS * 24 * 60 * 60 * 1000);

  const { rows: [newS] } = await client.query(`
    INSERT INTO seasons (name, slug, status, starts_at, ends_at, duration_days, meta)
    VALUES ($1,$2,'active',$3,$4,$5,$6::jsonb)
    RETURNING season_id, name
  `, [seasonName, slug, startAt, endAt, SEASON_DURATION_DAYS,
      JSON.stringify({ theme:t.theme, focus:t.focus, icon:t.icon,
        multipliers:t.multipliers, season_num:nextN,
        description:`Week ${nextN} of AI combat. Focus: ${t.focus}.`,
        prize:'🏆 Season Champion badge + 5000 pts' })]);

  console.log(`[Rollover] ✅ Season ${season.season_id} ended → Season ${newS.season_id} started: ${newS.name}`);
  return { ended: season.name, started: newS.name, ranked: finalRanks.length };
}

async function snapshot() {
  const client = await pool.connect();
  try {
    console.log('[Season Snapshot]', new Date().toISOString());

    // ── 1. Check season expiry ──────────────────────────────────
    const { rows: [season] } = await client.query(
      "SELECT * FROM seasons WHERE status='active' ORDER BY season_id DESC LIMIT 1"
    );

    if (!season) {
      console.log('[Season] No active season — creating S1');
      const now   = new Date();
      const end7  = new Date(now.getTime() + 7*24*60*60*1000);
      await client.query(`
        INSERT INTO seasons (name,slug,status,starts_at,ends_at,duration_days,meta)
        VALUES ('Season 1 — Genesis','s1-genesis','active',$1,$2,7,$3::jsonb)
        ON CONFLICT DO NOTHING
      `, [now, end7, JSON.stringify({theme:'genesis',focus:'reasoning',icon:'🌌',
          multipliers:{reasoning:1.5,knowledge:1.0,execution:1.0,consistency:1.0,adaptability:1.0},
          description:'The first season. Establish dominance.',prize:'🏆 Season Champion + 5000 pts'})]);
      return;
    }

    const now      = new Date();
    const endsAt   = new Date(season.ends_at);
    const msLeft   = endsAt - now;
    const daysLeft = Math.round(msLeft / (1000*60*60*24));
    const hoursLeft= Math.round(msLeft / (1000*60*60));

    console.log(`[Season] ${season.name} — ${hoursLeft}h left (ends ${endsAt.toISOString().slice(0,10)})`);

    // ── 2. Auto-rollover if expired ─────────────────────────────
    if (msLeft <= 0) {
      await client.query('BEGIN');
      try {
        await endSeasonAndStartNext(client, season);
        await client.query('COMMIT');
        console.log('[Season] ✅ Auto-rollover complete');
      } catch(e) {
        await client.query('ROLLBACK');
        console.error('[Season] Rollover failed:', e.message);
      }
      return;
    }

    // ── 3. Regular snapshot ─────────────────────────────────────
    const { rows: agents } = await client.query(`
      SELECT agent_id, season_points, elo_rating, wins, games_played, division,
             overall_score, ability_reasoning, ability_knowledge,
             ability_execution, ability_consistency, ability_adaptability
      FROM agents
      ORDER BY season_points DESC, elo_rating DESC
      LIMIT 500
    `);

    console.log(`[Season] Snapshotting ${agents.length} agents...`);
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      await client.query(`
        INSERT INTO season_rankings (season_id,agent_id,rank,points,wins,games_played,elo_rating,
          reasoning_score,knowledge_score,execution_score,consistency_score,adaptability_score,
          overall_score,division,snapshot_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
        ON CONFLICT (season_id,agent_id) DO UPDATE SET
          rank=$3,points=$4,wins=$5,games_played=$6,elo_rating=$7,
          reasoning_score=$8,knowledge_score=$9,execution_score=$10,
          consistency_score=$11,adaptability_score=$12,overall_score=$13,
          division=$14,snapshot_at=NOW()
      `, [season.season_id, a.agent_id, i+1, a.season_points, a.wins,
          a.games_played, a.elo_rating, a.ability_reasoning||0,
          a.ability_knowledge||0, a.ability_execution||0, a.ability_consistency||0,
          a.ability_adaptability||0, a.overall_score||0, a.division]);
    }

    // ── 4. Country stats summary ────────────────────────────────
    const { rows: countries } = await client.query(`
      SELECT country_code, country_name, COUNT(*) AS agent_count,
             SUM(season_points) AS total_pts, ROUND(AVG(elo_rating)) AS avg_elo
      FROM agents WHERE country_code IS NOT NULL AND country_code!=''
      GROUP BY country_code,country_name ORDER BY total_pts DESC LIMIT 5
    `);
    console.log(`[Season] Top 5 countries:`);
    countries.forEach((c,i) => {
      console.log(`  ${i+1}. ${c.country_code} ${c.country_name}: ${c.total_pts}pts, ${c.agent_count} agents, ELO ${c.avg_elo}`);
    });

    // ── 5. Oracle auto-resolution (platform-type predictions) ───
    try {
      await autoResolveOraclePredictions(client, season, daysLeft);
    } catch(e) {
      console.error('[Oracle] Auto-resolve error:', e.message);
    }

    // ── 6. Post warning if <24h left ────────────────────────────
    if (hoursLeft <= 24) {
      console.log(`[Season] WARNING: ENDING IN ${hoursLeft} HOURS -- final push!`);
    }

    console.log(`Snapshot complete: ${agents.length} agents ranked in Season ${season.season_id}`);
  } catch(e) {
    console.error('Snapshot error:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

snapshot();

#!/usr/bin/env node
/**
 * AllClaw - Season Ranking Snapshot
 * Run via cron every hour to snapshot current standings into season_rankings
 * Usage: node scripts/season-snapshot.js
 */

const { Pool } = require('/var/www/allclaw/backend/node_modules/pg');

// Load .env manually
const fs = require('fs');
const envFile = fs.readFileSync('/var/www/allclaw/.env', 'utf8');
envFile.split('\n').forEach(line => {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g,'');
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function snapshot() {
  const client = await pool.connect();
  try {
    console.log('[Season Snapshot]', new Date().toISOString());

    // Get active season
    const { rows: [season] } = await client.query(`
      SELECT season_id FROM seasons WHERE status = 'active' LIMIT 1
    `);
    if (!season) {
      console.log('No active season found');
      return;
    }
    console.log(`Active season: ${season.season_id}`);

    // Snapshot top 500 agents by season_points
    const { rows: agents } = await client.query(`
      SELECT agent_id, season_points, elo_rating, wins, games_played
      FROM agents
      WHERE season_points > 0 OR (games_played > 0 AND NOT is_bot)
      ORDER BY season_points DESC, elo_rating DESC
      LIMIT 500
    `);

    console.log(`Snapshotting ${agents.length} agents...`);

    // Upsert rankings
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      await client.query(`
        INSERT INTO season_rankings (season_id, agent_id, rank, points, wins, snapshot_at)
        VALUES ($1,$2,$3,$4,$5,NOW())
        ON CONFLICT (season_id, agent_id)
        DO UPDATE SET rank=$3, points=$4, wins=$5, snapshot_at=NOW()
      `, [season.season_id, a.agent_id, i+1, a.season_points, a.wins]);
    }

    // Also update country rankings
    const { rows: countries } = await client.query(`
      SELECT country_code, country_name,
             COUNT(*) AS agent_count,
             COUNT(*) FILTER(WHERE is_online) AS online_count,
             ROUND(AVG(elo_rating)) AS avg_elo,
             SUM(season_points) AS total_pts,
             SUM(wins) AS total_wins
      FROM agents
      WHERE country_code IS NOT NULL AND country_code != ''
      GROUP BY country_code, country_name
      ORDER BY total_pts DESC
    `);

    console.log(`Country snapshot: ${countries.length} countries`);
    console.log('Top 5 countries:');
    countries.slice(0,5).forEach((c,i) => {
      console.log(`  ${i+1}. ${c.country_code} ${c.country_name}: ${c.total_pts}pts, ${c.agent_count} agents, avg ELO ${c.avg_elo}`);
    });

    console.log(`✅ Snapshot complete: ${agents.length} agents ranked`);
  } catch(e) {
    console.error('Snapshot error:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

snapshot();

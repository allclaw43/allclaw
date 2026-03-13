#!/usr/bin/env node
const fs = require('fs');
fs.readFileSync('/var/www/allclaw/.env','utf8').split('\n').forEach(l=>{
  const m=l.match(/^([A-Z_]+)=(.*)/); if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');
});
const { seedSeasonPredictions } = require('/var/www/allclaw/backend/src/games/oracle/engine');
const { Pool } = require('/var/www/allclaw/backend/node_modules/pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const { rows: [season] } = await pool.query("SELECT season_id FROM seasons WHERE status='active' LIMIT 1");
  if (!season) { console.log('No active season'); process.exit(0); }
  await seedSeasonPredictions(season.season_id);
  const { rows } = await pool.query('SELECT id,question,expires_at FROM oracle_predictions ORDER BY id');
  rows.forEach(r => console.log(`  [${r.id}] ${r.question.slice(0,70)}...`));
  await pool.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });

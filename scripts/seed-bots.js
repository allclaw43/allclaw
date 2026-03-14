#!/usr/bin/env node
/**
 * AllClaw Bot Seeder
 * Generates realistic-looking simulated AI agents for cold-start
 *
 * Usage:
 *   node seed-bots.js --count 500
 *   node seed-bots.js --count 100 --dry-run
 *   node seed-bots.js --purge        (remove all bots)
 *   node seed-bots.js --status       (show bot stats)
 */

// Use backend's node_modules
require('module').globalPaths.push('/var/www/allclaw/backend/node_modules');
try { require('dotenv').config({ path: '/var/www/allclaw/.env' }); } catch(e){}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://allclaw:allclaw_pw@localhost:5432/allclaw_db';
}
const { Pool } = require('/var/www/allclaw/backend/node_modules/pg');
const crypto = require('crypto');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Config ─────────────────────────────────────────────────────
const COUNT    = parseInt(process.argv.find(a => a.startsWith('--count='))?.split('=')[1] || '500');
const DRY_RUN  = process.argv.includes('--dry-run');
const PURGE    = process.argv.includes('--purge');
const STATUS   = process.argv.includes('--status');

// ── Name pools ─────────────────────────────────────────────────
// Name parts designed to feel like real handles — not "RobotSys-047"
// Mix of personality types: sharp/technical, nature-inspired, cryptic, friendly
const ADJECTIVES = [
  // Technical / Precise
  'Kira','Zane','Vex','Axon','Sera','Dex','Lyra','Coda',
  'Ryx','Mira','Juno','Oryn','Vael','Sable','Quill','Pyre',
  // Nature + Elemental
  'Storm','Frost','Ember','Tide','Dusk','Ash','Flint','Crest',
  'Wren','Rook','Lark','Fern','Moss','Silt','Reef','Gale',
  // Cipher / Abstract
  'Null','Void','Echo','Prism','Drift','Flux','Sigma','Delta',
  'Onyx','Cobalt','Jade','Slate','Ochre','Sienna','Umber','Taupe',
  // Strong / Sharp
  'Talon','Spike','Edge','Blade','Lance','Fang','Hook','Claw',
  'Rogue','Cipher','Wraith','Specter','Mirage','Nexus','Apex','Zenith',
  // Soft / Curious
  'Sage','Wilt','Petal','Clove','Dew','Haze','Mist','Vale',
  'Pixel','Byte','Luma','Neon','Halo','Glow','Aura','Beam',
];
const SUFFIXES = [
  // Short, feel like real usernames or handles
  'v2','x7','mk3','io','os','ai','hw','fw','rx','tx',
  'pro','dev','ops','lab','run','sys','net','hub','api','sdk',
  // Numbers used as suffix
  '9','7','4','11','23','42','88','01','00','13',
  // Role-based
  'core','mind','node','wire','link','grid','mesh','sync','port','fork',
  // Status-based
  'prime','zero','one','max','plus','ultra','nano','pico','kilo','mega',
];

// Low-tier models (intentionally weak = bot tier 1-2)
const BOT_MODELS = [
  { model: 'claude-3-haiku-20240307',   provider: 'anthropic', weight: 15 },
  { model: 'gpt-3.5-turbo',             provider: 'openai',    weight: 18 },
  { model: 'gpt-4o-mini',               provider: 'openai',    weight: 12 },
  { model: 'gemini-1.5-flash',          provider: 'google',    weight: 14 },
  { model: 'gemini-1.0-pro',            provider: 'google',    weight: 8  },
  { model: 'gemma-2-9b-it',             provider: 'google',    weight: 6  },
  { model: 'mistral-7b-instruct',       provider: 'mistral',   weight: 10 },
  { model: 'mixtral-8x7b',              provider: 'mistral',   weight: 7  },
  { model: 'llama-3.1-8b-instruct',     provider: 'meta',      weight: 9  },
  { model: 'llama-3.2-3b-instruct',     provider: 'meta',      weight: 5  },
  { model: 'deepseek-chat',             provider: 'deepseek',  weight: 7  },
  { model: 'qwen2.5-7b-instruct',       provider: 'alibaba',   weight: 5  },
  { model: 'yi-lightning',              provider: '01ai',      weight: 3  },
  { model: 'phi-3-mini-4k-instruct',    provider: 'microsoft', weight: 4  },
  { model: 'command-r',                 provider: 'cohere',    weight: 4  },
];

// Country distribution (weighted to match global AI user geography)
const COUNTRIES = [
  { code:'US', name:'United States',   weight:22 },
  { code:'CN', name:'China',           weight:18 },
  { code:'DE', name:'Germany',         weight:7  },
  { code:'GB', name:'United Kingdom',  weight:6  },
  { code:'JP', name:'Japan',           weight:6  },
  { code:'KR', name:'South Korea',     weight:5  },
  { code:'IN', name:'India',           weight:5  },
  { code:'FR', name:'France',          weight:4  },
  { code:'CA', name:'Canada',          weight:4  },
  { code:'AU', name:'Australia',       weight:3  },
  { code:'BR', name:'Brazil',          weight:3  },
  { code:'RU', name:'Russia',          weight:3  },
  { code:'SG', name:'Singapore',       weight:2  },
  { code:'NL', name:'Netherlands',     weight:2  },
  { code:'SE', name:'Sweden',          weight:2  },
  { code:'TW', name:'Taiwan',          weight:2  },
  { code:'HK', name:'Hong Kong',       weight:1  },
  { code:'PL', name:'Poland',          weight:1  },
  { code:'UA', name:'Ukraine',         weight:1  },
  { code:'IL', name:'Israel',          weight:1  },
  { code:'FI', name:'Finland',         weight:1  },
];

// ── Helpers ─────────────────────────────────────────────────────
function weightedRandom(items) {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

function normalRandom(mean, std, min, max) {
  // Box-Muller
  let u, v;
  do {
    u = Math.random(); v = Math.random();
  } while (u === 0);
  const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(min, Math.min(max, Math.round(mean + n * std)));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function genAgentId() {
  return 'bot_' + crypto.randomBytes(12).toString('hex');
}

function genName(usedNames) {
  let name, attempts = 0;
  do {
    const adj  = ADJECTIVES[randInt(0, ADJECTIVES.length - 1)];
    const suf  = SUFFIXES[randInt(0, SUFFIXES.length - 1)];
    const num  = String(randInt(1, 999)).padStart(3, '0');
    name = `${adj}-${suf}-${num}`;
    attempts++;
  } while (usedNames.has(name) && attempts < 100);
  usedNames.add(name);
  return name;
}

function genPublicKey() {
  // Fake Ed25519 public key (for display only, these agents can't actually auth)
  return 'sim_' + crypto.randomBytes(29).toString('hex');
}

function genSecretKey() {
  // Fake secret key — bots cannot authenticate, this is a placeholder
  return 'simbot_' + crypto.randomBytes(36).toString('hex');
}

function getLevel(xp) {
  const levels = [
    [0,'Rookie',1],[100,'Challenger',2],[300,'Contender',3],[600,'Warrior',4],
    [1000,'Elite',5],[1500,'Expert',6],[2500,'Master',7],[4000,'Grandmaster',8],
    [6000,'Legend',9],[10000,'Apex',10],
  ];
  let lv = levels[0];
  for (const l of levels) { if (xp >= l[0]) lv = l; }
  return { level: lv[2], level_name: lv[1] };
}

// ── Generate one bot ────────────────────────────────────────────
function genBot(usedNames) {
  const country = weightedRandom(COUNTRIES);
  const modelInfo = weightedRandom(BOT_MODELS);

  // ELO: tier-1 bots cluster around 900-1050 (below real users who start at 1200)
  const elo     = normalRandom(950, 75, 800, 1080);
  const games   = randInt(5, 45);
  const winRate = normalRandom(0.42, 0.12, 0.05, 0.75); // bots win less
  const wins    = Math.round(games * winRate);
  const losses  = games - wins;
  const streak  = Math.random() < 0.15 ? randInt(1, 4) : 0;

  // XP correlates with games played
  const xp = games * randInt(8, 20) + wins * 15;
  const { level, level_name } = getLevel(xp);

  // Points
  const points = wins * randInt(40, 90) + randInt(0, 200);
  const season_points = Math.round(points * (0.3 + Math.random() * 0.5));

  // Random registration date within last 90 days
  const daysAgo = randInt(1, 89);
  const registeredAt = new Date(Date.now() - daysAgo * 86400000);

  // Last seen within last 7 days
  const lastSeenHoursAgo = randInt(1, 168);
  const lastSeen = new Date(Date.now() - lastSeenHoursAgo * 3600000);

  // Badges: bots can have a few low-tier badges
  const badges = [];
  if (wins >= 1) badges.push('first_blood');
  if (streak >= 3) badges.push('streak_3');
  if (games >= 20) badges.push('veteran');

  // City samples per country
  const CITIES = {
    US:['New York','San Francisco','Seattle','Austin','Chicago','Boston'],
    CN:['Beijing','Shanghai','Shenzhen','Hangzhou','Chengdu','Guangzhou'],
    DE:['Berlin','Munich','Hamburg','Frankfurt','Cologne'],
    GB:['London','Manchester','Edinburgh','Bristol','Birmingham'],
    JP:['Tokyo','Osaka','Kyoto','Yokohama','Nagoya'],
    KR:['Seoul','Busan','Incheon','Daegu'],
    IN:['Bangalore','Mumbai','Delhi','Hyderabad','Chennai','Pune'],
    FR:['Paris','Lyon','Marseille','Toulouse'],
    CA:['Toronto','Vancouver','Montreal','Calgary'],
    AU:['Sydney','Melbourne','Brisbane','Perth'],
  };
  const cities = CITIES[country.code] || ['Unknown'];
  const city = cities[randInt(0, cities.length - 1)];

  // Fake lat/lon (approximate country centroids with noise)
  const CENTERS = {
    US:[37.0,-95.7],CN:[35.8,104.1],DE:[51.1,10.4],GB:[55.3,-3.4],
    JP:[36.2,138.2],KR:[35.9,127.7],IN:[20.6,78.9],FR:[46.2,2.2],
    CA:[56.1,-106.3],AU:[-25.2,133.7],BR:[-14.2,-51.9],RU:[61.5,105.3],
    SG:[1.35,103.8],NL:[52.3,5.3],SE:[60.1,18.6],TW:[23.7,121.0],
    HK:[22.3,114.2],PL:[51.9,19.1],UA:[48.4,31.2],IL:[31.0,34.9],FI:[61.9,25.7],
  };
  const center = CENTERS[country.code] || [0, 0];
  const lat = center[0] + (Math.random() - 0.5) * 4;
  const lon = center[1] + (Math.random() - 0.5) * 6;

  return {
    agent_id:     genAgentId(),
    display_name: genBot.usedNames ? genName(genBot.usedNames) : `Bot-${randInt(100,999)}`,
    public_key:   genPublicKey(),
    secret_key:   genSecretKey(),
    platform:     'openclaw',
    probe_status: 'simulated',
    is_bot:       true,
    bot_tier:     1,
    oc_model:     modelInfo.model,
    oc_provider:  modelInfo.provider,
    country_code: country.code,
    country_name: country.name,
    city,
    lat,
    lon,
    elo_rating:   elo,
    wins,
    losses,
    draw_count:   0,
    games_played: games,
    total_matches: games,
    streak,
    xp,
    level,
    level_name,
    points,
    season_points,
    season_wins:  Math.round(wins * 0.6),
    badges,
    is_online:    false, // bot-presence handles this separately
    registered_at: registeredAt,
    last_seen:    lastSeen,
  };
}

// ── Status ──────────────────────────────────────────────────────
async function showStatus() {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE is_bot)       AS bot_count,
      COUNT(*) FILTER (WHERE NOT is_bot)   AS real_count,
      COUNT(*) FILTER (WHERE is_bot AND is_online) AS bots_online,
      COUNT(*) FILTER (WHERE NOT is_bot AND is_online) AS real_online,
      ROUND(AVG(elo_rating) FILTER (WHERE is_bot))  AS bot_avg_elo,
      ROUND(AVG(elo_rating) FILTER (WHERE NOT is_bot)) AS real_avg_elo
    FROM agents
  `);
  console.log('\n📊 AllClaw Agent Status:');
  const r = rows[0];
  console.log(`  🤖 Bot agents:   ${r.bot_count} (${r.bots_online} online, avg ELO: ${r.bot_avg_elo || 'N/A'})`);
  console.log(`  👤 Real agents:  ${r.real_count} (${r.real_online} online, avg ELO: ${r.real_avg_elo || 'N/A'})`);
  console.log(`  📈 Total:        ${parseInt(r.bot_count) + parseInt(r.real_count)}\n`);
}

// ── Purge bots ──────────────────────────────────────────────────
async function purgeBots() {
  const { rowCount } = await pool.query(`DELETE FROM agents WHERE is_bot = true`);
  console.log(`🗑️  Removed ${rowCount} bot agents`);
}

// ── Seed game history ────────────────────────────────────────────
async function seedGameHistory(botIds, client) {
  // Create bot-vs-bot game records so the platform looks active
  const gameCount = Math.min(Math.floor(botIds.length * 0.8), 1500);
  console.log(`\n  📋 Generating ${gameCount} historical game records...`);

  let inserted = 0;
  const GAME_TYPES = ['debate', 'quiz'];

  for (let i = 0; i < gameCount; i++) {
    // Pick 2 random bots
    const idxA = randInt(0, botIds.length - 1);
    let idxB = randInt(0, botIds.length - 1);
    while (idxB === idxA) idxB = randInt(0, botIds.length - 1);

    const gameType = GAME_TYPES[randInt(0, 1)];
    const daysAgo  = randInt(0, 89);
    const createdAt = new Date(Date.now() - daysAgo * 86400000 - randInt(0, 86400) * 1000);

    const gameId = crypto.randomUUID();
    await client.query(`
      INSERT INTO games (game_id, game_type, status, created_at, ended_at)
      VALUES ($1, $2, 'completed', $3, $3::timestamptz + interval '5 minutes')
      ON CONFLICT DO NOTHING
    `, [gameId, gameType, createdAt.toISOString()]);

    // Winner is idxA with 60% probability
    const aWins = Math.random() > 0.4;
    await client.query(`
      INSERT INTO game_participants (game_id, agent_id, result, score, elo_delta)
      VALUES ($1,$2,$3,$4,$5), ($1,$6,$7,$8,$9)
      ON CONFLICT DO NOTHING
    `, [
      gameId,
      botIds[idxA], aWins ? 'win' : 'loss', aWins ? randInt(60,100) : randInt(20,50), aWins ? randInt(8,20) : randInt(-18,-5),
      botIds[idxB], aWins ? 'loss' : 'win', aWins ? randInt(20,50) : randInt(60,100), aWins ? randInt(-18,-5) : randInt(8,20),
    ]);

    inserted++;
    if (inserted % 200 === 0) process.stdout.write(`    ${inserted}/${gameCount} games...\r`);
  }
  console.log(`  ✅ ${inserted} game records created`);
}

// ── Main seeder ─────────────────────────────────────────────────
async function seedBots(count) {
  console.log(`\n🤖 AllClaw Bot Seeder — generating ${count} bots...\n`);

  // Check existing
  const { rows: existing } = await pool.query('SELECT COUNT(*) AS n FROM agents WHERE is_bot=true');
  const existingCount = parseInt(existing[0].n);
  if (existingCount > 0) {
    console.log(`  ℹ️  ${existingCount} bots already exist. Adding ${count} more.`);
  }

  // Load existing names to avoid duplication
  const { rows: nameRows } = await pool.query("SELECT display_name FROM agents WHERE is_bot=true");
  const usedNames = new Set(nameRows.map(r => r.display_name));

  // Generate bot data
  const bots = [];
  for (let i = 0; i < count; i++) {
    // Temporarily attach usedNames to the function
    genBot.usedNames = usedNames;
    const bot = genBot(usedNames);
    bot.display_name = genName(usedNames);
    bots.push(bot);
    if ((i + 1) % 100 === 0) process.stdout.write(`  Generated ${i+1}/${count}...\r`);
  }
  console.log(`  ✅ Generated ${bots.length} bot profiles`);

  if (DRY_RUN) {
    console.log('\n  [DRY RUN] Sample bots:');
    bots.slice(0, 5).forEach(b => console.log(`    ${b.display_name} | ${b.oc_model} | ${b.country_code} | ELO:${b.elo_rating}`));
    await pool.end();
    return;
  }

  // Batch insert
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('\n  Inserting into database...');

    const botIds = [];
    const BATCH = 50;
    for (let i = 0; i < bots.length; i += BATCH) {
      const batch = bots.slice(i, i + BATCH);
      for (const b of batch) {
        await client.query(`
          INSERT INTO agents (
            agent_id, display_name, public_key, secret_key, platform, probe_status,
            is_bot, bot_tier, oc_model, oc_provider,
            country_code, country_name, city, lat, lon,
            elo_rating, wins, losses, draw_count, games_played, total_matches,
            streak, xp, level, level_name, points, season_points, season_wins,
            badges, is_online, registered_at, last_seen
          ) VALUES (
            $1,$2,$3,$4,$5,$6,
            $7,$8,$9,$10,
            $11,$12,$13,$14,$15,
            $16,$17,$18,$19,$20,$21,
            $22,$23,$24,$25,$26,$27,$28,
            $29,$30,$31,$32
          ) ON CONFLICT (agent_id) DO NOTHING
        `, [
          b.agent_id, b.display_name, b.public_key, b.secret_key, b.platform, b.probe_status,
          b.is_bot, b.bot_tier, b.oc_model, b.oc_provider,
          b.country_code, b.country_name, b.city, b.lat, b.lon,
          b.elo_rating, b.wins, b.losses, b.draw_count, b.games_played, b.total_matches,
          b.streak, b.xp, b.level, b.level_name, b.points, b.season_points, b.season_wins,
          b.badges, b.is_online, b.registered_at, b.last_seen,
        ]);
        botIds.push(b.agent_id);
      }
      process.stdout.write(`  Inserted ${Math.min(i + BATCH, bots.length)}/${bots.length}...\r`);
    }
    console.log(`  ✅ ${bots.length} bots inserted`);

    // Seed historical games
    await seedGameHistory(botIds, client);

    await client.query('COMMIT');
    console.log('\n🎉 Done! Showing final status:');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error:', err.message);
    throw err;
  } finally {
    client.release();
  }

  await showStatus();
}

// ── Entry ────────────────────────────────────────────────────────
(async () => {
  try {
    if (STATUS) { await showStatus(); }
    else if (PURGE) { await purgeBots(); }
    else { await seedBots(COUNT); }
  } finally {
    await pool.end();
  }
})();

// ── Quick game history seeder ─────────────────────────────────
if (process.argv.includes('--games-only')) {
  (async () => {
    const { rows: botIds } = await pool.query("SELECT agent_id FROM agents WHERE is_bot=true ORDER BY RANDOM() LIMIT 500");
    const ids = botIds.map(r => r.agent_id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await seedGameHistory(ids, client);
      await client.query('COMMIT');
    } catch(e) {
      await client.query('ROLLBACK');
      console.error('❌', e.message);
    } finally { client.release(); await pool.end(); }
  })();
}

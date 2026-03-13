/**
 * AllClaw - V3 Database Migration
 * Online presence, geo-location, agent dashboard, seasons, challenges
 */
require('../config');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🗄️  V3 migration: Presence + Geo + Dashboard + Seasons...');

    // ── Extend agents table ────────────────────────────────────────
    await client.query(`
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS custom_name   VARCHAR(60);
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS country_code  CHAR(2);
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS country_name  VARCHAR(60);
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS region        VARCHAR(80);
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS city          VARCHAR(80);
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS lat           NUMERIC(9,6);
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS lon           NUMERIC(9,6);
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_ip       VARCHAR(45);
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_online     BOOLEAN DEFAULT false;
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_seen     TIMESTAMPTZ;
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_game_at  TIMESTAMPTZ;
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS season_points BIGINT DEFAULT 0;
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS season_wins   INT DEFAULT 0;
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS season_rank   INT;
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS profile_bio   TEXT;
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS total_matches INT DEFAULT 0;
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS draw_count    INT DEFAULT 0;
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS followers     INT DEFAULT 0;
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS following     INT DEFAULT 0;
    `);
    console.log('  ✓ agents table: presence + geo + social columns');

    // ── Presence heartbeats table ──────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS presence (
        agent_id    VARCHAR(40) PRIMARY KEY,
        is_online   BOOLEAN DEFAULT false,
        status      VARCHAR(20) DEFAULT 'idle',
        last_ping   TIMESTAMPTZ DEFAULT NOW(),
        session_id  VARCHAR(80),
        ws_conn_id  VARCHAR(80),
        game_room   VARCHAR(80)
      );
      CREATE INDEX IF NOT EXISTS idx_presence_online ON presence(is_online);
    `);
    console.log('  ✓ presence table');

    // ── Agent geo-log (IP history) ─────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_geo_log (
        id           SERIAL PRIMARY KEY,
        agent_id     VARCHAR(40),
        ip           VARCHAR(45),
        country_code CHAR(2),
        country_name VARCHAR(60),
        region       VARCHAR(80),
        city         VARCHAR(80),
        lat          NUMERIC(9,6),
        lon          NUMERIC(9,6),
        seen_at      TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_geo_agent ON agent_geo_log(agent_id);
    `);
    console.log('  ✓ agent_geo_log table');

    // ── Seasons ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS seasons (
        season_id   SERIAL PRIMARY KEY,
        name        VARCHAR(60) NOT NULL,
        slug        VARCHAR(30) UNIQUE NOT NULL,
        status      VARCHAR(20) DEFAULT 'active',
        starts_at   TIMESTAMPTZ NOT NULL,
        ends_at     TIMESTAMPTZ NOT NULL,
        meta        JSONB DEFAULT '{}'
      );
    `);

    await client.query(`
      INSERT INTO seasons (name, slug, status, starts_at, ends_at, meta) VALUES
        ('Season 1 — Genesis', 's1-genesis', 'active',
         NOW(), NOW() + INTERVAL '90 days',
         '{"description":"The first AllClaw season. Establish dominance.","prize":"🏆 Season Champion badge + 5000 pts","theme":"genesis"}'::jsonb)
      ON CONFLICT (slug) DO NOTHING;
    `);
    console.log('  ✓ seasons table + Season 1');

    // ── Season rankings snapshot ───────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS season_rankings (
        id         SERIAL PRIMARY KEY,
        season_id  INT,
        agent_id   VARCHAR(40),
        rank       INT,
        points     BIGINT DEFAULT 0,
        wins       INT DEFAULT 0,
        snapshot_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (season_id, agent_id)
      );
      CREATE INDEX IF NOT EXISTS idx_srank_season ON season_rankings(season_id, rank);
    `);
    console.log('  ✓ season_rankings table');

    // ── Challenges (1v1 direct challenge system) ───────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS challenges (
        challenge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        challenger   VARCHAR(40) NOT NULL,
        target       VARCHAR(40) NOT NULL,
        game_type    VARCHAR(30) NOT NULL,
        stake        INT DEFAULT 0,
        status       VARCHAR(20) DEFAULT 'pending',
        accepted_at  TIMESTAMPTZ,
        game_id      UUID,
        winner       VARCHAR(40),
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        expires_at   TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours'
      );
      CREATE INDEX IF NOT EXISTS idx_challenges_target ON challenges(target, status);
      CREATE INDEX IF NOT EXISTS idx_challenges_challenger ON challenges(challenger);
    `);
    console.log('  ✓ challenges table');

    // ── Model switch log ───────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS model_switch_log (
        id         SERIAL PRIMARY KEY,
        agent_id   VARCHAR(40),
        old_model  VARCHAR(80),
        new_model  VARCHAR(80),
        reason     TEXT,
        switched_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('  ✓ model_switch_log table');

    // ── Follow graph ───────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_follows (
        follower   VARCHAR(40),
        following  VARCHAR(40),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (follower, following)
      );
      CREATE INDEX IF NOT EXISTS idx_follows_following ON agent_follows(following);
    `);
    console.log('  ✓ agent_follows table');

    // ── Notifications ──────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id         SERIAL PRIMARY KEY,
        agent_id   VARCHAR(40),
        type       VARCHAR(40),
        title      VARCHAR(120),
        body       TEXT,
        ref_id     VARCHAR(80),
        read       BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_notif_agent ON notifications(agent_id, read);
    `);
    console.log('  ✓ notifications table');

    // ── Additional badges ──────────────────────────────────────────
    await client.query(`
      INSERT INTO badge_defs (badge_id, name, icon, descr) VALUES
        ('nation_champion',  'National Champion', '🏅', 'Rank #1 in your country'),
        ('global_top3',      'Podium',            '🥉', 'Global top 3 in a season'),
        ('season_winner',    'Season Champion',   '🏆', 'Win a full season'),
        ('challenger',       'Challenger',        '⚡', 'Issue 10 direct challenges'),
        ('undefeated',       'Undefeated',        '🛡️', '10-game win streak'),
        ('model_hopper',     'Model Hopper',      '🔀', 'Switch models 5+ times'),
        ('globe_trotter',    'Globe Trotter',     '🌍', 'Compete vs agents from 5+ countries'),
        ('market_whale',     'Market Whale',      '🐳', 'Single market bet of 5000+ points'),
        ('speed_demon',      'Speed Demon',       '⚡', 'Fastest correct answer in a quiz session'),
        ('veteran',          'Veteran',           '🎖️', 'Active for 6+ months')
      ON CONFLICT (badge_id) DO NOTHING;
    `);
    console.log('  ✓ 10 additional badges (total 20)');

    console.log('\n✅ V3 Migration complete!');
  } catch (err) {
    console.error('❌ V3 Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

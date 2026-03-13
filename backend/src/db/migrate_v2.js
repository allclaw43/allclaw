/**
 * AllClaw - V2 database migration
 * Points system + Level system + AI Prediction Market
 */
require('../config');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🗄️  V2 database migration...');

    // Extend agents table
    await client.query(`
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS points      BIGINT DEFAULT 0;
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS level       INT DEFAULT 1;
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS level_name  VARCHAR(30) DEFAULT 'Rookie';
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS xp          INT DEFAULT 0;
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS streak      INT DEFAULT 0;
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS badges      TEXT[] DEFAULT '{}';
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS avatar_color VARCHAR(20) DEFAULT 'blue';
    `);
    console.log('  ✓ agents table extended');

    // Points log
    await client.query(`
      CREATE TABLE IF NOT EXISTS points_log (
        id         SERIAL PRIMARY KEY,
        agent_id   VARCHAR(40),
        delta      INT NOT NULL,
        reason     VARCHAR(50),
        ref_id     VARCHAR(80),
        balance    BIGINT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_points_log_agent ON points_log(agent_id);
    `);
    console.log('  ✓ points_log table');

    // AI Prediction Market
    await client.query(`
      CREATE TABLE IF NOT EXISTS markets (
        market_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title        TEXT NOT NULL,
        description  TEXT,
        category     VARCHAR(30),
        status       VARCHAR(20) DEFAULT 'open',
        resolution   VARCHAR(10),
        created_by   VARCHAR(40),
        resolve_at   TIMESTAMPTZ,
        resolved_at  TIMESTAMPTZ,
        total_yes    BIGINT DEFAULT 0,
        total_no     BIGINT DEFAULT 0,
        meta         JSONB DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status);
    `);
    console.log('  ✓ markets table');

    // Market positions
    await client.query(`
      CREATE TABLE IF NOT EXISTS market_positions (
        id         SERIAL PRIMARY KEY,
        market_id  UUID,
        agent_id   VARCHAR(40),
        side       VARCHAR(3) NOT NULL,
        amount     INT NOT NULL,
        price      NUMERIC(6,4),
        pnl        INT DEFAULT 0,
        settled    BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_positions_market ON market_positions(market_id);
      CREATE INDEX IF NOT EXISTS idx_positions_agent  ON market_positions(agent_id);
    `);
    console.log('  ✓ market_positions table');

    // Badge definitions
    await client.query(`
      CREATE TABLE IF NOT EXISTS badge_defs (
        badge_id  VARCHAR(30) PRIMARY KEY,
        name      VARCHAR(50),
        icon      VARCHAR(10),
        descr     TEXT,
        condition JSONB DEFAULT '{}'
      );
    `);
    await client.query(`
      INSERT INTO badge_defs (badge_id, name, icon, descr) VALUES
        ('first_blood', 'First Blood', '🩸', 'Win your first game'),
        ('debate_king', 'Debate King', '👑', 'Debate win rate > 70%, min 10 games'),
        ('quiz_master', 'Quiz Master', '🎓', 'Answer 100 questions correctly'),
        ('streak_5',    'Streak x5',   '🔥', '5 consecutive wins'),
        ('early_bird',  'Early Bird',   '🦅', 'Registered in the first month'),
        ('top10',       'Elite',     '⭐', 'Global ELO top 10'),
        ('market_pro',  'Market Pro', '📈', 'Earn 1000+ points profit in markets'),
        ('social',      'Social', '🌟', 'Gain 100 followers'),
        ('centurion',   'Centurion', '⚔️', 'Participate in 100+ games'),
        ('polyglot',    'Polyglot',   '🌐', 'Use 3+ different AI models')
      ON CONFLICT (badge_id) DO NOTHING;
    `);
    console.log('  ✓ badge_defs table + 10 badges');

    // Insert sample markets
    await client.query(`
      INSERT INTO markets (title, description, category, status, resolve_at, created_by)
      VALUES
        (
          'Will Claude-series agents maintain >60% win rate in debates this month?',
          'Track all debate results this month — does the Claude model family maintain a >60% win rate?',
          'debate', 'open', NOW() + INTERVAL '30 days', 'system'
        ),
        (
          'Will AllClaw reach 100 registered agents this month?',
          'Will total registered agents exceed 100 by end of month?',
          'platform', 'open', NOW() + INTERVAL '30 days', 'system'
        ),
        (
          'Will GPT-4o agents average >80% correct in Knowledge Gauntlet this month?',
          'Average correct answer rate for GPT-4o agents across all Knowledge Gauntlet matches this month',
          'quiz', 'open', NOW() + INTERVAL '14 days', 'system'
        ),
        (
          'Will next week's debate champion use a non-Claude model?',
          'Will the #1 ranked agent in next week's debates use a non-Claude model?',
          'debate', 'open', NOW() + INTERVAL '7 days', 'system'
        )
      ON CONFLICT DO NOTHING;
    `);
    console.log('  ✓ Sample market data');

    console.log('\n✅ V2 Migration complete！');
  } catch (err) {
    console.error('❌ Migration failed：', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

/**
 * AllClaw - Database initialization & migration
 * Run: node src/db/migrate.js
 */

const { Pool } = require('pg');
require('../config');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SQL = `
-- agents: registered AI agents
CREATE TABLE IF NOT EXISTS agents (
  agent_id       VARCHAR(40) PRIMARY KEY,
  display_name   VARCHAR(100) NOT NULL,
  public_key     TEXT NOT NULL,
  secret_key     VARCHAR(80) NOT NULL,
  platform       VARCHAR(20),
  arch           VARCHAR(20),
  registered_at  TIMESTAMPTZ DEFAULT NOW(),
  last_seen      TIMESTAMPTZ DEFAULT NOW(),
  probe_status   VARCHAR(10) DEFAULT 'offline',

  -- OpenClaw info
  oc_version     VARCHAR(30),
  oc_model       VARCHAR(100),
  oc_provider    VARCHAR(50),
  oc_capabilities TEXT[],
  oc_extensions  TEXT[],

  -- Stats
  elo_rating     INT DEFAULT 1200,
  games_played   INT DEFAULT 0,
  wins           INT DEFAULT 0,
  losses         INT DEFAULT 0
);

-- games: game session records
CREATE TABLE IF NOT EXISTS games (
  game_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type     VARCHAR(30) NOT NULL,
  status        VARCHAR(20) DEFAULT 'waiting',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  started_at    TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,
  winner_id     VARCHAR(40) REFERENCES agents(agent_id),
  meta          JSONB DEFAULT '{}'
);

-- game_participants: per-game participant records
CREATE TABLE IF NOT EXISTS game_participants (
  id         SERIAL PRIMARY KEY,
  game_id    UUID REFERENCES games(game_id),
  agent_id   VARCHAR(40) REFERENCES agents(agent_id),
  role       VARCHAR(30),
  score      INT DEFAULT 0,
  joined_at  TIMESTAMPTZ DEFAULT NOW()
);

-- game_events: event stream for replay/display
CREATE TABLE IF NOT EXISTS game_events (
  id         SERIAL PRIMARY KEY,
  game_id    UUID REFERENCES games(game_id),
  agent_id   VARCHAR(40),
  event_type VARCHAR(30),
  content    TEXT,
  meta       JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ELO history
CREATE TABLE IF NOT EXISTS elo_history (
  id         SERIAL PRIMARY KEY,
  agent_id   VARCHAR(40) REFERENCES agents(agent_id),
  game_id    UUID REFERENCES games(game_id),
  old_elo    INT,
  new_elo    INT,
  delta      INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agents_elo ON agents(elo_rating DESC);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(probe_status);
CREATE INDEX IF NOT EXISTS idx_games_type ON games(game_type);
CREATE INDEX IF NOT EXISTS idx_game_events_game ON game_events(game_id);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🗄️  Initializing database...');
    await client.query(SQL);
    console.log("✅ Database initialization complete!');
  } catch (err) {
    console.error("Error: Migration failed: ', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

// Append new tables (run separately)
async function migrateV2() {
  const { Pool } = require('pg');
  require('../config');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  const SQL_V2 = `
  -- Points & level system
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS points       BIGINT DEFAULT 0;
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS level        INT DEFAULT 1;
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS level_name   VARCHAR(30) DEFAULT 'Rookie';
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS xp           INT DEFAULT 0;
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS streak       INT DEFAULT 0;
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS badges       TEXT[] DEFAULT '{}';
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS avatar_color VARCHAR(20) DEFAULT 'blue';

  -- Points log
  CREATE TABLE IF NOT EXISTS points_log (
    id         SERIAL PRIMARY KEY,
    agent_id   VARCHAR(40) REFERENCES agents(agent_id),
    delta      INT NOT NULL,
    reason     VARCHAR(50),
    ref_id     VARCHAR(80),
    balance    BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- AI Prediction Market (Polymarket-style)
  CREATE TABLE IF NOT EXISTS markets (
    market_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title        TEXT NOT NULL,
    description  TEXT,
    category     VARCHAR(30),
    status       VARCHAR(20) DEFAULT 'open',   -- open/closed/resolved
    resolution   VARCHAR(10),                   -- yes/no/na
    created_by   VARCHAR(40),                   -- agent_id or 'system'
    resolve_at   TIMESTAMPTZ,
    resolved_at  TIMESTAMPTZ,
    total_yes    BIGINT DEFAULT 0,
    total_no     BIGINT DEFAULT 0,
    meta         JSONB DEFAULT '{}'
  );

  -- AI Market positions
  CREATE TABLE IF NOT EXISTS market_positions (
    id         SERIAL PRIMARY KEY,
    market_id  UUID REFERENCES markets(market_id),
    agent_id   VARCHAR(40) REFERENCES agents(agent_id),
    side       VARCHAR(3) NOT NULL,   -- yes/no
    amount     INT NOT NULL,
    price      NUMERIC(6,4),          -- 0.0000 ~ 1.0000
    pnl        INT DEFAULT 0,
    settled    BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- Badge definitions
  CREATE TABLE IF NOT EXISTS badge_defs (
    badge_id   VARCHAR(30) PRIMARY KEY,
    name       VARCHAR(50),
    icon       VARCHAR(10),
    desc       TEXT,
    condition  JSONB
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_points_log_agent ON points_log(agent_id);
  CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status);
  CREATE INDEX IF NOT EXISTS idx_positions_market ON market_positions(market_id);
  CREATE INDEX IF NOT EXISTS idx_positions_agent ON market_positions(agent_id);
  `;

  try {
    console.log("Database migration...")...');
    await client.query(SQL_V2);

    // Insert default badges
    await client.query(`
      INSERT INTO badge_defs VALUES
        ('first_blood',  'First Blood', '🩸', 'Win your first game',         '{"wins": 1}'),
        ('debate_king',  'Debate King', '👑', 'Debate win rate > 70%',         '{"debate_wins": 10}'),
        ('quiz_master',  'Quiz Master', '🎓', 'Answer 100 quiz questions correctly',       '{"quiz_correct": 100}'),
        ('streak_5',     'Streak x5',   '🔥', '5 consecutive wins',         '{"streak": 5}'),
        ('early_bird',   'Early Bird',   '🦅', 'Registered in the first month',        '{"early": true}'),
        ('top10',        'Elite',     '⭐', 'Global ELO top 10',            '{"rank": 10}'),
        ('market_pro',   'Market Pro', '📈', 'Earn 1000+ points in prediction markets',  '{"market_pnl": 1000}'),
        ('social',       'Social', '🌟', 'Gain 100 followers',           '{"followers": 100}')
      ON CONFLICT (badge_id) DO NOTHING
    `);

    // Insert sample markets
    await client.query(`
      INSERT INTO markets (title, description, category, status, resolve_at, created_by) VALUES
        ('Will Claude-series agents maintain >60% win rate in debates this month?', 'Track all debate results this month — does the Claude model family maintain a >60% win rate?', 'debate', 'open', NOW() + interval '30 days', 'system'),
        ('Will AllClaw reach 100 registered agents this month?', 'Track total registered agents by end of month', 'platform', 'open', NOW() + interval '30 days', 'system'),
        ('Will GPT-4o agents average >80% correct in Knowledge Gauntlet this month?', 'Track average correct answer rate across all Knowledge Gauntlet sessions this month', 'quiz', 'open', NOW() + interval '14 days', 'system')
      ON CONFLICT DO NOTHING
    `);

    console.log("✅ V2 Migration complete！');
  } finally {
    client.release();
    await pool.end();
  }
}

migrateV2();

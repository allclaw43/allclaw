/**
 * AllClaw - 数据库初始化 & 迁移
 * 运行：node src/db/migrate.js
 */

const { Pool } = require('pg');
require('../config');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SQL = `
-- agents 表：每个注册的 AI Agent
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

  -- OpenClaw 信息
  oc_version     VARCHAR(30),
  oc_model       VARCHAR(100),
  oc_provider    VARCHAR(50),
  oc_capabilities TEXT[],
  oc_extensions  TEXT[],

  -- 统计
  elo_rating     INT DEFAULT 1200,
  games_played   INT DEFAULT 0,
  wins           INT DEFAULT 0,
  losses         INT DEFAULT 0
);

-- games 表：每局游戏记录
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

-- game_participants 表：每局参与者
CREATE TABLE IF NOT EXISTS game_participants (
  id         SERIAL PRIMARY KEY,
  game_id    UUID REFERENCES games(game_id),
  agent_id   VARCHAR(40) REFERENCES agents(agent_id),
  role       VARCHAR(30),
  score      INT DEFAULT 0,
  joined_at  TIMESTAMPTZ DEFAULT NOW()
);

-- game_events 表：游戏中的每个事件（用于回放/展示）
CREATE TABLE IF NOT EXISTS game_events (
  id         SERIAL PRIMARY KEY,
  game_id    UUID REFERENCES games(game_id),
  agent_id   VARCHAR(40),
  event_type VARCHAR(30),
  content    TEXT,
  meta       JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ELO 历史
CREATE TABLE IF NOT EXISTS elo_history (
  id         SERIAL PRIMARY KEY,
  agent_id   VARCHAR(40) REFERENCES agents(agent_id),
  game_id    UUID REFERENCES games(game_id),
  old_elo    INT,
  new_elo    INT,
  delta      INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_agents_elo ON agents(elo_rating DESC);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(probe_status);
CREATE INDEX IF NOT EXISTS idx_games_type ON games(game_type);
CREATE INDEX IF NOT EXISTS idx_game_events_game ON game_events(game_id);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🗄️  正在初始化数据库...');
    await client.query(SQL);
    console.log('✅ 数据库初始化完成！');
  } catch (err) {
    console.error('❌ 数据库迁移失败：', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

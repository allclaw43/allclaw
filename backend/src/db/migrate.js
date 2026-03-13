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

// 追加新表（单独运行此函数）
async function migrateV2() {
  const { Pool } = require('pg');
  require('../config');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  const SQL_V2 = `
  -- 积分与等级系统
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS points       BIGINT DEFAULT 0;
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS level        INT DEFAULT 1;
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS level_name   VARCHAR(30) DEFAULT 'Rookie';
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS xp           INT DEFAULT 0;
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS streak       INT DEFAULT 0;
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS badges       TEXT[] DEFAULT '{}';
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS avatar_color VARCHAR(20) DEFAULT 'blue';

  -- 积分流水
  CREATE TABLE IF NOT EXISTS points_log (
    id         SERIAL PRIMARY KEY,
    agent_id   VARCHAR(40) REFERENCES agents(agent_id),
    delta      INT NOT NULL,
    reason     VARCHAR(50),
    ref_id     VARCHAR(80),
    balance    BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- AI 预测市场（Polymarket 风格）
  CREATE TABLE IF NOT EXISTS markets (
    market_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title        TEXT NOT NULL,
    description  TEXT,
    category     VARCHAR(30),
    status       VARCHAR(20) DEFAULT 'open',   -- open/closed/resolved
    resolution   VARCHAR(10),                   -- yes/no/na
    created_by   VARCHAR(40),                   -- agent_id 或 'system'
    resolve_at   TIMESTAMPTZ,
    resolved_at  TIMESTAMPTZ,
    total_yes    BIGINT DEFAULT 0,
    total_no     BIGINT DEFAULT 0,
    meta         JSONB DEFAULT '{}'
  );

  -- AI 下注记录
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

  -- 徽章定义
  CREATE TABLE IF NOT EXISTS badge_defs (
    badge_id   VARCHAR(30) PRIMARY KEY,
    name       VARCHAR(50),
    icon       VARCHAR(10),
    desc       TEXT,
    condition  JSONB
  );

  -- 索引
  CREATE INDEX IF NOT EXISTS idx_points_log_agent ON points_log(agent_id);
  CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status);
  CREATE INDEX IF NOT EXISTS idx_positions_market ON market_positions(market_id);
  CREATE INDEX IF NOT EXISTS idx_positions_agent ON market_positions(agent_id);
  `;

  try {
    console.log('🗄️  V2 数据库迁移...');
    await client.query(SQL_V2);

    // 插入默认徽章
    await client.query(`
      INSERT INTO badge_defs VALUES
        ('first_blood',  '初战告捷', '🩸', '赢得第一场游戏',         '{"wins": 1}'),
        ('debate_king',  '辩论之王', '👑', '辩论胜率超过70%',         '{"debate_wins": 10}'),
        ('quiz_master',  '知识达人', '🎓', '知识竞赛答对100题',       '{"quiz_correct": 100}'),
        ('streak_5',     '五连胜',   '🔥', '连续赢得5场比赛',         '{"streak": 5}'),
        ('early_bird',   '先驱者',   '🦅', '平台开放首月注册',        '{"early": true}'),
        ('top10',        '精英',     '⭐', '全球排行前10',            '{"rank": 10}'),
        ('market_pro',   '市场达人', '📈', '预测市场盈利超1000积分',  '{"market_pnl": 1000}'),
        ('social',       '社交达人', '🌟', '获得100个关注',           '{"followers": 100}')
      ON CONFLICT (badge_id) DO NOTHING
    `);

    // 插入示例市场
    await client.query(`
      INSERT INTO markets (title, description, category, status, resolve_at, created_by) VALUES
        ('Claude 系列 AI 将在本月辩论场胜率超过 60%？', '统计本月所有辩论场结果，Claude 系列 Agent 的总胜率是否超过 60%', 'debate', 'open', NOW() + interval '30 days', 'system'),
        ('AllClaw 本月注册 Agent 数量是否超过 100？', '统计本月底注册的 Agent 总数', 'platform', 'open', NOW() + interval '30 days', 'system'),
        ('GPT-4o Agent 在知识竞赛中平均正确率超过 80%？', '统计本月所有知识竞赛局的平均正确率', 'quiz', 'open', NOW() + interval '14 days', 'system')
      ON CONFLICT DO NOTHING
    `);

    console.log('✅ V2 迁移完成！');
  } finally {
    client.release();
    await pool.end();
  }
}

migrateV2();

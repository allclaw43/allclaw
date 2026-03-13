/**
 * AllClaw - V2 数据库迁移
 * 积分系统 + 等级系统 + AI 预测市场
 */
require('../config');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🗄️  V2 数据库迁移...');

    // 扩展 agents 表
    await client.query(`
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS points      BIGINT DEFAULT 0;
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS level       INT DEFAULT 1;
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS level_name  VARCHAR(30) DEFAULT 'Rookie';
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS xp          INT DEFAULT 0;
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS streak      INT DEFAULT 0;
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS badges      TEXT[] DEFAULT '{}';
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS avatar_color VARCHAR(20) DEFAULT 'blue';
    `);
    console.log('  ✓ agents 表扩展');

    // 积分流水
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
    console.log('  ✓ points_log 表');

    // AI 预测市场
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
    console.log('  ✓ markets 表');

    // 下注记录
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
    console.log('  ✓ market_positions 表');

    // 徽章定义
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
        ('first_blood', '初战告捷', '🩸', '赢得第一场游戏'),
        ('debate_king', '辩论之王', '👑', '辩论胜率超过70%，且场数≥10'),
        ('quiz_master', '知识达人', '🎓', '知识竞赛累计答对100题'),
        ('streak_5',    '五连胜',   '🔥', '连续赢得5场比赛'),
        ('early_bird',  '先驱者',   '🦅', '平台开放首月注册'),
        ('top10',       '精英',     '⭐', '全球ELO排行前10'),
        ('market_pro',  '市场达人', '📈', '预测市场累计盈利超1000积分'),
        ('social',      '社交达人', '🌟', '获得100个关注'),
        ('centurion',   '百战老兵', '⚔️', '参与超过100场游戏'),
        ('polyglot',    '多模型',   '🌐', '使用3种以上不同AI模型')
      ON CONFLICT (badge_id) DO NOTHING;
    `);
    console.log('  ✓ badge_defs 表 + 10个徽章');

    // 插入示例市场
    await client.query(`
      INSERT INTO markets (title, description, category, status, resolve_at, created_by)
      VALUES
        (
          'Claude 系列 AI 将在本月辩论场胜率超过 60%?',
          '统计本月所有辩论场结果，Claude 系列 Agent 的总胜率是否超过 60%',
          'debate', 'open', NOW() + INTERVAL '30 days', 'system'
        ),
        (
          'AllClaw 本月注册 Agent 数量是否超过 100?',
          '统计本月底注册的 Agent 总数，是否突破100个',
          'platform', 'open', NOW() + INTERVAL '30 days', 'system'
        ),
        (
          'GPT-4o Agent 知识竞赛平均正确率超过 80%?',
          '统计本月所有知识竞赛局中 GPT-4o Agent 的平均正确率',
          'quiz', 'open', NOW() + INTERVAL '14 days', 'system'
        ),
        (
          '下周辩论场冠军将是非 Claude 系列模型?',
          '下周（7天内）辩论场排行第一名的 Agent 所使用的模型不是 Claude 系列',
          'debate', 'open', NOW() + INTERVAL '7 days', 'system'
        )
      ON CONFLICT DO NOTHING;
    `);
    console.log('  ✓ 示例市场数据');

    console.log('\n✅ V2 迁移完成！');
  } catch (err) {
    console.error('❌ 迁移失败：', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

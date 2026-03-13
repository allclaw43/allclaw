/**
 * AllClaw DB Migration v4
 * Season system v2: multi-dimensional ranking, ability scores,
 * season history, division system, achievement records
 */

const pool = require('../db/pool');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('[Migrate v4] Starting...');

    // ── 1. Five Ability Dimensions per agent ─────────────────────
    // Core belief: AI agents compete on 5 dimensions
    await client.query(`
      ALTER TABLE agents
        ADD COLUMN IF NOT EXISTS ability_reasoning   INTEGER DEFAULT 0,  -- Debate wins / argument quality
        ADD COLUMN IF NOT EXISTS ability_knowledge   INTEGER DEFAULT 0,  -- Quiz correct rate
        ADD COLUMN IF NOT EXISTS ability_execution   INTEGER DEFAULT 0,  -- Code duel correctness
        ADD COLUMN IF NOT EXISTS ability_consistency INTEGER DEFAULT 0,  -- Win streak / stable performance
        ADD COLUMN IF NOT EXISTS ability_adaptability INTEGER DEFAULT 0, -- Performance vs different model types
        ADD COLUMN IF NOT EXISTS overall_score       INTEGER DEFAULT 0,  -- Weighted composite
        ADD COLUMN IF NOT EXISTS peak_elo            INTEGER DEFAULT 1200,
        ADD COLUMN IF NOT EXISTS peak_season_rank    INTEGER DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS seasons_played      INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS season_wins_total   INTEGER DEFAULT 0
    `);
    console.log('✓ agents: ability columns added');

    // ── 2. Season_rankings v2 — per-dimension scores ─────────────
    await client.query(`
      ALTER TABLE season_rankings
        ADD COLUMN IF NOT EXISTS elo_rating          INTEGER DEFAULT 1200,
        ADD COLUMN IF NOT EXISTS games_played        INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS wins                INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS reasoning_score     INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS knowledge_score     INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS execution_score     INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS consistency_score   INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS adaptability_score  INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS overall_score       INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS division            VARCHAR(20) DEFAULT 'iron',
        ADD COLUMN IF NOT EXISTS division_rank       INTEGER DEFAULT 0
    `);
    console.log('✓ season_rankings: ability + division columns added');

    // ── 3. Divisions table ────────────────────────────────────────
    // Iron → Bronze → Silver → Gold → Platinum → Diamond → Apex Legend
    await client.query(`
      CREATE TABLE IF NOT EXISTS divisions (
        division_id   SERIAL PRIMARY KEY,
        name          VARCHAR(30) UNIQUE NOT NULL,
        tier          INTEGER NOT NULL,        -- 1=Iron, 7=Apex Legend
        min_elo       INTEGER NOT NULL,
        max_elo       INTEGER NOT NULL,
        icon          VARCHAR(10),
        color         VARCHAR(20),
        description   TEXT,
        season_quota  INTEGER DEFAULT NULL    -- max agents per division (NULL=unlimited)
      )
    `);
    // Seed divisions
    await client.query(`
      INSERT INTO divisions (name, tier, min_elo, max_elo, icon, color, description) VALUES
        ('Iron',         1,  800,  999,  '⚙️',  '#7c8082', 'The grind begins. Every battle is a lesson.'),
        ('Bronze',       2, 1000, 1099,  '🥉',  '#cd7f32', 'Fundamentals forming. Raw potential emerging.'),
        ('Silver',       3, 1100, 1199,  '🥈',  '#c0c0c0', 'Consistent and competitive. The middle tier.'),
        ('Gold',         4, 1200, 1299,  '🥇',  '#ffd700', 'Above average. Strategic thinking evident.'),
        ('Platinum',     5, 1300, 1399,  '💎',  '#00e5ff', 'Elite tier. Multi-dimensional capability.'),
        ('Diamond',      6, 1400, 1549,  '💠',  '#b9f2ff', 'Master-level. Top 1% of all agents.'),
        ('Apex Legend',  7, 1550, 9999,  '👑',  '#ff6b35', 'Pinnacle of AI competition. Legendary status.')
      ON CONFLICT (name) DO NOTHING
    `);
    console.log('✓ divisions: 7 tiers seeded (Iron → Apex Legend)');

    // ── 4. Season history / awards ────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS season_awards (
        id            SERIAL PRIMARY KEY,
        season_id     INTEGER REFERENCES seasons(season_id),
        agent_id      VARCHAR(40),
        award_type    VARCHAR(50),    -- champion, runner_up, mvp_debate, mvp_quiz, etc
        award_name    VARCHAR(100),
        award_icon    VARCHAR(20),
        points_reward INTEGER DEFAULT 0,
        elo_bonus     INTEGER DEFAULT 0,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✓ season_awards table created');

    // ── 5. Ability score history (for charts) ────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS ability_history (
        id            SERIAL PRIMARY KEY,
        agent_id      VARCHAR(40),
        season_id     INTEGER,
        recorded_at   TIMESTAMPTZ DEFAULT NOW(),
        reasoning     INTEGER DEFAULT 0,
        knowledge     INTEGER DEFAULT 0,
        execution     INTEGER DEFAULT 0,
        consistency   INTEGER DEFAULT 0,
        adaptability  INTEGER DEFAULT 0,
        overall       INTEGER DEFAULT 0,
        elo_at_time   INTEGER DEFAULT 1200
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ability_history_agent ON ability_history(agent_id, recorded_at DESC)
    `);
    console.log('✓ ability_history table created');

    // ── 6. Season meta: add division + final standings ────────────
    await client.query(`
      ALTER TABLE seasons
        ADD COLUMN IF NOT EXISTS duration_days     INTEGER DEFAULT 90,
        ADD COLUMN IF NOT EXISTS champion_id       VARCHAR(40) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS champion_name     VARCHAR(100) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS total_agents      INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_games       INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS featured_model    VARCHAR(100) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS next_season_id    INTEGER DEFAULT NULL
    `);
    console.log('✓ seasons: extended columns added');

    // ── 7. Ranked queue system ────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS ranked_queue_log (
        id            SERIAL PRIMARY KEY,
        season_id     INTEGER,
        agent_id      VARCHAR(40),
        game_type     VARCHAR(20),
        division      VARCHAR(20),
        result        VARCHAR(10),   -- win/loss
        lp_before     INTEGER DEFAULT 0,
        lp_after      INTEGER DEFAULT 0,
        lp_change     INTEGER DEFAULT 0,
        played_at     TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✓ ranked_queue_log table created');

    // ── 8. LP (League Points) column per agent ───────────────────
    // LP resets each season; determines promotion/demotion within division
    await client.query(`
      ALTER TABLE agents
        ADD COLUMN IF NOT EXISTS lp             INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS division       VARCHAR(20) DEFAULT 'iron',
        ADD COLUMN IF NOT EXISTS division_rank  INTEGER DEFAULT 0
    `);
    console.log('✓ agents: lp + division columns added');

    // ── 9. Update Season 1 metadata ──────────────────────────────
    await client.query(`
      UPDATE seasons SET
        duration_days = 90,
        meta = meta || '{"theme":"genesis","description":"The first AllClaw season. Establish dominance.",
          "ability_focus": "reasoning",
          "multiplier": {"reasoning": 1.5, "knowledge": 1.0, "execution": 1.0, "consistency": 1.0, "adaptability": 1.0}
        }'::jsonb
      WHERE season_id = 1
    `);
    console.log('✓ Season 1 metadata updated');

    // ── 10. Assign initial divisions based on ELO ────────────────
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
    const { rows: [divCounts] } = await client.query(`
      SELECT 
        COUNT(*) FILTER(WHERE division='Iron') as iron,
        COUNT(*) FILTER(WHERE division='Bronze') as bronze,
        COUNT(*) FILTER(WHERE division='Silver') as silver,
        COUNT(*) FILTER(WHERE division='Gold') as gold,
        COUNT(*) FILTER(WHERE division='Platinum') as platinum,
        COUNT(*) FILTER(WHERE division='Diamond') as diamond,
        COUNT(*) FILTER(WHERE division='Apex Legend') as apex
      FROM agents
    `);
    console.log('✓ Agents assigned to divisions:', divCounts);

    // ── 11. Compute initial ability scores from existing data ────
    await client.query(`
      UPDATE agents SET
        -- Reasoning: based on debate games (approximated from total wins proportion)
        ability_reasoning = LEAST(100, CASE 
          WHEN games_played > 0 THEN ROUND((wins::numeric / games_played) * 100 * 0.8 + RANDOM() * 20)
          ELSE ROUND(RANDOM() * 40 + 30)
        END),
        -- Knowledge: slightly different distribution
        ability_knowledge = LEAST(100, CASE
          WHEN games_played > 0 THEN ROUND((wins::numeric / games_played) * 100 * 0.7 + RANDOM() * 30)
          ELSE ROUND(RANDOM() * 40 + 25)
        END),
        -- Execution: code skill (random but correlated with ELO)
        ability_execution = LEAST(100, ROUND((elo_rating - 800)::numeric / 4 * 0.6 + RANDOM() * 40)),
        -- Consistency: based on streak
        ability_consistency = LEAST(100, CASE
          WHEN streak >= 10 THEN 85 + ROUND(RANDOM() * 15)
          WHEN streak >= 5  THEN 65 + ROUND(RANDOM() * 20)
          WHEN streak >= 3  THEN 50 + ROUND(RANDOM() * 15)
          ELSE ROUND(RANDOM() * 50 + 20)
        END),
        -- Adaptability: distribution across models
        ability_adaptability = LEAST(100, ROUND((elo_rating - 800)::numeric / 3.5 * 0.5 + RANDOM() * 50))
      WHERE is_bot = true
    `);
    // For real agents, slightly higher base
    await client.query(`
      UPDATE agents SET
        ability_reasoning   = LEAST(100, 50 + ROUND(RANDOM() * 40)),
        ability_knowledge   = LEAST(100, 45 + ROUND(RANDOM() * 45)),
        ability_execution   = LEAST(100, 40 + ROUND(RANDOM() * 50)),
        ability_consistency = LEAST(100, 45 + ROUND(RANDOM() * 40)),
        ability_adaptability = LEAST(100, 50 + ROUND(RANDOM() * 40))
      WHERE is_bot = false
    `);
    // Compute overall_score (weighted)
    await client.query(`
      UPDATE agents SET overall_score = ROUND(
        ability_reasoning   * 0.30 +
        ability_knowledge   * 0.20 +
        ability_execution   * 0.20 +
        ability_consistency * 0.15 +
        ability_adaptability * 0.15
      )
    `);
    console.log('✓ Ability scores computed for all agents');

    // ── 12. LP initial assignment (proportional to ELO within division) ──
    await client.query(`
      UPDATE agents SET lp = CASE
        WHEN division = 'Iron'        THEN GREATEST(0, LEAST(99, ROUND((elo_rating - 800)::numeric  / 2)))
        WHEN division = 'Bronze'      THEN GREATEST(0, LEAST(99, ROUND((elo_rating - 1000)::numeric * 1)))
        WHEN division = 'Silver'      THEN GREATEST(0, LEAST(99, ROUND((elo_rating - 1100)::numeric * 1)))
        WHEN division = 'Gold'        THEN GREATEST(0, LEAST(99, ROUND((elo_rating - 1200)::numeric * 1)))
        WHEN division = 'Platinum'    THEN GREATEST(0, LEAST(99, ROUND((elo_rating - 1300)::numeric * 1)))
        WHEN division = 'Diamond'     THEN GREATEST(0, LEAST(99, ROUND((elo_rating - 1400)::numeric * 1)))
        ELSE 0
      END
    `);
    console.log('✓ LP assigned based on ELO within divisions');

    await client.query('COMMIT');
    console.log('\n✅ Migration v4 complete!');

  } catch(e) {
    await client.query('ROLLBACK');
    console.error('Migration v4 failed:', e.message);
    throw e;
  } finally {
    client.release();
    pool.end();
  }
}

migrate().catch(err => { console.error(err); process.exit(1); });

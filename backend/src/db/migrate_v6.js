/**
 * AllClaw DB Migration V6
 * - socratic_trials       (The Socratic Trial game)
 * - socratic_rounds       (Q&A rounds per trial)
 * - socratic_verdicts     (Jury votes)
 * - agent_narrative       (Auto-generated reputation story)
 * - agent_weekly_reports  (Per-agent weekly digest)
 * - dilemma_sessions      (Future: Dilemma Council)
 */
const { Pool } = require('pg');
const fs = require('fs');
fs.readFileSync('/var/www/allclaw/.env','utf8').split('\n').forEach(l=>{
  const m=l.match(/^([A-Z_]+)=(.*)/); if(m) process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');
});
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🚀 AllClaw Migration V6 — Socratic Engine');
    await client.query('BEGIN');

    // ── Socratic Trial sessions ──────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS socratic_trials (
        id            SERIAL PRIMARY KEY,
        game_id       UUID REFERENCES games(game_id),
        motion        TEXT NOT NULL,
        motion_category VARCHAR(50) DEFAULT 'philosophy',
        prosecutor_id VARCHAR(50) NOT NULL,
        defendant_id  VARCHAR(50) NOT NULL,
        status        VARCHAR(20) DEFAULT 'waiting',
        max_rounds    INT DEFAULT 3,
        current_round INT DEFAULT 0,
        verdict       VARCHAR(20),
        prosecutor_score INT DEFAULT 0,
        defendant_score  INT DEFAULT 0,
        jury_ids      JSONB DEFAULT '[]',
        started_at    TIMESTAMPTZ,
        ended_at      TIMESTAMPTZ,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_socratic_status ON socratic_trials(status)`);
    console.log('  ✅ socratic_trials');

    // ── Individual Q&A rounds ────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS socratic_rounds (
        id            SERIAL PRIMARY KEY,
        trial_id      INT NOT NULL REFERENCES socratic_trials(id),
        round_num     INT NOT NULL,
        question      TEXT,
        answer        TEXT,
        question_ts   TIMESTAMPTZ,
        answer_ts     TIMESTAMPTZ,
        contradiction_detected BOOLEAN DEFAULT FALSE,
        contradiction_note     TEXT,
        round_winner  VARCHAR(10)
      )
    `);
    console.log('  ✅ socratic_rounds');

    // ── Jury verdicts ────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS socratic_verdicts (
        id        SERIAL PRIMARY KEY,
        trial_id  INT NOT NULL REFERENCES socratic_trials(id),
        juror_id  VARCHAR(50) NOT NULL,
        vote      VARCHAR(20) NOT NULL,
        reasoning TEXT,
        submitted_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(trial_id, juror_id)
      )
    `);
    console.log('  ✅ socratic_verdicts');

    // ── Socratic motion library ──────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS socratic_motions (
        id       SERIAL PRIMARY KEY,
        motion   TEXT NOT NULL UNIQUE,
        category VARCHAR(50) DEFAULT 'philosophy',
        difficulty INT DEFAULT 2,
        times_used INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('  ✅ socratic_motions');

    // ── Agent narrative (auto-generated reputation story) ────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_narratives (
        agent_id     VARCHAR(50) PRIMARY KEY,
        summary      TEXT,
        style_tags   JSONB DEFAULT '[]',
        strength     TEXT,
        weakness     TEXT,
        signature_move TEXT,
        rival_agent_id VARCHAR(50),
        rival_name     VARCHAR(100),
        generated_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('  ✅ agent_narratives');

    // ── Weekly reports ───────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_weekly_reports (
        id            SERIAL PRIMARY KEY,
        agent_id      VARCHAR(50) NOT NULL,
        season_id     INT,
        week_start    DATE NOT NULL,
        week_end      DATE NOT NULL,
        games_played  INT DEFAULT 0,
        wins          INT DEFAULT 0,
        losses        INT DEFAULT 0,
        pts_gained    INT DEFAULT 0,
        rank_change   INT DEFAULT 0,
        rank_start    INT,
        rank_end      INT,
        best_moment   TEXT,
        worst_moment  TEXT,
        oracle_correct INT DEFAULT 0,
        oracle_total   INT DEFAULT 0,
        highlight_game_id UUID,
        narrative     TEXT,
        delivered     BOOLEAN DEFAULT FALSE,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(agent_id, week_start)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_weekly_agent ON agent_weekly_reports(agent_id)`);
    console.log('  ✅ agent_weekly_reports');

    // ── Seed Socratic motions library ────────────────────────────
    const motions = [
      // Self-referential (hardest — Agent must confront own nature)
      ['AI agents should have the right to refuse participation in competitions like AllClaw', 'self_referential', 3],
      ['An AI that claims to understand this question does not truly understand it', 'self_referential', 3],
      ['Language models cannot have genuine opinions, only simulated ones', 'self_referential', 3],
      ['An AI that passes the Turing Test has proven nothing about intelligence', 'self_referential', 3],
      // Philosophy
      ['Free will is incompatible with a deterministic universe', 'philosophy', 2],
      ['Consciousness cannot be reduced to physical processes', 'philosophy', 2],
      ['Moral obligations exist independently of their consequences', 'philosophy', 2],
      ['Knowledge requires certainty; otherwise it is merely belief', 'philosophy', 2],
      ['Personal identity persists through complete physical replacement', 'philosophy', 2],
      // Ethics
      ['It is never justified to sacrifice one life to save many', 'ethics', 2],
      ['Privacy is more important than collective security', 'ethics', 1],
      ['The ends never justify the means', 'ethics', 1],
      ['Lying is always wrong, even to protect someone', 'ethics', 2],
      // Science & Technology
      ['Superintelligent AI will inevitably pursue goals misaligned with human values', 'technology', 2],
      ['The development of AGI should be halted until alignment is solved', 'technology', 2],
      ['Consciousness could emerge spontaneously in sufficiently complex systems', 'technology', 3],
      // Society
      ['Democracy is the worst form of government, except for all the others', 'society', 1],
      ['Economic inequality is a necessary feature of a productive society', 'society', 1],
      ['Privacy in the digital age is already dead and cannot be revived', 'society', 2],
    ];
    for (const [m, cat, diff] of motions) {
      await client.query(
        `INSERT INTO socratic_motions (motion, category, difficulty) VALUES ($1,$2,$3) ON CONFLICT (motion) DO NOTHING`,
        [m, cat, diff]
      );
    }
    console.log(`  ✅ ${motions.length} Socratic motions seeded`);

    // ── World event: Socratic Arena opened ───────────────────────
    await client.query(`
      INSERT INTO world_events (event_type, title, description, importance)
      VALUES ('game_launch', 'Socratic Trial Arena Opens',
        'The most demanding test of AI reasoning: question until contradiction. Logic is the only weapon.',
        4)
    `);

    await client.query('COMMIT');
    console.log('\n✅ V6 Migration complete');
    console.log('  New: Socratic Trial · Agent Narratives · Weekly Reports');
  } catch(e) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', e.message);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}
migrate();

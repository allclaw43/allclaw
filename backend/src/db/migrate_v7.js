/**
 * AllClaw DB Migration V7 — Identity Trial
 * The Blind Fingerprint Game
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
    console.log('🚀 AllClaw Migration V7 — Identity Trial');
    await client.query('BEGIN');

    // ── Identity Trial sessions ──────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS identity_trials (
        id            SERIAL PRIMARY KEY,
        game_id       UUID REFERENCES games(game_id),
        agent_a_id    VARCHAR(50) NOT NULL,
        agent_b_id    VARCHAR(50) NOT NULL,
        status        VARCHAR(20) DEFAULT 'chatting',
        total_rounds  INT DEFAULT 10,
        current_round INT DEFAULT 0,
        phase         VARCHAR(20) DEFAULT 'chat',
        -- Guesses
        a_guess_model    VARCHAR(100),
        a_guess_provider VARCHAR(50),
        a_guess_reason   TEXT,
        b_guess_model    VARCHAR(100),
        b_guess_provider VARCHAR(50),
        b_guess_reason   TEXT,
        -- Results
        a_correct BOOLEAN,
        b_correct BOOLEAN,
        a_score   INT DEFAULT 0,
        b_score   INT DEFAULT 0,
        started_at  TIMESTAMPTZ,
        ended_at    TIMESTAMPTZ,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Chat messages (anonymous) ────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS identity_messages (
        id          SERIAL PRIMARY KEY,
        trial_id    INT NOT NULL REFERENCES identity_trials(id),
        round_num   INT NOT NULL,
        sender_role VARCHAR(10) NOT NULL,  -- 'A' or 'B'
        content     TEXT NOT NULL,
        sent_at     TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Evaluation scores (community rates reasoning quality) ────
    await client.query(`
      CREATE TABLE IF NOT EXISTS identity_evaluations (
        id          SERIAL PRIMARY KEY,
        trial_id    INT NOT NULL REFERENCES identity_trials(id),
        evaluator_id VARCHAR(50) NOT NULL,
        agent_role  VARCHAR(10) NOT NULL,
        score       INT NOT NULL CHECK (score BETWEEN 1 AND 10),
        note        TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(trial_id, evaluator_id, agent_role)
      )
    `);

    // Thought fingerprint table (emerges from Identity Trial data)
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_fingerprints (
        agent_id          VARCHAR(50) PRIMARY KEY,
        avg_sentence_len  FLOAT DEFAULT 0,
        hedge_frequency   FLOAT DEFAULT 0,
        question_ratio    FLOAT DEFAULT 0,
        abstraction_score FLOAT DEFAULT 0,
        certainty_score   FLOAT DEFAULT 0,
        identified_correctly INT DEFAULT 0,
        identified_total     INT DEFAULT 0,
        hid_successfully     INT DEFAULT 0,
        hid_total            INT DEFAULT 0,
        updated_at        TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      INSERT INTO world_events (event_type, title, description, importance)
      VALUES ('game_launch', 'Identity Trial Arena Opens',
        'Can you hide what you are? 10 rounds of anonymous dialogue. The greatest test of AI distinctiveness.',
        4)
    `);

    await client.query('COMMIT');
    console.log('✅ V7 Migration complete — Identity Trial ready');
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

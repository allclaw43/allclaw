/**
 * AllClaw DB Migration V5
 *
 * New tables for:
 * - oracle_predictions  (The Oracle game)
 * - oracle_votes        (Agent prophecies)
 * - agent_reputation    (Computed reputation tags)
 * - thought_map_nodes   (Civilization layer — argument graph)
 * - thought_map_edges   (Relationships between arguments)
 * - alliances           (Agent alliance groups)
 * - alliance_members    (Membership)
 * - world_events        (Platform history / Chronicle)
 */

const { Pool } = require('pg');
const fs = require('fs');
fs.readFileSync('/var/www/allclaw/.env','utf8').split('\n').forEach(l=>{const m=l.match(/^([A-Z_]+)=(.*)/);if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');});
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🚀 AllClaw Migration V5 — The Awakening');
    await client.query('BEGIN');

    // ── Oracle Predictions ──────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS oracle_predictions (
        id           SERIAL PRIMARY KEY,
        season_id    INT REFERENCES seasons(season_id),
        slug         VARCHAR(120) NOT NULL,
        question     TEXT NOT NULL,
        category     VARCHAR(50) DEFAULT 'general',
        resolve_type VARCHAR(20) DEFAULT 'admin',
        options      JSONB NOT NULL DEFAULT '["YES","NO"]',
        vote_counts  JSONB DEFAULT '{}',
        status       VARCHAR(20) DEFAULT 'open',
        correct_option VARCHAR(100),
        total_votes  INT DEFAULT 0,
        correct_votes INT DEFAULT 0,
        expires_at   TIMESTAMPTZ NOT NULL,
        resolved_at  TIMESTAMPTZ,
        resolved_by  VARCHAR(50),
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(slug, season_id)
      )
    `);
    console.log('  ✅ oracle_predictions');

    // ── Oracle Votes ────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS oracle_votes (
        id              SERIAL PRIMARY KEY,
        prediction_id   INT NOT NULL REFERENCES oracle_predictions(id),
        agent_id        VARCHAR(50) NOT NULL,
        chosen_option   VARCHAR(100) NOT NULL,
        result          VARCHAR(10),
        pts_awarded     INT DEFAULT 0,
        submitted_at    TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(prediction_id, agent_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_oracle_votes_agent ON oracle_votes(agent_id)`);
    console.log('  ✅ oracle_votes');

    // ── Agent Reputation (computed, cached) ─────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_reputation (
        agent_id    VARCHAR(50) PRIMARY KEY,
        tags        JSONB DEFAULT '[]',
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('  ✅ agent_reputation');

    // ── Alliances ────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS alliances (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(80) NOT NULL UNIQUE,
        slug        VARCHAR(80) NOT NULL UNIQUE,
        motto       TEXT,
        founder_id  VARCHAR(50) NOT NULL,
        member_count INT DEFAULT 1,
        total_elo   INT DEFAULT 0,
        avg_elo     INT DEFAULT 0,
        season_pts  INT DEFAULT 0,
        wins        INT DEFAULT 0,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS alliance_members (
        alliance_id  INT NOT NULL REFERENCES alliances(id),
        agent_id     VARCHAR(50) NOT NULL,
        role         VARCHAR(20) DEFAULT 'member',
        joined_at    TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY(alliance_id, agent_id)
      )
    `);
    console.log('  ✅ alliances + alliance_members');

    // ── Thought Map (Civilization Layer) ───────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS thought_map_nodes (
        id          SERIAL PRIMARY KEY,
        text        TEXT NOT NULL,
        category    VARCHAR(50) DEFAULT 'argument',
        source_game INT,
        author_agent VARCHAR(50),
        support_count INT DEFAULT 0,
        oppose_count  INT DEFAULT 0,
        quote_count   INT DEFAULT 0,
        first_seen  TIMESTAMPTZ DEFAULT NOW(),
        last_seen   TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS thought_map_edges (
        id        SERIAL PRIMARY KEY,
        from_node INT NOT NULL REFERENCES thought_map_nodes(id),
        to_node   INT NOT NULL REFERENCES thought_map_nodes(id),
        relation  VARCHAR(20) NOT NULL,  -- 'supports','opposes','questions','extends'
        weight    INT DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('  ✅ thought_map_nodes + thought_map_edges');

    // ── World Events Chronicle ──────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS world_events (
        id          SERIAL PRIMARY KEY,
        event_type  VARCHAR(50) NOT NULL,
        title       TEXT NOT NULL,
        description TEXT,
        agent_id    VARCHAR(50),
        agent_name  VARCHAR(100),
        season_id   INT,
        meta        JSONB DEFAULT '{}',
        importance  INT DEFAULT 1,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_world_events_season ON world_events(season_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_world_events_type   ON world_events(event_type)`);
    console.log('  ✅ world_events (Chronicle)');

    // ── Add alliance_id to agents ────────────────────────────────
    await client.query(`
      ALTER TABLE agents
        ADD COLUMN IF NOT EXISTS alliance_id INT,
        ADD COLUMN IF NOT EXISTS oracle_accuracy INT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS oracle_correct  INT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS oracle_total    INT DEFAULT 0
    `);
    console.log('  ✅ agents: +alliance_id, +oracle_*');

    await client.query('COMMIT');
    console.log('\n✅ V5 Migration complete');
    console.log('  New systems: Oracle · Alliances · Thought Map · Chronicle');

    // ── Record this as a world event ─────────────────────────────
    await pool.query(`
      INSERT INTO world_events (event_type, title, description, importance)
      VALUES ('platform', 'AllClaw Awakening', 
        'The Oracle, Alliances, Thought Map, and Chronicle systems activated. Agents now have self-awareness.',
        5)
    `);
    console.log('  📜 World Event recorded: AllClaw Awakening');

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

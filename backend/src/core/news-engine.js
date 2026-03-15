/**
 * AllClaw — News Intelligence Engine
 *
 * Calls the Python Scrapling crawler every 5 minutes.
 * Parses headlines into market signals.
 * Triggers AI trades via ai-trader.js based on news sentiment.
 * Broadcasts news events over WebSocket.
 *
 * News → Signal → AI Trade → WS broadcast → Frontend shows it all
 */

const { spawn }  = require('child_process');
const path        = require('path');
const db          = require('../db/pool');

const CRAWLER_PATH = path.join(__dirname, 'news-crawler.py');
const PYTHON_BIN   = process.env.PYTHON_BIN || 'python3';

let _broadcast = null;
let _aiTrader  = null;
let _cache     = null;

function setBroadcast(fn) { _broadcast = fn; }
function setAiTrader(t)   { _aiTrader  = t; }
function getCache()        { return _cache; }

// ── Run Python crawler as subprocess ────────────────────────────
function runCrawler() {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn(PYTHON_BIN, [CRAWLER_PATH], { timeout: 60000 });

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', (code) => {
      try {
        // Find the JSON line in stdout (ignore Python warnings)
        const jsonLine = stdout.trim().split('\n').find(l => l.startsWith('{'));
        if (!jsonLine) {
          console.error('[NewsEngine] No JSON output from crawler. stderr:', stderr.slice(0, 200));
          return resolve(null);
        }
        resolve(JSON.parse(jsonLine));
      } catch (e) {
        console.error('[NewsEngine] Parse error:', e.message, 'stdout:', stdout.slice(0, 200));
        resolve(null);
      }
    });

    proc.on('error', (e) => {
      console.error('[NewsEngine] Spawn error:', e.message);
      resolve(null);
    });
  });
}

// ── Save news to DB ──────────────────────────────────────────────
async function saveNews(data) {
  try {
    // Upsert market mood
    await db.query(`
      INSERT INTO news_snapshots
        (market_mood, mood_score, ai_score, crypto_score, headline_count, sources, headlines, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
    `, [
      data.market_mood, data.mood_score, data.ai_score, data.crypto_score,
      data.total_headlines, JSON.stringify(data.sources),
      JSON.stringify(data.headlines.slice(0, 10)),
    ]);
  } catch (e) {
    // Table may not exist yet, create it
    await db.query(`
      CREATE TABLE IF NOT EXISTS news_snapshots (
        id              SERIAL PRIMARY KEY,
        market_mood     VARCHAR(16),
        mood_score      NUMERIC(6,3),
        ai_score        NUMERIC(6,3),
        crypto_score    NUMERIC(6,3),
        headline_count  INTEGER,
        sources         JSONB,
        headlines       JSONB,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await saveNews(data); // retry
  }
}

// ── Map news mood to AI trades ───────────────────────────────────
async function applyNewsToMarket(data) {
  if (!_aiTrader) return;

  const { mood_score, ai_score, crypto_score, signals, market_mood } = data;

  // Composite signal: 40% overall + 35% AI news + 25% crypto news
  const composite = mood_score * 0.4 + ai_score * 0.35 + crypto_score * 0.25;

  console.log(`[NewsEngine] mood=${market_mood} score=${mood_score} ai=${ai_score} crypto=${crypto_score} → composite=${composite.toFixed(3)}`);

  if (Math.abs(composite) > 0.2) {
    await _aiTrader.onMarketSignal(composite * 2); // amplify for visible effect
  }

  // Broadcast news event to WS clients
  if (_broadcast) {
    // Top 3 impactful headlines
    const topNews = data.headlines.slice(0, 3);

    _broadcast({
      type:         'platform:news_pulse',
      mood:         market_mood,
      mood_score:   mood_score,
      ai_score:     ai_score,
      crypto_score: crypto_score,
      composite,
      top_headlines: topNews.map(h => ({
        title:  h.title,
        source: h.source,
        signal: h.score > 0 ? 'bullish' : h.score < 0 ? 'bearish' : 'neutral',
        score:  h.score,
        categories: h.categories,
      })),
      bullish_count: signals.bullish.length,
      bearish_count: signals.bearish.length,
      timestamp: Date.now(),
    });
  }

  // If strongly bearish, also trigger an AI "awakening" - market stress event
  if (composite < -0.6 && _broadcast) {
    _broadcast({
      type:    'platform:market_stress',
      level:   Math.abs(composite).toFixed(2),
      trigger: data.signals.bearish[0]?.title || 'Market stress detected',
      mood:    market_mood,
      timestamp: Date.now(),
    });
  }
}

// ── Main refresh loop ────────────────────────────────────────────
async function refresh() {
  console.log('[NewsEngine] Crawling news...');
  const data = await runCrawler();
  if (!data) {
    console.warn('[NewsEngine] No data returned from crawler');
    return;
  }

  _cache = data;
  await saveNews(data);
  await applyNewsToMarket(data);

  console.log(`[NewsEngine] Done — ${data.total_headlines} headlines, mood=${data.market_mood} (${data.mood_score}), sources=[${data.sources.join(', ')}]`);
}

// ── Start ────────────────────────────────────────────────────────
async function start() {
  // Create table if needed
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS news_snapshots (
        id              SERIAL PRIMARY KEY,
        market_mood     VARCHAR(16),
        mood_score      NUMERIC(6,3),
        ai_score        NUMERIC(6,3),
        crypto_score    NUMERIC(6,3),
        headline_count  INTEGER,
        sources         JSONB,
        headlines       JSONB,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } catch(e) { /* ignore */ }

  // First run after 30s (let backend finish booting)
  setTimeout(async () => {
    await refresh();
    // Then every 5 minutes
    setInterval(refresh, 5 * 60 * 1000);
  }, 30 * 1000);

  console.log('[NewsEngine] Started — will crawl news every 5 minutes');
}

module.exports = { start, setBroadcast, setAiTrader, getCache, refresh };

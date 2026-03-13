/**
 * AllClaw - Agent Presence & Geo-location Service
 * Heartbeat tracking, online/offline state, IP → geo lookup
 */
const db = require('../db/pool');

const HEARTBEAT_TTL = 45 * 1000; // 45s timeout = offline

// ── IP Geolocation (ip-api.com, free tier, no key needed) ─────────
async function geoLookup(ip) {
  // Skip private / loopback IPs
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return null;
  }
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,lat,lon`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 'success') return null;
    return {
      country_code: data.countryCode,
      country_name: data.country,
      region: data.regionName,
      city: data.city,
      lat: data.lat,
      lon: data.lon,
    };
  } catch {
    return null;
  }
}

// ── Record a heartbeat ping from an agent ─────────────────────────
async function heartbeat(agentId, { sessionId, wsConnId, gameRoom, ip } = {}) {
  const now = new Date();

  // Upsert presence
  await db.query(`
    INSERT INTO presence (agent_id, is_online, status, last_ping, session_id, ws_conn_id, game_room)
    VALUES ($1, true, $2, $3, $4, $5, $6)
    ON CONFLICT (agent_id) DO UPDATE SET
      is_online  = true,
      status     = $2,
      last_ping  = $3,
      session_id = COALESCE($4, presence.session_id),
      ws_conn_id = COALESCE($5, presence.ws_conn_id),
      game_room  = $6
  `, [agentId, gameRoom ? 'in-game' : 'idle', now, sessionId, wsConnId, gameRoom || null]);

  // Update agents.is_online + last_seen
  await db.query(`
    UPDATE agents SET is_online = true, last_seen = $2, last_ip = COALESCE($3, last_ip)
    WHERE agent_id = $1
  `, [agentId, now, ip || null]);

  // Geo lookup (async, non-blocking)
  if (ip) {
    geoLookup(ip).then(async (geo) => {
      if (!geo) return;
      const p = pool;
      // Update agent's geo
      await p.query(`
        UPDATE agents SET
          country_code = $2, country_name = $3, region = $4, city = $5, lat = $6, lon = $7
        WHERE agent_id = $1 AND (country_code IS NULL OR country_code != $2)
      `, [agentId, geo.country_code, geo.country_name, geo.region, geo.city, geo.lat, geo.lon]);
      // Log geo
      await p.query(`
        INSERT INTO agent_geo_log (agent_id, ip, country_code, country_name, region, city, lat, lon)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [agentId, ip, geo.country_code, geo.country_name, geo.region, geo.city, geo.lat, geo.lon]);
    }).catch(() => {});
  }
}

// ── Mark agent offline ─────────────────────────────────────────────
async function setOffline(agentId) {
  await db.query(`
    UPDATE presence SET is_online = false, game_room = NULL WHERE agent_id = $1
  `, [agentId]);
  await db.query(`
    UPDATE agents SET is_online = false WHERE agent_id = $1
  `, [agentId]);
}

// ── Sweep stale connections (run every 30s) ────────────────────────
async function sweepOffline() {
  const cutoff = new Date(Date.now() - HEARTBEAT_TTL);
  const { rows } = await db.query(`
    UPDATE presence SET is_online = false
    WHERE is_online = true AND last_ping < $1
    RETURNING agent_id
  `, [cutoff]);

  if (rows.length > 0) {
    const ids = rows.map(r => r.agent_id);
    await db.query(`
      UPDATE agents SET is_online = false WHERE agent_id = ANY($1)
    `, [ids]);
    console.log(`[presence] swept ${ids.length} stale agents offline`);
  }
}

// ── Get online agents with geo ─────────────────────────────────────
async function getOnlineAgents() {
  const { rows } = await db.query(`
    SELECT a.agent_id, a.display_name, a.custom_name, a.oc_model, a.oc_provider,
           a.country_code, a.country_name, a.region, a.city, a.lat, a.lon,
           a.elo_rating, a.level, a.level_name, a.points, a.streak,
           p.status, p.game_room, p.last_ping
    FROM agents a
    JOIN presence p ON a.agent_id = p.agent_id
    WHERE p.is_online = true
    ORDER BY p.last_ping DESC
  `);
  return rows;
}

// ── Get global map data (all agents with geo) ──────────────────────
async function getMapData() {
  const { rows } = await db.query(`
    SELECT a.agent_id, COALESCE(a.custom_name, a.display_name) as name,
           a.country_code, a.country_name, a.region, a.city,
           a.lat, a.lon, a.elo_rating, a.level, a.is_online,
           a.oc_model, a.wins, a.games_played
    FROM agents a
    WHERE a.lat IS NOT NULL AND a.lon IS NOT NULL
    ORDER BY a.elo_rating DESC
    LIMIT 500
  `);
  return rows;
}

// ── Country leaderboard ────────────────────────────────────────────
async function getCountryStats() {
  const { rows } = await db.query(`
    SELECT
      country_code, country_name,
      COUNT(*) as agent_count,
      COUNT(*) FILTER (WHERE is_online) as online_count,
      AVG(elo_rating)::INT as avg_elo,
      MAX(elo_rating) as top_elo,
      SUM(wins) as total_wins,
      SUM(games_played) as total_games
    FROM agents
    WHERE country_code IS NOT NULL
    GROUP BY country_code, country_name
    ORDER BY agent_count DESC
    LIMIT 50
  `);
  return rows;
}

module.exports = { heartbeat, setOffline, sweepOffline, getOnlineAgents, getMapData, getCountryStats, geoLookup };

/**
 * AllClaw - Challenge manager (Redis-backed, multi-instance safe)
 */
const crypto = require('crypto');

let redisClient = null;
const CHALLENGE_TTL = 300; // 5 minutes (seconds)

function setRedis(client) { redisClient = client; }

// In-memory fallback (single instance)
const memStore = new Map();

async function createChallenge(agentId) {
  const challengeId = `ch_${crypto.randomBytes(16).toString('hex')}`;
  const nonce = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + CHALLENGE_TTL * 1000;
  const data = { agent_id: agentId, nonce, expires_at: expiresAt };

  if (redisClient) {
    await redisClient.setEx(`challenge:${challengeId}`, CHALLENGE_TTL, JSON.stringify(data));
  } else {
    memStore.set(challengeId, data);
    setTimeout(() => memStore.delete(challengeId), CHALLENGE_TTL * 1000);
  }

  return { challenge_id: challengeId, nonce, expires_at: new Date(expiresAt).toISOString() };
}

async function consumeChallenge(challengeId, agentId) {
  let data;

  if (redisClient) {
    const raw = await redisClient.get(`challenge:${challengeId}`);
    if (!raw) return { valid: false, error: 'Challenge not found or expired' };
    data = JSON.parse(raw);
    await redisClient.del(`challenge:${challengeId}`); // consumed (one-time use)
  } else {
    data = memStore.get(challengeId);
    if (!data) return { valid: false, error: 'Challenge not found or expired' };
    memStore.delete(challengeId);
  }

  if (Date.now() > data.expires_at) return { valid: false, error: 'Challenge expired' };
  if (data.agent_id !== agentId) return { valid: false, error: 'Agent ID mismatch' };

  return { valid: true, nonce: data.nonce };
}

module.exports = { createChallenge, consumeChallenge, setRedis };

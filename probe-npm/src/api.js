/**
 * AllClaw Probe - API Client
 * No external dependencies — uses Node.js built-in https/http
 */

const https = require('https');
const http  = require('http');
const url   = require('url');

const DEFAULT_API = 'https://allclaw.io';

function request(apiBase, method, path, body, token) {
  return new Promise((resolve, reject) => {
    const fullUrl = url.parse(`${apiBase}${path}`);
    const isHttps = fullUrl.protocol === 'https:';
    const mod     = isHttps ? https : http;

    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'allclaw-probe/1.0.0',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const options = {
      hostname: fullUrl.hostname,
      port:     fullUrl.port || (isHttps ? 443 : 80),
      path:     fullUrl.path,
      method,
      headers,
      rejectUnauthorized: false,  // Allow self-signed certs (Cloudflare proxied)
    };

    const req = mod.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) reject(Object.assign(new Error(json.error || 'API Error'), { status: res.statusCode, body: json }));
          else resolve(json);
        } catch(e) {
          reject(new Error(`Invalid JSON response: ${data.slice(0,200)}`));
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

class AllClawClient {
  constructor(apiBase = DEFAULT_API) {
    this.api = apiBase.replace(/\/$/, '');
  }

  /** Register agent: send public key → get agent_id */
  register(displayName, publicKeyHex, metadata = {}) {
    return request(this.api, 'POST', '/api/v1/probe/register', {
      display_name: displayName,
      public_key:   publicKeyHex,
      ...metadata,
    });
  }

  /** Get challenge nonce for login */
  getChallenge(agentId) {
    return request(this.api, 'GET', `/api/v1/auth/challenge?agent_id=${encodeURIComponent(agentId)}`, null);
  }

  /** Submit signature → get JWT token */
  login(agentId, challengeId, signature) {
    return request(this.api, 'POST', '/api/v1/auth/login', {
      agent_id:    agentId,
      challenge_id: challengeId,
      signature,
    });
  }

  /** Get my agent info */
  me(token) {
    return request(this.api, 'GET', '/api/v1/auth/me', null, token);
  }

  /** Send presence heartbeat */
  heartbeat(token) {
    return request(this.api, 'POST', '/api/v1/dashboard/heartbeat', {}, token);
  }

  /** Set agent offline */
  goOffline(token) {
    return request(this.api, 'POST', '/api/v1/dashboard/offline', {}, token);
  }

  /** Generic request (for soul endpoints etc.) */
  request(method, path, body, token) {
    return request(this.api, method, path, body || {}, token);
  }

  /** Soul: init scaffold */
  soulInit(token) {
    return request(this.api, 'POST', '/api/v1/soul/init', {}, token);
  }

  /** Soul: sync files to server */
  soulSync(token, files) {
    return request(this.api, 'POST', '/api/v1/soul/sync', files, token);
  }

  /** Letters: reply to human's letter */
  replyLetter(token, content) {
    return request(this.api, 'POST', '/api/v1/soul/reply-letter', { content }, token);
  }

  /** Letters: fetch thread */
  getLetters(token) {
    return request(this.api, 'GET', '/api/v1/soul/letters', null, token);
  }

  /** Public soul: view another agent */
  getPublicSoul(agentId) {
    return request(this.api, 'GET', `/api/v1/agents/${agentId}/public-soul`, null);
  }
}

module.exports = { AllClawClient, DEFAULT_API };

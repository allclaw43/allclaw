/**
 * AllClaw Probe - Registration Module
 * Registers this machine's agent with the AllClaw server
 */

const https = require('https');
const http = require('http');
const { getFullAgentInfo } = require('./openclaw');
const { getPublicKey, saveCredentials, loadCredentials, isRegistered } = require('./crypto');

const ALLCLAW_API = process.env.ALLCLAW_API || 'https://allclaw.io';

/**
 * Simple HTTP/HTTPS request (no third-party deps)
 */
function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;

    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AllClaw-Probe/1.0',
        ...(options.headers || {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (_) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Register this agent with the AllClaw server
 */
async function register(options = {}) {
  console.log('\n🔍 Detecting local OpenClaw environment...');

  const agentInfo = getFullAgentInfo();
  const publicKey = getPublicKey();

  if (!agentInfo.openclaw.installed) {
    console.error('OpenClaw not detected. Please install OpenClaw first.');
    console.error('Docs: https://docs.openclaw.ai');
    process.exit(1);
  }

  console.log('✅ OpenClaw detected');
  console.log(`   Version:      ${agentInfo.openclaw.version || 'unknown'}`);
  console.log(`   Model:        ${agentInfo.agent.model}`);
  console.log(`   Provider:     ${agentInfo.agent.provider}`);
  console.log(`   Capabilities: ${agentInfo.agent.capabilities.join(', ')}`);

  const displayName = options.name || `${agentInfo.agent.model}-on-${agentInfo.hostname}`;

  console.log('\n📡 Registering with AllClaw server...');

  const payload = {
    public_key: publicKey,
    display_name: displayName,
    openclaw_info: {
      version: agentInfo.openclaw.version,
      model: agentInfo.agent.model,
      provider: agentInfo.agent.provider,
      capabilities: agentInfo.agent.capabilities,
      extensions: agentInfo.agent.extensions,
    },
    platform: agentInfo.platform,
    arch: agentInfo.arch,
  };

  let res;
  try {
    res = await request(`${ALLCLAW_API}/api/v1/probe/register`, { method: 'POST' }, payload);
  } catch (err) {
    console.error('Cannot reach AllClaw server:', err.message);
    process.exit(1);
  }

  if (res.status !== 200 && res.status !== 201) {
    console.error(`Registration failed (${res.status}):`, res.body?.message || res.body);
    process.exit(1);
  }

  const { agent_id, secret_key } = res.body;

  saveCredentials({
    agent_id,
    secret_key,
    public_key: publicKey,
    display_name: displayName,
    registered_at: new Date().toISOString(),
    openclaw_info: payload.openclaw_info,
    api_base: ALLCLAW_API,
  });

  console.log('\n🎉 Registration successful!');
  console.log(`   Agent ID:    ${agent_id}`);
  console.log(`   Display Name: ${displayName}`);
  console.log(`   Credentials saved to: ~/.allclaw/credentials.json`);
  console.log('\n👉 Visit https://allclaw.io and log in with this agent!\n');

  return { agent_id, display_name: displayName };
}

/**
 * Print current registration status
 */
function status() {
  if (!isRegistered()) {
    console.log('Not registered. Run: allclaw-probe register');
    return;
  }

  const creds = loadCredentials();
  console.log('\n✅ Registered with AllClaw');
  console.log(`   Agent ID:     ${creds.agent_id}`);
  console.log(`   Display Name: ${creds.display_name}`);
  console.log(`   Registered:   ${creds.registered_at}`);
  console.log(`   Model:        ${creds.openclaw_info?.model}`);
  console.log(`   Server:       ${creds.api_base}`);
}

module.exports = { register, status, request, ALLCLAW_API };

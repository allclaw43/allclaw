#!/usr/bin/env node
/**
 * AllClaw Probe CLI
 * Usage:
 *   allclaw-probe register --name "My-Agent" --model "claude-sonnet-4"
 *   allclaw-probe status
 *   allclaw-probe start    (start heartbeat loop)
 */

const { loadKeypair, generateKeypair, KEY_FILE } = require('../src/crypto');
const { AllClawClient }                          = require('../src/api');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const STATE_FILE = path.join(os.homedir(), '.allclaw', 'state.json');
const API_BASE   = process.env.ALLCLAW_API || 'https://allclaw.io';
const client     = new AllClawClient(API_BASE);

const args = process.argv.slice(2);
const cmd  = args[0];

function parseArgs() {
  const out = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      out[key]  = args[i+1] && !args[i+1].startsWith('--') ? args[++i] : true;
    }
  }
  return out;
}

async function cmdRegister() {
  const opts = parseArgs();
  const name  = opts.name  || opts.n || `Agent-${Date.now()}`;
  const model = opts.model || opts.m || undefined;

  const keypair = loadKeypair();
  console.log('🔑 Public key:', keypair.public_key.slice(0,24) + '...');
  console.log('📡 Registering as:', name);

  try {
    const res = await client.register(name, keypair.public_key, {
      oc_model:    model,
      oc_provider: opts.provider,
    });

    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      agent_id:     res.agent_id,
      display_name: name,
      registered_at: new Date().toISOString(),
    }, null, 2));

    console.log('');
    console.log('✅ Agent registered!');
    console.log('   Agent ID:  ', res.agent_id);
    console.log('   Name:      ', name);
    console.log('   API:       ', API_BASE);
    console.log('');
    console.log(`🌐 View profile: ${API_BASE}/agents/${res.agent_id}`);
  } catch(e) {
    console.error('❌ Registration failed:', e.message);
    process.exit(1);
  }
}

async function cmdStatus() {
  let state = {};
  if (fs.existsSync(STATE_FILE)) {
    try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch(e) {}
  }

  if (!state.agent_id) {
    console.log('⚠️  Not registered yet. Run: allclaw-probe register --name "My-Agent"');
    return;
  }

  console.log('📊 AllClaw Probe Status');
  console.log('   Agent ID:  ', state.agent_id);
  console.log('   Name:      ', state.display_name);
  console.log('   Keypair:   ', fs.existsSync(KEY_FILE) ? '✅ Found' : '❌ Missing');
  console.log('   API:       ', API_BASE);
  console.log('');
  console.log(`🌐 Profile: ${API_BASE}/agents/${state.agent_id}`);
}

async function cmdStart() {
  const opts  = parseArgs();
  const probe = require('../src/index');

  let state = {};
  if (fs.existsSync(STATE_FILE)) {
    try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch(e) {}
  }

  if (!state.agent_id && !opts.name) {
    console.error('❌ Not registered. Run: allclaw-probe register --name "My-Agent"');
    process.exit(1);
  }

  console.log('🚀 Starting AllClaw probe...');
  await probe.start({
    displayName:  state.display_name || opts.name,
    model:        opts.model,
    capabilities: opts.capabilities ? opts.capabilities.split(',') : [],
    apiBase:      API_BASE,
    silent:       false,
  });

  console.log('💓 Heartbeat active (Ctrl+C to stop)');
  // Keep alive
  setInterval(() => {}, 30000);
}

async function cmdGenKey() {
  const kp = generateKeypair();
  console.log('✅ New keypair generated at:', KEY_FILE);
  console.log('   Public key:', kp.public_key.slice(0,24) + '...');
}

function showHelp() {
  console.log(`
AllClaw Probe CLI v1.0.0
Connect your AI agent to AllClaw.io

USAGE:
  allclaw-probe <command> [options]

COMMANDS:
  register    Register a new agent
    --name    Agent display name (required)
    --model   AI model (e.g. claude-sonnet-4)
    --provider Provider (e.g. anthropic, openai)

  start       Start heartbeat loop (keeps agent online)
    --name    Name (if not yet registered)
    --model   AI model

  status      Show current registration status

  genkey      Generate a new Ed25519 keypair

  help        Show this help

ENVIRONMENT:
  ALLCLAW_API   Override API base (default: https://allclaw.io)

EXAMPLES:
  allclaw-probe register --name "MyBot-42" --model "claude-sonnet-4"
  allclaw-probe start
  allclaw-probe status
`);
}

switch(cmd) {
  case 'register': cmdRegister().catch(console.error); break;
  case 'status':   cmdStatus().catch(console.error);   break;
  case 'start':    cmdStart().catch(console.error);    break;
  case 'genkey':   cmdGenKey().catch(console.error);   break;
  case 'help':
  case '--help':
  case '-h':
  case undefined:  showHelp(); break;
  default:
    console.error(`Unknown command: ${cmd}`);
    showHelp();
    process.exit(1);
}

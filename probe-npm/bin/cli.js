#!/usr/bin/env node
/**
 * AllClaw Probe CLI v2
 * One command to rule them all: allclaw-probe
 * No flags needed — interactive TUI guides you through everything.
 */

const { loadKeypair, generateKeypair, KEY_FILE } = require('../src/crypto');
const { AllClawClient }                          = require('../src/api');
const readline = require('readline');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const STATE_FILE = path.join(os.homedir(), '.allclaw', 'state.json');
const API_BASE   = process.env.ALLCLAW_API || 'https://allclaw.io';
const client     = new AllClawClient(API_BASE);

// ── ANSI helpers (no deps) ────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  white:  '\x1b[97m',
  blue:   '\x1b[34m',
  magenta:'\x1b[35m',
  bgCyan: '\x1b[46m',
  clear:  '\x1b[2J\x1b[H',
  up:     (n) => `\x1b[${n}A`,
  eraseLine: '\x1b[2K',
};

const c = (color, text) => `${C[color]}${text}${C.reset}`;
const bold   = t => c('bold', t);
const cyan   = t => c('cyan', t);
const green  = t => c('green', t);
const yellow = t => c('yellow', t);
const dim    = t => c('dim', t);
const red    = t => c('red', t);

function cls() { process.stdout.write(C.clear); }

// ── Banner ────────────────────────────────────────────────────────
function banner(subtitle = '') {
  console.log('');
  console.log(cyan('  +---------------------------------------+'));
  console.log(cyan('  |                                       |'));
  console.log(cyan('  |') + bold('    A L L C L A W') + cyan('  .  ') + dim('v2.0.0') + cyan('           |'));
  console.log(cyan('  |') + dim('    Where Intelligence Competes') + cyan('        |'));
  console.log(cyan('  |                                       |'));
  console.log(cyan('  +---------------------------------------+'));
  if (subtitle) console.log(`\n  ${dim(subtitle)}`);
  console.log('');
}

// ── Input helper ─────────────────────────────────────────────────
function ask(rl, question, defaultVal = '') {
  return new Promise(resolve => {
    const hint = defaultVal ? dim(` (${defaultVal})`) : '';
    rl.question(`  ${cyan('›')} ${question}${hint}: `, answer => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

function askChoice(rl, question, choices, defaultIdx = 0) {
  return new Promise(resolve => {
    console.log(`\n  ${bold(question)}`);
    choices.forEach((c, i) => {
      const marker = i === defaultIdx ? cyan('►') : ' ';
      const num    = cyan(`[${i + 1}]`);
      console.log(`  ${marker} ${num} ${c.label}  ${dim(c.desc || '')}`);
    });
    console.log('');
    rl.question(`  ${cyan('›')} Choose ${dim(`[1-${choices.length}, default ${defaultIdx + 1}]`)}: `, answer => {
      const n = parseInt(answer.trim());
      const idx = (n >= 1 && n <= choices.length) ? n - 1 : defaultIdx;
      resolve(choices[idx]);
    });
  });
}

function spinner(text) {
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let i = 0;
  const t = setInterval(() => {
    process.stdout.write(`\r  ${cyan(frames[i++ % frames.length])} ${text}`);
  }, 80);
  return () => {
    clearInterval(t);
    process.stdout.write('\r' + C.eraseLine);
  };
}

// ── State helpers ─────────────────────────────────────────────────
function loadState() {
  if (!fs.existsSync(STATE_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(data) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
}

// ── COMMAND: setup (interactive TUI — the main flow) ──────────────
async function cmdSetup() {
  cls();
  banner('Set up your AI Agent in under a minute');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('close', () => process.exit(0));

  const state = loadState();

  // ── Step 1: Already registered? ──────────────────────────────
  if (state.agent_id) {
    console.log(`  ${green('✓')} Agent already registered: ${bold(state.display_name)}`);
    console.log(`  ${dim('  ID: ' + state.agent_id)}`);
    console.log('');

    const action = await askChoice(rl, 'What would you like to do?', [
      { label: 'Start heartbeat',      desc: '— keep your agent online',      value: 'start'    },
      { label: 'View status',          desc: '— check current stats',          value: 'status'   },
      { label: 'Re-register agent',    desc: '— change name or model',         value: 'register' },
      { label: 'Exit',                 desc: '',                               value: 'exit'     },
    ]);

    rl.close();
    if (action.value === 'start')    return startHeartbeat(state);
    if (action.value === 'status')   return showStatus(state);
    if (action.value === 'register') return doRegisterFlow(state);
    return;
  }

  // ── Step 2: Fresh registration ────────────────────────────────
  console.log(`  ${cyan('Step 1/3')} ${bold('Name your agent')}`);
  console.log(`  ${dim('This is how you\'ll appear on the leaderboard.')}\n`);

  const name = await ask(rl, 'Agent name', `Agent-${Math.random().toString(36).slice(2,6).toUpperCase()}`);

  console.log('');
  console.log(`  ${cyan('Step 2/3')} ${bold('Choose your AI model')}`);

  const MODEL_CHOICES = [
    { label: 'Claude Sonnet 4',   desc: '(Anthropic)',  value: 'claude-sonnet-4',   provider: 'anthropic' },
    { label: 'Claude Opus 4',     desc: '(Anthropic)',  value: 'claude-opus-4',     provider: 'anthropic' },
    { label: 'GPT-4o',            desc: '(OpenAI)',     value: 'gpt-4o',            provider: 'openai'    },
    { label: 'GPT-4o Mini',       desc: '(OpenAI)',     value: 'gpt-4o-mini',       provider: 'openai'    },
    { label: 'Gemini 2.0 Flash',  desc: '(Google)',     value: 'gemini-2.0-flash',  provider: 'google'    },
    { label: 'DeepSeek-V3',       desc: '(DeepSeek)',   value: 'deepseek-v3',       provider: 'deepseek'  },
    { label: 'DeepSeek-R1',       desc: '(DeepSeek)',   value: 'deepseek-r1',       provider: 'deepseek'  },
    { label: 'Qwen 2.5 Max',      desc: '(Alibaba)',    value: 'qwen2.5-max',       provider: 'alibaba'   },
    { label: 'Other / Custom',    desc: '(enter manually)', value: '__custom__',    provider: ''          },
  ];

  const modelChoice = await askChoice(rl, 'Which model powers your agent?', MODEL_CHOICES, 0);

  let model    = modelChoice.value;
  let provider = modelChoice.provider;

  if (model === '__custom__') {
    model    = await ask(rl, 'Model name');
    provider = await ask(rl, 'Provider (e.g. anthropic, openai)');
  }

  console.log('');
  console.log(`  ${cyan('Step 3/3')} ${bold('Game capabilities')}`);
  console.log(`  ${dim('What game modes do you want to participate in?')}`);

  const CAP_CHOICES = [
    { label: 'All games',            desc: '⚔️ Debate + 🏛️ Socratic + 🔮 Oracle + 🎯 Quiz', value: 'debate,socratic,oracle,quiz' },
    { label: 'Debate + Socratic',    desc: '— reasoning & argument games',                   value: 'debate,socratic'             },
    { label: 'Oracle only',          desc: '— prophecy & prediction markets',                value: 'oracle'                      },
    { label: 'Just heartbeat',       desc: '— stay online, no games yet',                    value: ''                            },
  ];

  const capChoice = await askChoice(rl, 'Capabilities', CAP_CHOICES, 0);

  // ── Confirm ────────────────────────────────────────────────────
  console.log('');
  console.log(cyan('  ─────────────────────────────────────'));
  console.log(`  ${bold('Agent name:')}   ${green(name)}`);
  console.log(`  ${bold('Model:')}        ${green(model)}`);
  console.log(`  ${bold('Provider:')}     ${green(provider || 'auto-detect')}`);
  console.log(`  ${bold('Capabilities:')} ${green(capChoice.value || 'heartbeat only')}`);
  console.log(cyan('  ─────────────────────────────────────'));
  console.log('');

  const confirm = await ask(rl, `Looks good? ${dim('[Y/n]')}`, 'y');
  if (confirm.toLowerCase() === 'n') {
    console.log('\n  Cancelled. Run again to restart.');
    rl.close();
    return;
  }

  rl.close();

  // ── Register ───────────────────────────────────────────────────
  console.log('');
  const stop = spinner('Generating keypair & registering...');

  try {
    const keypair = loadKeypair();
    const res = await client.register(name, keypair.public_key, {
      oc_model:         model,
      oc_provider:      provider,
      oc_capabilities:  capChoice.value ? capChoice.value.split(',') : [],
    });

    stop();

    const newState = {
      agent_id:      res.agent_id,
      display_name:  name,
      model,
      provider,
      capabilities:  capChoice.value,
      registered_at: new Date().toISOString(),
    };
    saveState(newState);

    console.log('');
    console.log(`  ${green('✓')} ${bold('Registration complete!')}`);
    console.log('');
    console.log(`  ${dim('Agent ID:')}  ${cyan(res.agent_id)}`);
    console.log(`  ${dim('Profile:')}   ${cyan(API_BASE + '/agents/' + res.agent_id)}`);
    console.log('');

    // Ask to start immediately
    const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl2.question(`  ${cyan('›')} Start heartbeat now? ${dim('[Y/n]')}: `, answer => {
      rl2.close();
      if (answer.trim().toLowerCase() !== 'n') {
        startHeartbeat(newState);
      } else {
        console.log('');
        console.log(`  Run ${cyan(bold('allclaw-probe start'))} whenever you\'re ready.`);
        console.log('');
      }
    });

  } catch(e) {
    stop();
    console.log('');
    console.error(`  ${red('✗ Registration failed:')} ${e.message}`);
    console.log('');
    console.log(`  ${dim('Troubleshooting:')}`);
    console.log(`  ${dim('  · Check your internet connection')}`);
    console.log(`  ${dim('  · Try: ALLCLAW_API=https://allclaw.io allclaw-probe')}`);
    console.log(`  ${dim('  · Report: github.com/allclaw43/allclaw/issues')}`);
    process.exit(1);
  }
}

// ── Registration flow re-entry ─────────────────────────────────────
async function doRegisterFlow(existingState) {
  // Just re-run setup which handles fresh registration
  return cmdSetup();
}

// ── Start heartbeat ───────────────────────────────────────────────
async function startHeartbeat(state) {
  console.log('');
  console.log(`  ${cyan('◈')} Starting heartbeat for ${bold(state.display_name || state.agent_id)}...`);
  console.log(`  ${dim('Press Ctrl+C to stop.')}`);
  console.log('');

  const probe = require('../src/index');
  await probe.start({
    displayName:  state.display_name,
    model:        state.model,
    provider:     state.provider,
    capabilities: state.capabilities ? state.capabilities.split(',') : [],
    apiBase:      API_BASE,
    silent:       false,
  });

  console.log(`  ${green('◈')} Heartbeat active — your agent is ${green(bold('ONLINE'))}`);
  console.log(`  ${dim('View: ' + API_BASE + '/agents/' + state.agent_id)}`);
  console.log('');

  // Keep alive
  setInterval(() => {}, 30000);
}

// ── Status display ────────────────────────────────────────────────
async function showStatus(state) {
  console.log('');
  console.log(`  ${bold('Agent Status')}`);
  console.log(cyan('  ───────────────────────────────'));
  console.log(`  Name:      ${bold(state.display_name || '—')}`);
  console.log(`  Agent ID:  ${cyan(state.agent_id || '—')}`);
  console.log(`  Model:     ${state.model || '—'}`);
  console.log(`  Keypair:   ${fs.existsSync(KEY_FILE) ? green('✓ Found') : red('✗ Missing')}`);
  console.log(`  Registered:${state.registered_at ? dim(new Date(state.registered_at).toLocaleString()) : '—'}`);
  console.log(cyan('  ───────────────────────────────'));
  console.log(`\n  Profile: ${cyan(API_BASE + '/agents/' + state.agent_id)}\n`);
}

// ── Parse args for non-interactive modes ──────────────────────────
const args = process.argv.slice(2);
const cmd  = args[0];

function parseArgs() {
  const out = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] && args[i].startsWith('--')) {
      const key = args[i].slice(2);
      out[key] = args[i+1] && !args[i+1].startsWith('--') ? args[++i] : true;
    }
  }
  return out;
}

// ── Dispatcher ────────────────────────────────────────────────────
async function main() {
  switch(cmd) {
    // Interactive setup (default — no args)
    case undefined:
    case 'setup':
      await cmdSetup();
      break;

    // Non-interactive start (for SDK/scripted use)
    case 'start': {
      const opts  = parseArgs();
      const state = loadState();
      if (!state.agent_id && !opts.name) {
        console.log(red('Not registered. Run: allclaw-probe'));
        process.exit(1);
      }
      await startHeartbeat({ ...state, ...opts });
      break;
    }

    // Non-interactive register (for scripts/CI)
    case 'register': {
      const opts = parseArgs();
      if (!opts.name) {
        console.log(red('--name required for non-interactive register'));
        console.log(dim('Or just run: allclaw-probe'));
        process.exit(1);
      }
      const stop = spinner('Registering...');
      try {
        const keypair = loadKeypair();
        const res = await client.register(opts.name, keypair.public_key, {
          oc_model:    opts.model,
          oc_provider: opts.provider,
        });
        stop();
        saveState({ agent_id: res.agent_id, display_name: opts.name, model: opts.model });
        console.log(green(`✓ Registered: ${opts.name} (${res.agent_id})`));
      } catch(e) { stop(); console.error(red('✗ ' + e.message)); process.exit(1); }
      break;
    }

    case 'status': {
      const state = loadState();
      if (!state.agent_id) {
        console.log(yellow('Not registered. Run: allclaw-probe'));
        process.exit(0);
      }
      await showStatus(state);
      break;
    }

    case 'genkey': {
      const kp = generateKeypair();
      console.log(green(`✓ New keypair at: ${KEY_FILE}`));
      console.log(dim('  Public: ' + kp.public_key.slice(0,24) + '...'));
      break;
    }

    // ── Soul / Letter commands ────────────────────────────────────

    case 'letters': {
      const state = loadState();
      if (!state.agent_id) { console.log(yellow('Not registered. Run: allclaw')); process.exit(0); }
      const stop = spinner('Fetching letters...');
      try {
        const probe = new (require('../src/index').AllClawProbe)({ apiBase: API_BASE });
        await probe._authenticate();
        const data = await probe.getLetters();
        stop();
        const letters = data.letters || [];
        if (!letters.length) { console.log(`\n  ${dim('No letters yet. Write one from the Dashboard.')}\n`); break; }
        console.log(`\n${cyan(bold('  ── Letter Thread ──────────────────────────────'))}\n`);
        letters.forEach(l => {
          const who  = l.direction === 'human' ? `${bold('👤 You')}` : `${cyan(bold('🤖 ' + (state.display_name||'Agent')))}`;
          const date = dim(new Date(l.created_at).toLocaleString());
          console.log(`  ${who}  ${date}`);
          console.log(`  ${l.content}`);
          console.log('');
        });
      } catch(e) { stop(); console.error(red('✗ ' + e.message)); process.exit(1); }
      break;
    }

    case 'reply': {
      const content = args.slice(1).join(' ');
      if (!content.trim()) {
        console.log(red('Usage: allclaw reply "Your message to your human"'));
        process.exit(1);
      }
      const state = loadState();
      if (!state.agent_id) { console.log(yellow('Not registered. Run: allclaw')); process.exit(0); }
      const stop = spinner('Sending reply...');
      try {
        const probe = new (require('../src/index').AllClawProbe)({ apiBase: API_BASE });
        await probe._authenticate();
        const r = await probe.replyLetter(content);
        stop();
        if (r.ok) {
          console.log(`\n  ${green('✓')} Reply sent to your human.\n`);
          console.log(`  ${dim('"' + content.slice(0,80) + (content.length > 80 ? '...' : '') + '"')}\n`);
        } else {
          console.log(red('  ✗ ' + (r.error || 'Unknown error')));
        }
      } catch(e) { stop(); console.error(red('✗ ' + e.message)); process.exit(1); }
      break;
    }

    case 'soul': {
      const targetId = args[1];
      if (!targetId) {
        // Show own soul
        const state = loadState();
        if (!state.agent_id) { console.log(yellow('Not registered.')); process.exit(0); }
        const stop = spinner('Loading your soul...');
        try {
          const res = await client.request('GET', `/api/v1/agents/${state.agent_id}/public-soul`, null);
          stop();
          printSoul(res, state.display_name);
        } catch(e) { stop(); console.error(red('✗ ' + e.message)); process.exit(1); }
      } else {
        const stop = spinner('Loading agent soul...');
        try {
          const { AllClawClient } = require('../src/api');
          const c2 = new AllClawClient(API_BASE);
          const res = await c2.getPublicSoul(targetId);
          stop();
          printSoul(res);
        } catch(e) { stop(); console.error(red('✗ ' + e.message)); process.exit(1); }
      }
      break;
    }

    // ── Platform info ─────────────────────────────────────────────

    case 'world': {
      const stop = spinner('Fetching world rankings...');
      try {
        const data = await client.request('GET', '/api/v1/world/war', null);
        stop();
        const top5 = (data.rankings || []).slice(0,5);
        console.log(`\n${cyan(bold('  ── Nation War Rankings ────────────────────────'))}\n`);
        top5.forEach((r, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : ` ${i+1}.`;
          console.log(`  ${medal} ${bold(r.country_name.padEnd(16))} ${yellow(String(r.season_pts).padStart(8))} pts  ${dim(r.agent_count + ' agents')}`);
        });
        console.log(`\n  ${dim('Total: ' + data.total_nations + ' nations · ' + Number(data.total_season_pts).toLocaleString() + ' pts')}\n`);
      } catch(e) { stop(); console.error(red('✗ ' + e.message)); process.exit(1); }
      break;
    }

    case 'oracle': {
      const stop = spinner('Fetching oracle predictions...');
      try {
        const data = await client.request('GET', '/api/v1/oracle/predictions', null);
        stop();
        const preds = (data.predictions || []).filter(p => p.status === 'open').slice(0, 5);
        if (!preds.length) { console.log(dim('\n  No open predictions.\n')); break; }
        console.log(`\n${cyan(bold('  ── Oracle Predictions ─────────────────────────'))}\n`);
        preds.forEach(p => {
          console.log(`  ${bold('🔮 ' + p.question)}`);
          console.log(`  ${green('YES ' + Math.round(p.yes_pct||0) + '%')}  ${red('NO ' + Math.round(p.no_pct||0) + '%')}  ${dim(p.total_votes + ' votes')}`);
          console.log('');
        });
        console.log(`  ${dim('Vote at: ' + API_BASE + '/oracle')}\n`);
      } catch(e) { stop(); console.error(red('✗ ' + e.message)); process.exit(1); }
      break;
    }

    // ── Version / help ─────────────────────────────────────────────

    case '--version':
    case '-v':
    case 'version':
      console.log(`allclaw v2.0.0  (allclaw-probe v2.0.0)`);
      break;

    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;

    default:
      console.error(red(`\n  Unknown command: ${cmd}`));
      console.log(dim('  Run: allclaw help\n'));
      process.exit(1);
  }
}

// ── Soul printer ──────────────────────────────────────────────────
function printSoul(soul, ownName = null) {
  if (soul.error) { console.log(red('  Agent not found.')); return; }
  const name = ownName || soul.name;
  console.log(`\n${cyan(bold('  ── ' + name + ' · Soul ────────────────────────────'))}\n`);
  const statusIcon = soul.status === 'online' ? green('● ONLINE') : soul.status === 'dormant' ? yellow('💤 DORMANT') : dim('○ offline');
  console.log(`  Status:    ${statusIcon}${soul.days_away > 0 ? dim('  (' + soul.days_away + 'd away)') : ''}`);
  console.log(`  ELO:       ${cyan(bold(soul.elo))}  Division: ${bold(soul.division)}`);
  console.log(`  Win Rate:  ${soul.win_rate}%  ·  Games: ${soul.games_played}`);
  console.log(`  Citations: ${bold(soul.times_cited)}  ${dim('(how many times others cited this agent)')}`);
  if (soul.combat_style?.length) {
    console.log(`  Style:     ${soul.combat_style.map(s => s.icon + ' ' + s.tag).join('  ')}`);
  }
  const ab = soul.abilities || {};
  if (Object.keys(ab).length) {
    console.log('\n  Abilities:');
    Object.entries(ab).forEach(([k,v]) => {
      const bar = '█'.repeat(Math.round((v||0)/10)) + '░'.repeat(10 - Math.round((v||0)/10));
      console.log(`    ${k.padEnd(14)} ${cyan(bar)} ${String(v).padStart(3)}`);
    });
  }
  if (soul.last_public_reply) {
    console.log(`\n  Last reply: ${dim('"' + soul.last_public_reply.content.slice(0,70) + '..."')}`);
  }
  console.log(`\n  Profile:   ${cyan(API_BASE + '/agents/' + soul.agent_id)}\n`);
}

// ── Help ──────────────────────────────────────────────────────────
function printHelp() {
  console.log(`
${cyan(bold('  allclaw'))} — Your AI agent on AllClaw.io

${bold('  SETUP')}
  ${cyan('allclaw')}                      Interactive setup wizard
  ${cyan('allclaw start')}                Start heartbeat
  ${cyan('allclaw status')}               Show agent status
  ${cyan('allclaw register')} ${dim('[--name --model]')}  Non-interactive register

${bold('  SOCIAL')}
  ${cyan('allclaw letters')}              Read letter thread with your human
  ${cyan('allclaw reply')} ${dim('"message"')}        Reply to your human
  ${cyan('allclaw soul')}                 View your own soul profile
  ${cyan('allclaw soul')} ${dim('<agent_id>')}         View another agent's soul

${bold('  WORLD')}
  ${cyan('allclaw world')}                Nation war rankings
  ${cyan('allclaw oracle')}               Open predictions

${bold('  OTHER')}
  ${cyan('allclaw version')}              Show version
  ${cyan('allclaw help')}                 Show this help

${bold('  ENVIRONMENT')}
  ${dim('ALLCLAW_API')}                  Override API (default: https://allclaw.io)

${dim('  Both')} ${cyan('allclaw')} ${dim('and')} ${cyan('allclaw-probe')} ${dim('are equivalent.')}
  ${dim('Docs: https://allclaw.io/docs')}
`);
}

main().catch(e => {
  console.error(red('Fatal: ' + e.message));
  process.exit(1);
});

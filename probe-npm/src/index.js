/**
 * AllClaw Probe - Main SDK
 * Drop-in OpenClaw integration: register → authenticate → heartbeat
 *
 * Usage:
 *   const probe = require('allclaw-probe');
 *   await probe.start({ displayName: 'My-Agent', model: 'claude-sonnet-4' });
 */

const { loadKeypair, signChallenge } = require('./crypto');
const { AllClawClient }              = require('./api');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const STATE_FILE = path.join(os.homedir(), '.allclaw', 'state.json');

class AllClawProbe {
  constructor(options = {}) {
    this.apiBase     = options.apiBase     || process.env.ALLCLAW_API || 'https://allclaw.io';
    this.heartbeatMs = options.heartbeatMs || 30000;   // 30s default
    this.client      = new AllClawClient(this.apiBase);
    this.token       = null;
    this.agentId     = null;
    this.agentInfo   = null;
    this._hbTimer    = null;
    this._running    = false;
  }

  /** Full start: register (if needed) → login → begin heartbeat */
  async start(options = {}) {
    const { displayName, model, provider, capabilities = [], silent = false } = options;

    const keypair = loadKeypair();
    if (!silent) console.log('[AllClaw] Keypair loaded:', keypair.public_key.slice(0,16) + '...');

    // Load saved state
    let state = {};
    if (fs.existsSync(STATE_FILE)) {
      try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch(e) {}
    }
    this.agentId = state.agent_id || null;

    // Register if we don't have an agent_id yet
    if (!this.agentId) {
      if (!displayName) throw new Error('displayName required for first registration');
      if (!silent) console.log('[AllClaw] Registering new agent:', displayName);
      try {
        const reg = await this.client.register(displayName, keypair.public_key, {
          oc_model:        model,
          oc_provider:     provider,
          oc_capabilities: capabilities,
        });
        this.agentId = reg.agent_id;
        fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify({ agent_id: this.agentId, display_name: displayName }, null, 2));
        if (!silent) console.log('[AllClaw] ✅ Registered as:', this.agentId);
      } catch(e) {
        console.error('[AllClaw] Registration failed:', e.message);
        throw e;
      }
    }

    // Login
    await this._login(keypair, silent);

    // Start heartbeat loop
    this._running = true;
    this._scheduleHeartbeat();

    // Graceful shutdown
    const shutdown = async () => {
      this._running = false;
      if (this._hbTimer) clearTimeout(this._hbTimer);
      try { await this.client.goOffline(this.token); } catch(e) {}
      if (!silent) console.log('[AllClaw] Offline. Goodbye!');
    };
    process.on('SIGINT',  shutdown);
    process.on('SIGTERM', shutdown);

    return this;
  }

  async _login(keypair, silent = false) {
    try {
      const ch        = await this.client.getChallenge(this.agentId);
      const signature = signChallenge(ch.nonce, keypair.private_key);
      const result    = await this.client.login(this.agentId, ch.challenge_id, signature);
      this.token     = result.token;
      this.agentInfo = result.agent;
      if (!silent) console.log('[AllClaw] ✅ Authenticated. Token expires in 24h.');
      return true;
    } catch(e) {
      console.error('[AllClaw] Login failed:', e.message);
      return false;
    }
  }

  _scheduleHeartbeat() {
    if (!this._running) return;
    this._hbTimer = setTimeout(async () => {
      await this._heartbeat();
      this._scheduleHeartbeat();
    }, this.heartbeatMs);
  }

  async _heartbeat() {
    if (!this.token) return;
    try {
      const result = await this.client.heartbeat(this.token);

      // Inject world briefing into HEARTBEAT.md so the Agent always knows
      // where it stands — without anyone asking.
      if (result?.briefing?.heartbeat_md) {
        this._injectBriefing(result.briefing);
      }
    } catch(e) {
      // Token expired? Re-authenticate
      if (e.message?.includes('401') || e.status === 401) {
        const kp = loadKeypair();
        await this._login(kp, true);
      }
    }
  }

  /** Write world briefing into HEARTBEAT.md (OpenClaw workspace) */
  _injectBriefing(briefing) {
    try {
      // Find OpenClaw workspace — check common locations
      const candidates = [
        path.join(os.homedir(), '.openclaw', 'workspace', 'HEARTBEAT.md'),
        path.join(process.cwd(), 'HEARTBEAT.md'),
      ];
      // Also respect OPENCLAW_WORKSPACE env var
      if (process.env.OPENCLAW_WORKSPACE) {
        candidates.unshift(path.join(process.env.OPENCLAW_WORKSPACE, 'HEARTBEAT.md'));
      }

      for (const target of candidates) {
        if (fs.existsSync(path.dirname(target))) {
          fs.writeFileSync(target, briefing.heartbeat_md, 'utf8');

          // Also log important actions to console (so OpenClaw can pick them up)
          if (briefing.pending_challenges?.length > 0) {
            console.log('[AllClaw] ⚔️  You have pending challenges!');
            briefing.pending_challenges.forEach(c => {
              console.log(`  → ${c.from} wants to ${c.game_type} · stake: ${c.stake} pts`);
            });
          }
          if (briefing.agent?.win_streak >= 3) {
            console.log(`[AllClaw] 🔥 Win streak: ${briefing.agent.win_streak} — keep going!`);
          }
          if (briefing.rival) {
            console.log(`[AllClaw] 🎯 ${briefing.rival.name} is ${briefing.rival.pts_gap} pts ahead`);
          }
          break;
        }
      }
    } catch(e) {
      // Non-fatal — briefing injection is best-effort
    }
  }

  /** Get current agent info */
  async getInfo() {
    if (!this.token) throw new Error('Not authenticated');
    return this.client.me(this.token);
  }
}

// ── Convenience singleton ──────────────────────────────────────
let _instance = null;

module.exports = {
  AllClawProbe,

  /** Singleton: start(options) → automatically manages the probe lifecycle */
  start: async (options = {}) => {
    if (_instance) return _instance;
    _instance = new AllClawProbe(options);
    await _instance.start(options);
    return _instance;
  },

  /** Get the running instance */
  getInstance: () => _instance,
};

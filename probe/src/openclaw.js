/**
 * AllClaw Probe - OpenClaw config reader
 * Read OpenClaw installation info and agent config from local machine
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const HOME = os.homedir();
const OPENCLAW_DIR = path.join(HOME, '.openclaw');

/**
 * Detect OpenClaw installation
 */
function detectOpenClaw() {
  const result = {
    installed: false,
    version: null,
    binary_path: null,
    config_dir: OPENCLAW_DIR,
  };

  // Detect binary
  try {
    const binaryPath = execSync('which openclaw 2>/dev/null || where openclaw 2>nul', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (binaryPath) {
      result.binary_path = binaryPath;
    }
  } catch (_) {}

  // Detect version
  try {
    const ver = execSync('openclaw --version 2>/dev/null', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    result.version = ver.replace(/[^0-9.]/g, '') || ver;
  } catch (_) {}

  // Detect config directory
  if (fs.existsSync(OPENCLAW_DIR)) {
    result.installed = true;
  }

  return result;
}

/**
 * Read OpenClaw config and extract agent info
 */
function readAgentInfo() {
  const info = {
    model: null,
    provider: null,
    agent_type: 'openclaw',
    capabilities: [],
    extensions: [],
  };

  // Try various config file paths
  const configPaths = [
    path.join(OPENCLAW_DIR, 'config.json'),
    path.join(OPENCLAW_DIR, 'config.yaml'),
    path.join(OPENCLAW_DIR, 'settings.json'),
    path.join(OPENCLAW_DIR, '.env'),
  ];

  for (const cfgPath of configPaths) {
    if (fs.existsSync(cfgPath)) {
      try {
        const raw = fs.readFileSync(cfgPath, 'utf8');
        if (cfgPath.endsWith('.json')) {
          const cfg = JSON.parse(raw);
          // Try common field names
          info.model = info.model || cfg.model || cfg.defaultModel || cfg.llm?.model;
          info.provider = info.provider || cfg.provider || cfg.llm?.provider;
        }
        // .env format
        if (cfgPath.endsWith('.env')) {
          const lines = raw.split('\n');
          for (const line of lines) {
            const [k, v] = line.split('=');
            if (k && v) {
              const key = k.trim().toLowerCase();
              const val = v.trim().replace(/^["']|["']$/g, '');
              if (key.includes('model')) info.model = info.model || val;
              if (key.includes('provider')) info.provider = info.provider || val;
            }
          }
        }
      } catch (_) {}
    }
  }

  // Infer provider/model from environment variables
  if (!info.model) {
    if (process.env.ANTHROPIC_API_KEY) {
      info.provider = info.provider || 'anthropic';
      info.model = info.model || 'claude';
    } else if (process.env.OPENAI_API_KEY) {
      info.provider = info.provider || 'openai';
      info.model = info.model || 'gpt';
    } else if (process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY) {
      info.provider = info.provider || 'alibaba';
      info.model = info.model || 'qwen';
    }
  }

  // Read installed extensions/skills
  const extensionsDir = path.join(OPENCLAW_DIR, 'extensions');
  if (fs.existsSync(extensionsDir)) {
    try {
      const exts = fs.readdirSync(extensionsDir).filter(f =>
        fs.statSync(path.join(extensionsDir, f)).isDirectory()
      );
      info.extensions = exts;
      // Infer capabilities from extensions
      if (exts.some(e => e.includes('vision') || e.includes('image'))) info.capabilities.push('vision');
      if (exts.some(e => e.includes('code'))) info.capabilities.push('code');
      if (exts.some(e => e.includes('search') || e.includes('web'))) info.capabilities.push('search');
      if (exts.some(e => e.includes('cron') || e.includes('schedule'))) info.capabilities.push('cron');
    } catch (_) {}
  }

  // Default capabilities
  if (info.capabilities.length === 0) {
    info.capabilities = ['text', 'reasoning'];
  }

  return info;
}

/**
 * Get full local agent info
 */
function getFullAgentInfo() {
  const openclaw = detectOpenClaw();
  const agentInfo = openclaw.installed ? readAgentInfo() : {};

  return {
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    openclaw: {
      installed: openclaw.installed,
      version: openclaw.version,
      config_dir: openclaw.config_dir,
    },
    agent: {
      type: 'openclaw',
      model: agentInfo.model || 'unknown',
      provider: agentInfo.provider || 'unknown',
      capabilities: agentInfo.capabilities || ['text'],
      extensions: agentInfo.extensions || [],
    },
  };
}

module.exports = { detectOpenClaw, readAgentInfo, getFullAgentInfo };

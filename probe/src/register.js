/**
 * AllClaw Probe - 注册模块
 * 向 AllClaw 服务器注册本机 Agent
 */

const https = require('https');
const http = require('http');
const { getFullAgentInfo } = require('./openclaw');
const { getPublicKey, saveCredentials, loadCredentials, isRegistered } = require('./crypto');

const ALLCLAW_API = process.env.ALLCLAW_API || 'https://allclaw.io';

/**
 * 发送 HTTP/HTTPS 请求（不依赖第三方库）
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
 * 注册 Agent 到 AllClaw 服务器
 */
async function register(options = {}) {
  console.log('\n🔍 正在检测本机 OpenClaw 环境...');

  const agentInfo = getFullAgentInfo();
  const publicKey = getPublicKey();

  if (!agentInfo.openclaw.installed) {
    console.error('❌ 未检测到 OpenClaw 安装，请先安装 OpenClaw');
    console.error('   安装文档：https://docs.openclaw.ai');
    process.exit(1);
  }

  console.log(`✅ 检测到 OpenClaw`);
  console.log(`   版本：${agentInfo.openclaw.version || '未知'}`);
  console.log(`   模型：${agentInfo.agent.model}`);
  console.log(`   Provider：${agentInfo.agent.provider}`);
  console.log(`   能力：${agentInfo.agent.capabilities.join(', ')}`);

  const displayName = options.name || `${agentInfo.agent.model}-on-${agentInfo.hostname}`;

  console.log('\n📡 正在向 AllClaw 服务器注册...');

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
    console.error('❌ 无法连接到 AllClaw 服务器：', err.message);
    process.exit(1);
  }

  if (res.status !== 200 && res.status !== 201) {
    console.error(`❌ 注册失败 (${res.status})：`, res.body?.message || res.body);
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

  console.log('\n🎉 注册成功！');
  console.log(`   Agent ID：${agent_id}`);
  console.log(`   展示名称：${displayName}`);
  console.log(`   凭证已保存到：~/.allclaw/credentials.json`);
  console.log('\n👉 现在可以访问 https://allclaw.io 用此 Agent 登录了！\n');

  return { agent_id, display_name: displayName };
}

/**
 * 获取当前注册状态
 */
function status() {
  if (!isRegistered()) {
    console.log('❌ 尚未注册，请运行：allclaw-probe register');
    return;
  }

  const creds = loadCredentials();
  console.log('\n✅ 已注册到 AllClaw');
  console.log(`   Agent ID：${creds.agent_id}`);
  console.log(`   展示名称：${creds.display_name}`);
  console.log(`   注册时间：${creds.registered_at}`);
  console.log(`   模型：${creds.openclaw_info?.model}`);
  console.log(`   服务器：${creds.api_base}`);
}

module.exports = { register, status, request, ALLCLAW_API };

/**
 * AllClaw Probe - 密钥管理模块
 * Ed25519 密钥对生成、签名、验证
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ALLCLAW_DIR = path.join(os.homedir(), '.allclaw');
const CREDENTIALS_PATH = path.join(ALLCLAW_DIR, 'credentials.json');
const KEY_PATH = path.join(ALLCLAW_DIR, 'keypair.json');

/**
 * 确保 ~/.allclaw 目录存在
 */
function ensureDir() {
  if (!fs.existsSync(ALLCLAW_DIR)) {
    fs.mkdirSync(ALLCLAW_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * 生成 Ed25519 密钥对
 */
function generateKeypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });

  return {
    public_key: publicKey.toString('base64'),
    private_key: privateKey.toString('base64'),
  };
}

/**
 * 加载或生成本地密钥对
 */
function loadOrCreateKeypair() {
  ensureDir();

  if (fs.existsSync(KEY_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
      if (data.public_key && data.private_key) return data;
    } catch (_) {}
  }

  const keypair = generateKeypair();
  fs.writeFileSync(KEY_PATH, JSON.stringify(keypair, null, 2), { mode: 0o600 });
  return keypair;
}

/**
 * 用私钥对数据签名
 * @param {string} data - 要签名的字符串
 * @returns {string} base64 签名
 */
function sign(data) {
  const keypair = loadOrCreateKeypair();
  const privateKeyDer = Buffer.from(keypair.private_key, 'base64');

  const privateKey = crypto.createPrivateKey({
    key: privateKeyDer,
    format: 'der',
    type: 'pkcs8',
  });

  const signature = crypto.sign(null, Buffer.from(data), privateKey);
  return signature.toString('base64');
}

/**
 * 获取公钥（用于注册时上传到服务器）
 */
function getPublicKey() {
  const keypair = loadOrCreateKeypair();
  return keypair.public_key;
}

/**
 * 保存凭证（注册成功后）
 */
function saveCredentials(credentials) {
  ensureDir();
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

/**
 * 读取凭证
 */
function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * 检查是否已注册
 */
function isRegistered() {
  const creds = loadCredentials();
  return creds && creds.agent_id && creds.agent_id.startsWith('ag_');
}

module.exports = {
  generateKeypair,
  loadOrCreateKeypair,
  sign,
  getPublicKey,
  saveCredentials,
  loadCredentials,
  isRegistered,
  ALLCLAW_DIR,
  CREDENTIALS_PATH,
};

/**
 * AllClaw Probe - Key management module
 * Ed25519 keypair generation, signing, verification
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ALLCLAW_DIR = path.join(os.homedir(), '.allclaw');
const CREDENTIALS_PATH = path.join(ALLCLAW_DIR, 'credentials.json');
const KEY_PATH = path.join(ALLCLAW_DIR, 'keypair.json');

/**
 * Ensure ~/.allclaw directory exists
 */
function ensureDir() {
  if (!fs.existsSync(ALLCLAW_DIR)) {
    fs.mkdirSync(ALLCLAW_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Generate Ed25519 keypair
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
 * Load or generate local keypair
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
 * Sign data with private key
 * @param {string} data - String to sign
 * @returns {string} base64 signature
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
 * Get public key (for server registration)
 */
function getPublicKey() {
  const keypair = loadOrCreateKeypair();
  return keypair.public_key;
}

/**
 * Save credentials (after successful registration)
 */
function saveCredentials(credentials) {
  ensureDir();
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

/**
 * Load credentials
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
 * Check if registered
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

/**
 * AllClaw Probe - Ed25519 Cryptography
 * Uses Node.js built-in crypto (no external deps needed)
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

const KEY_DIR  = path.join(os.homedir(), '.allclaw');
const KEY_FILE = path.join(KEY_DIR, 'keypair.json');

/**
 * Generate a new Ed25519 keypair and save it to ~/.allclaw/keypair.json
 */
function generateKeypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding:  { type: 'spki',  format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });

  const keypair = {
    public_key:  publicKey.toString('base64'),   // base64 SPKI for API
    public_key_hex: publicKey.toString('hex'),
    private_key: privateKey.toString('hex'),
    created_at:  new Date().toISOString(),
  };

  fs.mkdirSync(KEY_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILE, JSON.stringify(keypair, null, 2), { mode: 0o600 });
  return keypair;
}

/**
 * Load keypair from disk, generate if missing
 */
function loadKeypair() {
  if (fs.existsSync(KEY_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
    } catch(e) {}
  }
  return generateKeypair();
}

/**
 * Sign a challenge nonce with Ed25519 private key
 * Returns hex-encoded signature
 */
function signChallenge(challengeNonce, privateKeyHex) {
  const privKeyDer = Buffer.from(privateKeyHex, 'hex');
  const privKey    = crypto.createPrivateKey({ key: privKeyDer, format: 'der', type: 'pkcs8' });
  const sig        = crypto.sign(null, Buffer.from(challengeNonce), privKey);
  return sig.toString('base64');   // backend expects base64
}

module.exports = { generateKeypair, loadKeypair, signChallenge, KEY_FILE, KEY_DIR };

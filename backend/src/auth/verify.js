const crypto = require('crypto');

function verifySignature(nonce, signatureB64, publicKeyB64) {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(publicKeyB64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(null, Buffer.from(nonce), publicKey, Buffer.from(signatureB64, 'base64'));
  } catch (err) {
    return false;
  }
}

module.exports = { verifySignature };

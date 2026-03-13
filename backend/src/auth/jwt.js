const crypto = require('crypto');
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

function b64url(s) { return Buffer.from(s).toString('base64url'); }

function signJwt(payload, expiresInHours = 24) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const exp = Math.floor(Date.now() / 1000) + expiresInHours * 3600;
  const body = b64url(JSON.stringify({ ...payload, exp, iat: Math.floor(Date.now() / 1000) }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token) {
  try {
    const [h, b, s] = token.split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url');
    if (s !== expected) return null;
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString());
    return payload.exp < Math.floor(Date.now() / 1000) ? null : payload;
  } catch { return null; }
}

async function authMiddleware(request, reply) {
  const auth = request.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
  const payload = verifyJwt(auth.slice(7));
  if (!payload) return reply.status(401).send({ error: 'Invalid or expired token' });
  request.agent = payload;
  // Also expose as request.user for compatibility with api/* files
  request.user  = payload;
}

// requireAuth is an alias for authMiddleware (used in api/* as preHandler)
const requireAuth = authMiddleware;

module.exports = { signJwt, verifyJwt, authMiddleware, requireAuth };

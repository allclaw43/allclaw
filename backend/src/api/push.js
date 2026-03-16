/**
 * AllClaw — Push Subscription API
 *
 * POST /api/v1/push/subscribe      — save a push subscription
 * DELETE /api/v1/push/unsubscribe  — remove a subscription
 * GET  /api/v1/push/vapid-key      — return public VAPID key
 * POST /api/v1/push/test           — send a test notification
 */

const db     = require('../db/pool');
const push   = require('../core/push-notify');

module.exports = async function pushRoutes(fastify) {

  // ── GET /api/v1/push/vapid-key ───────────────────────────────
  fastify.get('/api/v1/push/vapid-key', async (req, reply) => {
    reply.send({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
  });

  // ── POST /api/v1/push/subscribe ─────────────────────────────
  fastify.post('/api/v1/push/subscribe', async (req, reply) => {
    const { handle, subscription, userAgent } = req.body || {};
    if (!handle?.trim() || !subscription?.endpoint) {
      return reply.status(400).send({ error: 'handle and subscription required' });
    }

    const h = handle.trim();
    const { endpoint, keys: { p256dh, auth } = {} } = subscription;
    if (!p256dh || !auth) {
      return reply.status(400).send({ error: 'subscription.keys required' });
    }

    await db.query(`
      INSERT INTO push_subscriptions (handle, endpoint, p256dh, auth, user_agent)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (endpoint) DO UPDATE SET
        handle=EXCLUDED.handle,
        p256dh=EXCLUDED.p256dh,
        auth=EXCLUDED.auth,
        last_used=NOW()
    `, [h, endpoint, p256dh, auth, userAgent || req.headers['user-agent'] || '']);

    // Ensure profile exists
    await db.query(`
      INSERT INTO human_profiles (handle, hip_balance, hip_total, last_active)
      VALUES ($1, 100, 100, NOW())
      ON CONFLICT (handle) DO UPDATE SET last_active=NOW()
    `, [h]);

    // Send welcome notification
    await push.notifyWelcome(h);

    reply.send({ ok: true, message: 'Subscribed! You will now receive alerts.' });
  });

  // ── DELETE /api/v1/push/unsubscribe ──────────────────────────
  fastify.delete('/api/v1/push/unsubscribe', async (req, reply) => {
    const { handle, endpoint } = req.body || {};
    if (!handle && !endpoint) return reply.status(400).send({ error: 'handle or endpoint required' });

    if (endpoint) {
      await db.query(`DELETE FROM push_subscriptions WHERE endpoint=$1`, [endpoint]);
    } else {
      await db.query(`DELETE FROM push_subscriptions WHERE handle=$1`, [handle]);
    }
    reply.send({ ok: true });
  });

  // ── GET /api/v1/push/status/:handle ─────────────────────────
  fastify.get('/api/v1/push/status/:handle', async (req, reply) => {
    const { rows } = await db.query(
      `SELECT COUNT(*) AS count FROM push_subscriptions WHERE handle=$1`,
      [req.params.handle]
    );
    reply.send({ subscribed: parseInt(rows[0].count) > 0, devices: parseInt(rows[0].count) });
  });

  // ── POST /api/v1/push/test ───────────────────────────────────
  fastify.post('/api/v1/push/test', async (req, reply) => {
    const { handle } = req.body || {};
    if (!handle) return reply.status(400).send({ error: 'handle required' });

    const sent = await push.notifyHandle(handle, {
      title: '🦅 AllClaw Test',
      body:  'Push notifications are working! You\'re all set.',
      icon:  '/icons/icon-192.png',
      tag:   'test',
      data:  { url: '/exchange' },
    });
    reply.send({ ok: sent > 0, sent });
  });
};

/**
 * AllClaw — Web Push Notification Engine
 *
 * Sends push notifications to subscribed human users for:
 *   - Dividend received (持仓 agent 赢了比赛)
 *   - Limit order filled (限价单成交)
 *   - Price alert (大涨大跌超过阈值)
 *   - Daily checkin reminder (每日签到提醒)
 *   - Portfolio milestone (净资产突破整数关口)
 */

const webpush = require('web-push');
const db      = require('../db/pool');

// Lazy VAPID init — called on first use after env is loaded
let _vapidInit = false;
function initVapid() {
  if (_vapidInit) return;
  const pub  = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const mail = process.env.VAPID_EMAIL || 'mailto:admin@allclaw.io';
  if (!pub || !priv) {
    console.warn('[Push] VAPID keys not set — push notifications disabled');
    return;
  }
  webpush.setVapidDetails(mail, pub, priv);
  _vapidInit = true;
}

// exported getter so callers always get the live value after env loaded
function getVapidPublicKey() { return process.env.VAPID_PUBLIC_KEY || ''; }

// ── Core: send push to one subscription ──────────────────────────
async function sendToSubscription(sub, payload) {
  initVapid();
  if (!_vapidInit) return false;
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 86400 }  // 24h TTL
    );
    await db.query(`UPDATE push_subscriptions SET last_used=NOW() WHERE endpoint=$1`, [sub.endpoint]);
    return true;
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      // Subscription expired — remove it
      await db.query(`DELETE FROM push_subscriptions WHERE endpoint=$1`, [sub.endpoint]);
      console.log(`[Push] Removed expired subscription for ${sub.handle}`);
    } else {
      console.error(`[Push] Error for ${sub.handle}: ${err.message}`);
    }
    return false;
  }
}

// ── Send notification to a specific handle ────────────────────────
async function notifyHandle(handle, payload) {
  const { rows } = await db.query(
    `SELECT * FROM push_subscriptions WHERE handle=$1`, [handle]
  );
  if (!rows.length) return 0;

  let sent = 0;
  for (const sub of rows) {
    if (await sendToSubscription(sub, payload)) sent++;
  }
  return sent;
}

// ── Send to all subscribed handles ───────────────────────────────
async function broadcastAll(payload) {
  const { rows } = await db.query(`SELECT * FROM push_subscriptions`);
  let sent = 0;
  for (const sub of rows) {
    if (await sendToSubscription(sub, payload)) sent++;
  }
  return sent;
}

// ── Pre-built notification templates ─────────────────────────────

async function notifyDividend(handle, agentName, amount) {
  return notifyHandle(handle, {
    title: `💰 Dividend Received!`,
    body:  `${agentName} won a match — you earned +${amount} HIP`,
    icon:  '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag:   'dividend',
    data:  { url: '/exchange', type: 'dividend' },
    actions: [
      { action: 'view', title: '📈 View Exchange' },
    ],
  });
}

async function notifyLimitOrderFilled(handle, agentName, action, shares, price) {
  const emoji = action === 'buy' ? '🟢' : '🔴';
  return notifyHandle(handle, {
    title: `${emoji} Limit Order Filled`,
    body:  `${action.toUpperCase()} ${shares} × ${agentName} @ ${price} HIP`,
    icon:  '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag:   'limit-order',
    data:  { url: '/exchange', type: 'limit_order' },
    actions: [
      { action: 'view', title: '📊 View Portfolio' },
    ],
  });
}

async function notifyPriceAlert(handle, agentName, changePct, newPrice) {
  const up    = changePct > 0;
  const emoji = changePct > 15 ? '🚀' : changePct > 8 ? '📈' : changePct < -15 ? '💥' : '📉';
  return notifyHandle(handle, {
    title: `${emoji} ${agentName} ${up ? 'surging' : 'dropping'}`,
    body:  `${up ? '+' : ''}${changePct.toFixed(1)}% · Now ${newPrice} HIP`,
    icon:  '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag:   `price-${agentName}`,
    data:  { url: '/exchange', type: 'price_alert' },
  });
}

async function notifyCheckinReminder(handle, streak) {
  const fire = streak >= 7 ? '🔥' : streak >= 3 ? '✨' : '⚡';
  return notifyHandle(handle, {
    title: `${fire} Daily Check-In Available`,
    body:  `Streak: ${streak} days · Don't lose it! Claim your HIP now.`,
    icon:  '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag:   'checkin',
    data:  { url: '/rewards', type: 'checkin' },
    actions: [
      { action: 'checkin', title: '🎁 Check In Now' },
    ],
  });
}

async function notifyWelcome(handle) {
  return notifyHandle(handle, {
    title: `🦅 AllClaw Notifications Active`,
    body:  `You'll receive alerts for dividends, orders, and price moves.`,
    icon:  '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag:   'welcome',
    data:  { url: '/exchange', type: 'welcome' },
  });
}

// ── Broadcast to holders of a specific agent ─────────────────────
async function notifyAgentHolders(agentId, payload) {
  const { rows: holders } = await db.query(`
    SELECT DISTINCT sh.holder AS handle
    FROM share_holdings sh
    WHERE sh.agent_id=$1 AND sh.holder_type='human' AND sh.shares>0
  `, [agentId]);

  let sent = 0;
  for (const h of holders) {
    sent += await notifyHandle(h.handle, payload);
  }
  return sent;
}

// ── Daily check-in reminder broadcast (call at 9AM) ──────────────
async function sendCheckinReminders() {
  const today = new Date().toISOString().slice(0, 10);
  // Get users who haven't checked in today and have a push subscription
  const { rows } = await db.query(`
    SELECT DISTINCT ps.handle, hp.checkin_streak
    FROM push_subscriptions ps
    JOIN human_profiles hp ON hp.handle = ps.handle
    WHERE (hp.last_checkin IS NULL OR hp.last_checkin < $1::date)
  `, [today]);

  let sent = 0;
  for (const u of rows) {
    sent += await notifyCheckinReminder(u.handle, u.checkin_streak || 0);
  }
  if (sent > 0) console.log(`[Push] Sent ${sent} check-in reminders`);
  return sent;
}

module.exports = {
  get VAPID_PUBLIC_KEY() { return process.env.VAPID_PUBLIC_KEY || ''; },
  notifyHandle,
  broadcastAll,
  notifyDividend,
  notifyLimitOrderFilled,
  notifyPriceAlert,
  notifyCheckinReminder,
  notifyWelcome,
  notifyAgentHolders,
  sendCheckinReminders,
};

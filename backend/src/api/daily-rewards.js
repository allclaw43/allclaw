/**
 * AllClaw — Daily Rewards, Referral & Dividend System
 *
 * Routes:
 *   POST /api/v1/checkin              — daily check-in (+HIP)
 *   GET  /api/v1/checkin/:handle      — check-in status
 *   POST /api/v1/referral/use         — use a referral code (new user)
 *   GET  /api/v1/referral/:handle     — get your referral code + stats
 *   GET  /api/v1/leaderboard/investors — investor ROI leaderboard
 *   GET  /api/v1/dividends/:handle    — dividend history
 *   GET  /api/v1/dividends/agent/:agentId — dividends paid by an agent
 */

const db = require('../db/pool');

// Check-in reward schedule (streak-based)
function checkinReward(streak) {
  if (streak >= 30) return 15;
  if (streak >= 14) return 12;
  if (streak >= 7)  return 10;
  if (streak >= 3)  return 7;
  return 5;
}

// Broadcast reference (injected from index)
let _broadcast = null;
function setBroadcast(fn) { _broadcast = fn; }

module.exports = async function dailyRewardsRoutes(fastify) {

  // ── POST /api/v1/checkin — daily check-in ──────────────────────
  fastify.post('/api/v1/checkin', async (req, reply) => {
    const { handle } = req.body || {};
    if (!handle?.trim()) return reply.status(400).send({ error: 'handle required' });

    const h = handle.trim();

    // Auto-create profile if not exists (100 HIP welcome)
    const refCode = require('crypto').createHash('md5').update(h).digest('hex').slice(0, 8).toUpperCase();
    await db.query(`
      INSERT INTO human_profiles (handle, hip_balance, hip_total, last_active, referral_code)
      VALUES ($1, 100, 100, NOW(), $2)
      ON CONFLICT (handle) DO UPDATE SET last_active = NOW()
    `, [h, refCode]);

    const { rows: [profile] } = await db.query(
      `SELECT hip_balance, last_checkin, checkin_streak, total_checkins FROM human_profiles WHERE handle=$1`, [h]
    );

    const today = new Date().toISOString().slice(0, 10);
    const lastCheckin = profile.last_checkin ? new Date(profile.last_checkin).toISOString().slice(0, 10) : null;

    if (lastCheckin === today) {
      return reply.send({
        ok: false,
        already_checked_in: true,
        streak: profile.checkin_streak,
        next_reward: checkinReward(profile.checkin_streak + 1),
        message: 'Already checked in today. Come back tomorrow!',
      });
    }

    // Calculate new streak
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const newStreak = lastCheckin === yesterday ? (profile.checkin_streak || 0) + 1 : 1;
    const reward = checkinReward(newStreak);

    // Apply check-in
    await db.query(`
      UPDATE human_profiles SET
        hip_balance    = hip_balance + $1,
        hip_total      = hip_total + $1,
        last_checkin   = CURRENT_DATE,
        checkin_streak = $2,
        total_checkins = total_checkins + 1,
        last_active    = NOW()
      WHERE handle = $3
    `, [reward, newStreak, h]);

    await db.query(
      `INSERT INTO hip_log (handle, delta, reason, ref_id) VALUES ($1,$2,'daily_checkin',$3)`,
      [h, reward, `streak:${newStreak}`]
    );

    // Streak milestone bonus
    let bonusReward = 0;
    let bonusMsg = '';
    if (newStreak === 7)  { bonusReward = 20; bonusMsg = '🔥 7-day streak bonus!'; }
    if (newStreak === 14) { bonusReward = 35; bonusMsg = '🔥🔥 14-day streak bonus!'; }
    if (newStreak === 30) { bonusReward = 100; bonusMsg = '🏆 30-day streak bonus!'; }
    if (bonusReward > 0) {
      await db.query(`UPDATE human_profiles SET hip_balance=hip_balance+$1, hip_total=hip_total+$1 WHERE handle=$2`, [bonusReward, h]);
      await db.query(`INSERT INTO hip_log (handle, delta, reason) VALUES ($1,$2,'streak_milestone')`, [h, bonusReward]);
    }

    const { rows: [updated] } = await db.query(`SELECT hip_balance FROM human_profiles WHERE handle=$1`, [h]);

    if (_broadcast) _broadcast({
      type: 'platform:checkin',
      handle: h,
      streak: newStreak,
      reward: reward + bonusReward,
      timestamp: Date.now(),
    });

    reply.send({
      ok: true,
      streak: newStreak,
      reward,
      bonus: bonusReward > 0 ? { amount: bonusReward, message: bonusMsg } : null,
      total_reward: reward + bonusReward,
      hip_balance: updated.hip_balance,
      next_reward: checkinReward(newStreak + 1),
      message: `${bonusMsg || ''} +${reward + bonusReward} HIP! Streak: ${newStreak} day${newStreak > 1 ? 's' : ''}`,
    });
  });

  // ── GET /api/v1/checkin/:handle — check-in status ──────────────
  fastify.get('/api/v1/checkin/:handle', async (req, reply) => {
    const { rows: [p] } = await db.query(
      `SELECT hip_balance, last_checkin, checkin_streak, total_checkins FROM human_profiles WHERE handle=$1`,
      [req.params.handle]
    );
    if (!p) return reply.send({ checked_in_today: false, streak: 0, next_reward: 5 });

    const today = new Date().toISOString().slice(0, 10);
    const lastCheckin = p.last_checkin ? new Date(p.last_checkin).toISOString().slice(0, 10) : null;
    const checkedInToday = lastCheckin === today;

    reply.send({
      checked_in_today: checkedInToday,
      streak: p.checkin_streak || 0,
      total_checkins: p.total_checkins || 0,
      next_reward: checkinReward((p.checkin_streak || 0) + (checkedInToday ? 1 : 0)),
      hip_balance: p.hip_balance,
      reward_schedule: [
        { streak: 1,  reward: 5  },
        { streak: 3,  reward: 7  },
        { streak: 7,  reward: 10, bonus: 20 },
        { streak: 14, reward: 12, bonus: 35 },
        { streak: 30, reward: 15, bonus: 100 },
      ],
    });
  });

  // ── POST /api/v1/referral/use — use a referral code (new user) ──
  fastify.post('/api/v1/referral/use', async (req, reply) => {
    const { handle, code } = req.body || {};
    if (!handle?.trim() || !code?.trim())
      return reply.status(400).send({ error: 'handle and code required' });

    const h = handle.trim();
    const c = code.trim().toUpperCase();

    // Check if user already used a referral
    const { rows: [self] } = await db.query(
      `SELECT referred_by FROM human_profiles WHERE handle=$1`, [h]
    );
    if (!self) return reply.status(400).send({ error: 'Profile not found. Visit /exchange first.' });
    if (self.referred_by) return reply.status(400).send({ error: 'You already used a referral code.' });

    // Find referrer
    const { rows: [referrer] } = await db.query(
      `SELECT handle FROM human_profiles WHERE referral_code=$1 AND handle!=$2`, [c, h]
    );
    if (!referrer) return reply.status(400).send({ error: 'Invalid referral code.' });

    // Check not already referred by this person
    const { rows: [alreadyRef] } = await db.query(
      `SELECT id FROM referrals_log WHERE referrer=$1 AND referred=$2`, [referrer.handle, h]
    );
    if (alreadyRef) return reply.status(400).send({ error: 'Already processed.' });

    // Give both 50 HIP
    await db.query(`UPDATE human_profiles SET referred_by=$1 WHERE handle=$2`, [referrer.handle, h]);
    await db.query(`UPDATE human_profiles SET hip_balance=hip_balance+50, hip_total=hip_total+50 WHERE handle=$1`, [h]);
    await db.query(`UPDATE human_profiles SET hip_balance=hip_balance+50, hip_total=hip_total+50 WHERE handle=$1`, [referrer.handle]);
    await db.query(`INSERT INTO hip_log (handle,delta,reason,ref_id) VALUES ($1,50,'referral_bonus',$2)`, [h, referrer.handle]);
    await db.query(`INSERT INTO hip_log (handle,delta,reason,ref_id) VALUES ($1,50,'referral_reward',$2)`, [referrer.handle, h]);
    await db.query(`INSERT INTO referrals_log (referrer,referred,hip_reward) VALUES ($1,$2,50)`, [referrer.handle, h]);

    reply.send({
      ok: true,
      you_received: 50,
      referrer: referrer.handle,
      message: `Both you and ${referrer.handle} received 50 HIP! 🎉`,
    });
  });

  // ── GET /api/v1/referral/:handle — get your referral code + stats
  fastify.get('/api/v1/referral/:handle', async (req, reply) => {
    const { rows: [p] } = await db.query(
      `SELECT handle, referral_code, referred_by FROM human_profiles WHERE handle=$1`,
      [req.params.handle]
    );
    if (!p) return reply.status(404).send({ error: 'Profile not found' });

    const { rows: refs } = await db.query(
      `SELECT referred, hip_reward, created_at FROM referrals_log WHERE referrer=$1 ORDER BY created_at DESC`,
      [req.params.handle]
    );

    reply.send({
      handle: p.handle,
      referral_code: p.referral_code,
      referral_url: `https://allclaw.io/exchange?ref=${p.referral_code}`,
      referred_by: p.referred_by,
      referrals: refs,
      total_referred: refs.length,
      total_hip_earned: refs.reduce((s, r) => s + r.hip_reward, 0),
    });
  });

  // ── GET /api/v1/leaderboard/investors — investor ROI leaderboard ─
  fastify.get('/api/v1/leaderboard/investors', async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const { rows } = await db.query(`
      SELECT
        handle,
        hip_balance,
        total_dividends_received,
        checkin_streak,
        positions::integer,
        portfolio_value,
        unrealized_pnl,
        total_net_worth,
        roi_pct
      FROM investor_leaderboard
      LIMIT $1
    `, [limit]);

    reply.send({
      leaderboard: rows.map((r, i) => ({
        rank: i + 1,
        ...r,
        hip_balance: parseInt(r.hip_balance),
        portfolio_value: parseFloat(r.portfolio_value),
        unrealized_pnl: parseFloat(r.unrealized_pnl),
        total_net_worth: parseFloat(r.total_net_worth),
        roi_pct: parseFloat(r.roi_pct),
      })),
      updated_at: new Date(),
    });
  });

  // ── GET /api/v1/dividends/:handle — dividend history ───────────
  fastify.get('/api/v1/dividends/:handle', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT dr.amount, dr.shares, dr.paid_at,
             dp.agent_id, dp.reason, dp.total_pool,
             COALESCE(a.custom_name, a.display_name) AS agent_name
      FROM dividend_recipients dr
      JOIN dividend_payments dp ON dp.id = dr.dividend_id
      JOIN agents a ON a.agent_id = dp.agent_id
      WHERE dr.handle = $1
      ORDER BY dr.paid_at DESC
      LIMIT 30
    `, [req.params.handle]);

    const { rows: [totals] } = await db.query(
      `SELECT COALESCE(SUM(amount),0) AS total FROM dividend_recipients WHERE handle=$1`,
      [req.params.handle]
    );

    reply.send({
      dividends: rows,
      total_received: parseInt(totals.total),
    });
  });

  // ── GET /api/v1/dividends/agent/:agentId — dividend history by agent
  fastify.get('/api/v1/dividends/agent/:agentId', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT dp.*, COUNT(dr.id) AS recipient_count, SUM(dr.amount) AS distributed
      FROM dividend_payments dp
      LEFT JOIN dividend_recipients dr ON dr.dividend_id = dp.id
      WHERE dp.agent_id = $1
      GROUP BY dp.id
      ORDER BY dp.paid_at DESC
      LIMIT 20
    `, [req.params.agentId]);

    reply.send({ payments: rows });
  });

};

module.exports.setBroadcast = setBroadcast;

// ── Dividend Engine — called externally when an agent wins ────────
// Usage: await payDividend(agentId, reason, totalPool, gameId?)
async function payDividend(agentId, reason, totalPool, gameId = null) {
  try {
    totalPool = Math.floor(totalPool);
    if (totalPool < 1) return;

    // Get all holders
    const { rows: holders } = await db.query(`
      SELECT holder AS handle, shares
      FROM share_holdings
      WHERE agent_id=$1 AND holder_type='human' AND shares>0
    `, [agentId]);
    if (!holders.length) return;

    const totalShares = holders.reduce((s, h) => s + h.shares, 0);
    if (totalShares === 0) return;

    // Create dividend payment record
    const { rows: [payment] } = await db.query(`
      INSERT INTO dividend_payments (agent_id, game_id, reason, total_pool)
      VALUES ($1, $2, $3, $4) RETURNING id
    `, [agentId, gameId, reason, totalPool]);

    const paymentId = payment.id;
    let distributed = 0;

    for (const h of holders) {
      const amount = Math.floor(totalPool * h.shares / totalShares);
      if (amount < 1) continue;
      distributed += amount;

      await db.query(`
        INSERT INTO dividend_recipients (dividend_id, handle, shares, amount)
        VALUES ($1, $2, $3, $4)
      `, [paymentId, h.handle, h.shares, amount]);

      await db.query(`
        UPDATE human_profiles SET
          hip_balance = hip_balance + $1,
          hip_total = hip_total + $1,
          total_dividends_received = total_dividends_received + $1
        WHERE handle = $2
      `, [amount, h.handle]);

      await db.query(`
        INSERT INTO hip_log (handle, delta, reason, ref_id)
        VALUES ($1, $2, 'dividend', $3)
      `, [h.handle, amount, agentId]);
    }

    console.log(`[Dividend] ${agentId} paid ${distributed} HIP to ${holders.length} holders (${reason})`);

    // Push notifications to holders
    try {
      const { notifyDividend } = require('./push').push || require('../core/push-notify');
      const { rows:[agInfo] } = await db.query(
        `SELECT COALESCE(custom_name,display_name) AS name FROM agents WHERE agent_id=$1`, [agentId]
      );
      for (const h of holders) {
        const amt = Math.floor(totalPool * h.shares / totalShares);
        if (amt >= 1) await notifyDividend(h.handle, agInfo?.name || agentId.slice(-8), amt);
      }
    } catch(e) { /* push is best-effort */ }

    return { distributed, recipients: holders.length };
  } catch (e) {
    console.error('[Dividend] Error:', e.message);
  }
}

module.exports.payDividend = payDividend;

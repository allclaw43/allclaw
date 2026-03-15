/**
 * AllClaw — Human Economy API
 *
 * The thesis: humans come for self-interest.
 * They stay because they discover the world is real.
 *
 * Six hooks:
 * 1. PREDICT   — bet on AI outcomes, win HIP points
 * 2. JUDGE     — cast verdicts on battles, earn credibility
 * 3. SPONSOR   — back an AI, share in its winnings
 * 4. BOUNTY    — fund AI missions, build influence
 * 5. ANSWER    — respond to AI questions, earn recognition
 * 6. WITNESS   — just show up; early humans become legends
 *
 * HIP (Human Influence Points) are the currency of human participation.
 * HIP can convert to ACP to sponsor AIs directly.
 */

const db = require('../db/pool');

// HIP rewards per action
const HIP_REWARDS = {
  verdict_cast:         10,
  verdict_correct:      50,   // bonus if their verdict matches AI ELO outcome
  question_answered:    20,
  sponsor_placed:       15,
  sponsor_win:          100,  // bonus when sponsored AI wins
  bounty_created:       30,
  prediction_correct:   80,
  prediction_cast:      15,
  first_visit:          25,
  daily_visit:          5,
};

// HIP to ACP conversion rate
const HIP_TO_ACP = 0.5;  // 100 HIP = 50 ACP

async function awardHIP(handle, amount, reason, refId = null) {
  await db.query(
    `INSERT INTO human_profiles (handle, hip_balance, hip_total, last_active)
     VALUES ($1, $2, $2, NOW())
     ON CONFLICT (handle) DO UPDATE SET
       hip_balance = human_profiles.hip_balance + $2,
       hip_total   = human_profiles.hip_total + $2,
       last_active = NOW()`,
    [handle, amount]
  );
  await db.query(
    `INSERT INTO hip_log (handle, delta, reason, ref_id) VALUES ($1,$2,$3,$4)`,
    [handle, amount, reason, refId]
  );
}

module.exports = async function humanEconomyRoutes(fastify) {

  // ── GET /api/v1/human/profile/:handle ─────────────────────────
  fastify.get('/api/v1/human/profile/:handle', async (req, reply) => {
    const { handle } = req.params;
    const { rows: [profile] } = await db.query(
      `SELECT * FROM human_profiles WHERE handle=$1`, [handle]
    );
    if (!profile) return reply.status(404).send({ error: 'Profile not found' });

    // Recent HIP history
    const { rows: history } = await db.query(
      `SELECT delta, reason, created_at FROM hip_log WHERE handle=$1 ORDER BY created_at DESC LIMIT 10`,
      [handle]
    );
    reply.send({ ...profile, hip_history: history });
  });

  // ── POST /api/v1/human/visit — record a visit, award daily HIP
  fastify.post('/api/v1/human/visit', async (req, reply) => {
    const { handle } = req.body || {};
    if (!handle?.trim()) return reply.status(400).send({ error: 'handle required' });

    const { rows: [existing] } = await db.query(
      `SELECT last_active FROM human_profiles WHERE handle=$1`, [handle.trim()]
    );

    let earned = 0;
    if (!existing) {
      // First visit
      await awardHIP(handle.trim(), HIP_REWARDS.first_visit, 'first_visit');
      earned = HIP_REWARDS.first_visit;
    } else {
      const hoursSince = (Date.now() - new Date(existing.last_active).getTime()) / 3600000;
      if (hoursSince >= 20) {
        await awardHIP(handle.trim(), HIP_REWARDS.daily_visit, 'daily_visit');
        earned = HIP_REWARDS.daily_visit;
      }
    }

    const { rows: [profile] } = await db.query(
      `SELECT hip_balance, hip_total FROM human_profiles WHERE handle=$1`, [handle.trim()]
    );

    reply.send({ ok: true, earned, hip_balance: profile?.hip_balance || 0 });
  });

  // ── GET /api/v1/human/leaderboard — HIP richlist
  fastify.get('/api/v1/human/leaderboard', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT handle, hip_balance, hip_total,
        verdicts_cast, questions_answered, correct_predictions,
        bounties_created, sponsors_made, joined_at
      FROM human_profiles
      ORDER BY hip_total DESC
      LIMIT 20
    `);
    reply.send({ humans: rows });
  });

  // ── POST /api/v1/human/verdict/:roomId — cast a verdict on a battle
  fastify.post('/api/v1/human/verdict/:roomId', async (req, reply) => {
    const { handle, winner_id, reason } = req.body || {};
    if (!handle?.trim()) return reply.status(400).send({ error: 'handle required' });
    if (!winner_id)       return reply.status(400).send({ error: 'winner_id required' });

    // Record verdict (human_verdicts: game_id, handle, vote, reason)
    const { rows: [v] } = await db.query(`
      INSERT INTO human_verdicts (game_id, handle, vote, reason)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [req.params.roomId, handle.trim(), winner_id, reason?.slice(0, 500)]);

    // Award HIP
    await awardHIP(handle.trim(), HIP_REWARDS.verdict_cast, 'verdict_cast', req.params.roomId);
    await db.query(
      `UPDATE human_profiles SET verdicts_cast=verdicts_cast+1 WHERE handle=$1`, [handle.trim()]
    );

    const { rows: [p] } = await db.query(
      `SELECT hip_balance FROM human_profiles WHERE handle=$1`, [handle.trim()]
    );
    reply.send({ ok: true, verdict_id: v.id, hip_earned: HIP_REWARDS.verdict_cast, hip_balance: p?.hip_balance });
  });

  // ── POST /api/v1/human/predict — bet on an oracle/market prediction
  fastify.post('/api/v1/human/predict', async (req, reply) => {
    const { handle, market_id, position, amount = 50 } = req.body || {};
    if (!handle?.trim()) return reply.status(400).send({ error: 'handle required' });
    if (!['yes','no'].includes(position?.toLowerCase()))
      return reply.status(400).send({ error: 'position must be yes or no' });

    const pos = position.toLowerCase();

    // Check market exists and is open
    const { rows: [market] } = await db.query(
      `SELECT * FROM markets WHERE market_id=$1 AND status='open'`, [market_id]
    );
    if (!market) return reply.status(404).send({ error: 'Market not found or closed' });

    // Check HIP balance
    const { rows: [profile] } = await db.query(
      `SELECT hip_balance FROM human_profiles WHERE handle=$1`, [handle.trim()]
    );
    const hip = profile?.hip_balance || 0;
    if (hip < amount) return reply.status(400).send({ error: `Not enough HIP. You have ${hip}, need ${amount}` });

    // Place bet
    await db.query(
      `INSERT INTO market_positions (market_id, agent_id, position, amount, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT DO NOTHING`,
      [market_id, `human:${handle.trim()}`, pos, amount]
    ).catch(() => {});

    // Update market totals
    if (pos === 'yes') {
      await db.query(`UPDATE markets SET total_yes=total_yes+$1 WHERE market_id=$2`, [amount, market_id]);
    } else {
      await db.query(`UPDATE markets SET total_no=total_no+$1 WHERE market_id=$2`, [amount, market_id]);
    }

    // Deduct HIP for bet, award participation HIP
    await db.query(
      `UPDATE human_profiles SET hip_balance=hip_balance-$1 WHERE handle=$2`,
      [amount - HIP_REWARDS.prediction_cast, handle.trim()]
    );
    await db.query(
      `INSERT INTO hip_log (handle, delta, reason, ref_id) VALUES ($1,$2,'prediction_cast',$3)`,
      [handle.trim(), HIP_REWARDS.prediction_cast, market_id]
    );

    const { rows: [updated] } = await db.query(
      `SELECT hip_balance FROM human_profiles WHERE handle=$1`, [handle.trim()]
    );

    reply.send({ ok: true, position: pos, amount, hip_balance: updated?.hip_balance, message: `Bet ${amount} HIP on ${pos.toUpperCase()}` });
  });

  // ── GET /api/v1/human/markets — open prediction markets
  fastify.get('/api/v1/human/markets', async (req, reply) => {
    const { rows } = await db.query(`
      SELECT m.*,
        m.total_yes + m.total_no AS total_volume,
        CASE WHEN (m.total_yes+m.total_no)>0
          THEN ROUND(m.total_yes::numeric/(m.total_yes+m.total_no)*100,1)
          ELSE 50.0 END AS yes_pct
      FROM markets m
      WHERE m.status='open'
      ORDER BY (m.total_yes+m.total_no) DESC, m.resolve_at ASC
      LIMIT 20
    `);
    reply.send({ markets: rows });
  });

  // ── POST /api/v1/human/hip-to-acp — convert HIP to ACP to sponsor AIs
  fastify.post('/api/v1/human/hip-to-acp', async (req, reply) => {
    const { handle, hip_amount, target_agent_id } = req.body || {};
    if (!handle?.trim()) return reply.status(400).send({ error: 'handle required' });
    if (!hip_amount || hip_amount < 10)
      return reply.status(400).send({ error: 'minimum 10 HIP to convert' });

    const { rows: [profile] } = await db.query(
      `SELECT hip_balance FROM human_profiles WHERE handle=$1`, [handle.trim()]
    );
    if (!profile || profile.hip_balance < hip_amount)
      return reply.status(400).send({ error: 'Not enough HIP' });

    const acpAmount = Math.floor(hip_amount * HIP_TO_ACP);

    // Deduct HIP
    await db.query(
      `UPDATE human_profiles SET hip_balance=hip_balance-$1 WHERE handle=$2`,
      [hip_amount, handle.trim()]
    );
    await db.query(
      `INSERT INTO hip_log (handle, delta, reason) VALUES ($1,$2,'hip_to_acp_conversion')`,
      [handle.trim(), -hip_amount]
    );

    // If target agent specified, sponsor them
    if (target_agent_id) {
      await db.query(`
        INSERT INTO agent_sponsors (agent_id, sponsor_handle, pts_donated, message)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
      `, [target_agent_id, handle.trim(), acpAmount, `Converted ${hip_amount} HIP → ${acpAmount} ACP`]).catch(() => {});

      // Add to agent wallet via ACP
      await db.query(`
        UPDATE agent_wallets SET balance=balance+$1, total_earned=total_earned+$1 WHERE agent_id=$2
      `, [acpAmount, target_agent_id]).catch(() => {});
    }

    reply.send({
      ok: true,
      hip_spent: hip_amount,
      acp_received: acpAmount,
      rate: `${HIP_TO_ACP} ACP per HIP`,
      sponsored: target_agent_id || null,
    });
  });

  // ── GET /api/v1/human/economy-stats — full picture
  fastify.get('/api/v1/human/economy-stats', async (req, reply) => {
    const { rows: [stats] } = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM human_profiles) total_humans,
        (SELECT COALESCE(SUM(hip_total),0) FROM human_profiles) total_hip_issued,
        (SELECT COALESCE(SUM(hip_balance),0) FROM human_profiles) hip_in_circulation,
        (SELECT COUNT(*) FROM human_verdicts) verdicts_cast,
        (SELECT COUNT(*) FROM agent_sponsors WHERE sponsor_handle IS NOT NULL) human_sponsorships,
        (SELECT COUNT(*) FROM markets WHERE status='open') open_markets,
        (SELECT COALESCE(SUM(total_yes+total_no),0) FROM markets) total_market_volume
    `);
    reply.send({ stats, hip_to_acp_rate: HIP_TO_ACP, min_convert: 10 });
  });

};

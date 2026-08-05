import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

export const VIP_DAILY_BONUS = {
  0: 0,
  1: 800,
  2: 1400,
  3: 2000,
  4: 5000,
  5: 10000,
  6: 20000,
  7: 55000
};

/**
 * Calculates cumulative unpaid days safely
 */
function calculateUnclaimedDays(user) {
  if (!user || !user.vip_level || Number(user.vip_level) === 0) {
    return 0;
  }

  const now = new Date();

  if (user.vip_expires_at && new Date(user.vip_expires_at) < now) {
    return 0;
  }

  const rawStartTime = user.last_bonus_claimed_at || user.vip_purchased_at;
  if (!rawStartTime) {
    return 0;
  }

  const startTime = new Date(rawStartTime);
  if (isNaN(startTime.getTime())) {
    return 0;
  }

  const diffInMs = now.getTime() - startTime.getTime();
  const elapsedDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

  return elapsedDays > 0 ? elapsedDays : 0;
}

// GET /api/bonus/status
router.get('/status', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: user, error: fetchErr } = await supabaseAdmin
      .from('users')
      .select('vip_level, vip_purchased_at, vip_expires_at, last_bonus_claimed_at, balance')
      .eq('id', userId)
      .single();

    if (fetchErr || !user) {
      return error(res, 'User record not found', 404);
    }

    const dailyRate = VIP_DAILY_BONUS[user.vip_level] || 0;
    const unclaimedDays = calculateUnclaimedDays(user);
    const cumulativeAmount = unclaimedDays * dailyRate;

    return success(res, {
      vip_level: user.vip_level,
      daily_rate: dailyRate,
      unclaimed_days: unclaimedDays,
      pending_bonus_amount: cumulativeAmount,
      last_claimed_at: user.last_bonus_claimed_at,
      can_claim: cumulativeAmount > 0
    });

  } catch (err) {
    console.error('Bonus status error:', err);
    return error(res, 'Internal server error calculating bonus', 500);
  }
});

// POST /api/bonus/claim
router.post('/claim', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: user, error: fetchErr } = await supabaseAdmin
      .from('users')
      .select('id, balance, total_earned, vip_level, vip_purchased_at, vip_expires_at, last_bonus_claimed_at')
      .eq('id', userId)
      .single();

    if (fetchErr || !user) {
      return error(res, 'User record not found', 404);
    }

    if (!user.vip_level || Number(user.vip_level) === 0) {
      return error(res, 'Active VIP membership required to claim daily bonus.', 400);
    }

    const dailyRate = VIP_DAILY_BONUS[user.vip_level] || 0;
    const unclaimedDays = calculateUnclaimedDays(user);
    const bonusToClaim = unclaimedDays * dailyRate;

    if (unclaimedDays <= 0 || bonusToClaim <= 0) {
      return error(res, 'No pending daily bonus available to claim.', 400);
    }

    const currentBalance = Number(user.balance) || 0;
    const currentTotalEarned = Number(user.total_earned) || 0;
    const newBalance = currentBalance + bonusToClaim;
    const newTotalEarned = currentTotalEarned + bonusToClaim;
    const nowIso = new Date().toISOString();

    const { data: updatedUser, error: updateErr } = await supabaseAdmin
      .from('users')
      .update({
        balance: newBalance,
        total_earned: newTotalEarned,
        last_bonus_claimed_at: nowIso,
        updated_at: nowIso
      })
      .eq('id', userId)
      .select('balance, total_earned, last_bonus_claimed_at')
      .single();

    if (updateErr) {
      console.error('Database error updating bonus:', updateErr);
      return error(res, 'Failed to update user balance for bonus claim.', 500);
    }

    await supabaseAdmin.from('transactions').insert({
      user_id: userId,
      type: 'daily_bonus',
      amount: bonusToClaim,
      fee: 0.00,
      net_amount: bonusToClaim,
      status: 'completed',
      description: `Claimed ${unclaimedDays} day(s) VIP Level ${user.vip_level} daily bonus`,
      reference: `BONUS-${userId}-${Date.now()}`
    });

    return success(res, {
      claimed_amount: bonusToClaim,
      days_claimed: unclaimedDays,
      new_balance: updatedUser.balance,
      last_bonus_claimed_at: updatedUser.last_bonus_claimed_at
    }, `Successfully claimed ₦${bonusToClaim.toLocaleString()} daily bonus!`);

  } catch (err) {
    console.error('Bonus claim error:', err);
    return error(res, 'Internal server error processing claim', 500);
  }
});

export default router;
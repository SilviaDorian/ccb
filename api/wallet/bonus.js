import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { success, error } from '../utils/response.js';

const router = express.Router();

// VIP Daily Bonus Rates matching system config
export const VIP_DAILY_BONUS = {
  0: 0,       // Free
  1: 800,     // Beginner
  2: 1400,    // Novice
  3: 2000,    // Intermediate
  4: 5000,    // Advanced
  5: 10000,   // Expert
  6: 20000,   // Master
  7: 55000    // Legend
};

/**
  Calculate cumulative unpaid days since last claim or purchase date
 */
function calculateUnclaimedDays(user) {
  if (!user.vip_level || user.vip_level === 0) return 0;

  const now = new Date();
  
  // Check if VIP membership is expired
  if (user.vip_expires_at && new Date(user.vip_expires_at) < now) {
    return 0;
  }

  // Base starting point is either the last claim time or VIP purchase time
  const startTime = user.last_bonus_claimed_at 
    ? new Date(user.last_bonus_claimed_at) 
    : (user.vip_purchased_at ? new Date(user.vip_purchased_at) : null);

  if (!startTime) return 0;

  const diffInMs = now.getTime() - startTime.getTime();
  const elapsedDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

  return elapsedDays > 0 ? elapsedDays : 0;
}

// GET /api/bonus/status - Retrieve pending cumulative bonus details
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
    console.error('Bonus status calculation error:', err);
    return error(res, 'Failed to compute bonus status', 500);
  }
});

// POST /api/bonus/claim - Claim cumulative pending daily bonus
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

    if (!user.vip_level || user.vip_level === 0) {
      return error(res, 'You need an active VIP level to claim daily bonuses.', 400);
    }

    const dailyRate = VIP_DAILY_BONUS[user.vip_level] || 0;
    const unclaimedDays = calculateUnclaimedDays(user);
    const bonusToClaim = unclaimedDays * dailyRate;

    if (unclaimedDays <= 0 || bonusToClaim <= 0) {
      return error(res, 'No pending daily bonus available to claim today.', 400);
    }

    const currentBalance = Number(user.balance) || 0;
    const currentTotalEarned = Number(user.total_earned) || 0;
    const newBalance = currentBalance + bonusToClaim;
    const newTotalEarned = currentTotalEarned + bonusToClaim;
    const claimTime = new Date().toISOString();

    // 1. Update user balance & claim timestamp
    const { data: updatedUser, error: updateErr } = await supabaseAdmin
      .from('users')
      .update({
        balance: newBalance,
        total_earned: newTotalEarned,
        last_bonus_claimed_at: claimTime,
        updated_at: claimTime
      })
      .eq('id', userId)
      .select('balance, total_earned, last_bonus_claimed_at')
      .single();

    if (updateErr) {
      console.error('Failed to update balance during bonus claim:', updateErr);
      return error(res, 'Failed to process bonus claim.', 500);
    }

    // 2. Insert record in transactions table
    await supabaseAdmin.from('transactions').insert({
      user_id: userId,
      type: 'daily_bonus',
      amount: bonusToClaim,
      fee: 0.00,
      net_amount: bonusToClaim,
      status: 'completed',
      description: `Claimed ${unclaimedDays} day(s) VIP ${user.vip_level} daily bonus`,
      reference: `BONUS-${userId}-${Date.now()}`,
      metadata: {
        vip_level: user.vip_level,
        days_claimed: unclaimedDays,
        daily_rate: dailyRate
      }
    });

    return success(res, {
      claimed_amount: bonusToClaim,
      days_claimed: unclaimedDays,
      new_balance: updatedUser.balance,
      last_bonus_claimed_at: updatedUser.last_bonus_claimed_at
    }, `Successfully claimed ₦${bonusToClaim.toLocaleString()} daily bonus!`);

  } catch (err) {
    console.error('Bonus claim error:', err);
    return error(res, 'Internal server error processing claim.', 500);
  }
});

export default router;
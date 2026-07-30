import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

// VIP Plans based on Investment Experience Levels
export const VIP_PLANS = {
  1: {
    name: 'Beginner',
    level: 1,
    price: 4000,
    duration_days: 60,
    daily_bonus: 800,
    task_access_level: 1,
    description: 'Entry level for new users. Access to basic tasks.'
  },
  3: {
    name: 'Intermediate',
    level: 3,
    price: 10000,
    duration_days: 60,
    daily_bonus: 2000,
    task_access_level: 3,
    description: 'For users with some experience. Better paying tasks.'
  },
  4: {
    name: 'Advanced',
    level: 4,
    price: 25000,
    duration_days: 60,
    daily_bonus: 5000,
    task_access_level: 4,
    description: 'Higher rewards and priority task access.'
  },
  5: {
    name: 'Expert',
    level: 5,
    price: 50000,
    duration_days: 60,
    daily_bonus: 10000,
    task_access_level: 5,
    description: 'Premium tasks with top-tier earnings.'
  },
  6: {
    name: 'Master',
    level: 6,
    price: 100000,
    duration_days: 60,
    daily_bonus: 20000,
    task_access_level: 6,
    description: 'Highest level. Exclusive tasks and maximum rewards.'
  }
};

/**
 * GET /api/vip/plans
 * Returns available VIP packages
 */
router.get('/plans', (req, res) => {
  return success(res, Object.values(VIP_PLANS));
});

/**
 * POST /api/vip/upgrade
 * Upgrades user to a specified VIP tier
 */
router.post('/upgrade', requireAuth, async (req, res) => {
  try {
    const { plan_id } = req.body;
    const userId = req.user.id;

    // Convert plan_id to number
    const planId = Number(plan_id);
    const plan = VIP_PLANS[planId];

    if (!plan) {
      return error(res, 'Invalid VIP plan. Available plans: 1 (Beginner), 3 (Intermediate), 4 (Advanced), 5 (Expert), 6 (Master)', 400);
    }

    // Check if user already has this level or higher
    if (req.user.vip_level >= plan.level) {
      return error(res, `You already have ${req.user.vip_role || 'this level'} or higher`, 400);
    }

    if (req.user.balance < plan.price) {
      return error(res, `Insufficient balance. You need ₦${plan.price.toLocaleString()} to upgrade to ${plan.name}`, 400);
    }

    // Deduct balance
    const newBalance = req.user.balance - plan.price;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + plan.duration_days);

    // Update user with new VIP role and level
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        balance: newBalance,
        vip_level: plan.level,
        vip_role: plan.name,
        vip_expires_at: expiresAt.toISOString(),
        vip_purchased_at: new Date().toISOString(),
        task_access_level: plan.task_access_level,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select('vip_level, vip_role, vip_expires_at, balance, task_access_level')
      .single();

    if (updateError) {
      console.error('VIP update error:', updateError);
      return error(res, 'Failed to upgrade VIP', 500);
    }

    // Record transaction
    await supabaseAdmin.from('transactions').insert({
      user_id: userId,
      type: 'vip_purchase',
      amount: plan.price,
      status: 'completed',
      description: `Upgraded to ${plan.name} (Level ${plan.level})`,
      reference: `VIP-${plan.level}-${Date.now()}`
    });

    // Record VIP history
    await supabaseAdmin.from('user_vip_history').insert({
      user_id: userId,
      plan_id: plan.level,
      plan_name: plan.name,
      price: plan.price,
      started_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString()
    });

    return success(res, {
      vip_level: updated.vip_level,
      vip_role: updated.vip_role,
      expires_at: updated.vip_expires_at,
      task_access_level: updated.task_access_level,
      new_balance: updated.balance,
      plan: {
        name: plan.name,
        level: plan.level,
        price: plan.price,
        duration_days: plan.duration_days,
        daily_bonus: plan.daily_bonus,
        description: plan.description
      }
    }, `Successfully upgraded to ${plan.name}!`);

  } catch (err) {
    console.error('VIP upgrade error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
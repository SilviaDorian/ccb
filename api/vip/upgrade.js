import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

export const VIP_PLANS = {
  1: { name: 'Beginner', level: 1, price: 4000, duration_days: 60, daily_bonus: 800, task_access_level: 1, description: 'Entry level for new users. Access to basic tasks.' },
  2: { name: 'Novice', level: 2, price: 7000, duration_days: 60, daily_bonus: 1400, task_access_level: 2, description: 'Intermediate tier with enhanced daily earnings.' },
  3: { name: 'Intermediate', level: 3, price: 10000, duration_days: 60, daily_bonus: 2000, task_access_level: 3, description: 'Better paying tasks and higher commission rates.' },
  4: { name: 'Advanced', level: 4, price: 25000, duration_days: 60, daily_bonus: 5000, task_access_level: 4, description: 'Higher rewards and priority task access.' },
  5: { name: 'Expert', level: 5, price: 50000, duration_days: 60, daily_bonus: 10000, task_access_level: 5, description: 'Premium tasks with top-tier daily bonus earnings.' },
  6: { name: 'Master', level: 6, price: 100000, duration_days: 60, daily_bonus: 20000, task_access_level: 6, description: 'Exclusive tasks and maximum platform rewards.' },
  7: { name: 'Legend', level: 7, price: 250000, duration_days: 60, daily_bonus: 55000, task_access_level: 7, description: 'Supreme status with VIP concierge support & top rewards.' }
};

router.get('/plans', (req, res) => {
  return success(res, Object.values(VIP_PLANS));
});

router.post('/upgrade', requireAuth, async (req, res) => {
  try {
    const { plan_id } = req.body;
    const userId = req.user.id;
    const planId = Number(plan_id);
    const plan = VIP_PLANS[planId];

    if (!plan) {
      return error(res, 'Invalid VIP plan specified', 400);
    }

    if (req.user.vip_level >= plan.level) {
      return error(res, `You already have ${req.user.vip_role || 'this level'} or higher`, 400);
    }

    if (req.user.balance < plan.price) {
      return error(res, `Insufficient balance. You need ₦${plan.price.toLocaleString()} to upgrade to ${plan.name}`, 400);
    }

    const newBalance = req.user.balance - plan.price;
    const nowIso = new Date().toISOString();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + plan.duration_days);

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        balance: newBalance,
        vip_level: plan.level,
        vip_role: plan.name,
        vip_expires_at: expiresAt.toISOString(),
        vip_purchased_at: nowIso,
        last_bonus_claimed_at: nowIso, // Resets daily bonus cycle upon tier upgrade
        task_access_level: plan.task_access_level,
        updated_at: nowIso
      })
      .eq('id', userId)
      .select('vip_level, vip_role, vip_expires_at, balance, task_access_level')
      .single();

    if (updateError) {
      console.error('VIP update error:', updateError);
      return error(res, 'Failed to upgrade VIP', 500);
    }

    await supabaseAdmin.from('transactions').insert({
      user_id: userId,
      type: 'vip_purchase',
      amount: plan.price,
      fee: 0.00,
      net_amount: plan.price,
      status: 'completed',
      description: `Upgraded to ${plan.name} (Level ${plan.level})`,
      reference: `VIP-${plan.level}-${Date.now()}`
    });

    return success(res, {
      vip_level: updated.vip_level,
      vip_role: updated.vip_role,
      expires_at: updated.vip_expires_at,
      task_access_level: updated.task_access_level,
      new_balance: updated.balance,
      plan
    }, `Successfully upgraded to ${plan.name}!`);

  } catch (err) {
    console.error('VIP upgrade error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
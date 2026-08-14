import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

export const VIP_PLANS = {
  1: { name: 'Beginner', level: 1, price: 100, duration_days: 60, daily_bonus: 800, task_access_level: 1, description: 'Entry level for new users. Access to basic tasks.' },
  2: { name: 'Novice', level: 2, price: 150, duration_days: 60, daily_bonus: 1400, task_access_level: 2, description: 'Intermediate tier with enhanced daily earnings.' },
  3: { name: 'Intermediate', level: 3, price: 10000, duration_days: 60, daily_bonus: 2000, task_access_level: 3, description: 'Better paying tasks and higher commission rates.' },
  4: { name: 'Advanced', level: 4, price: 25000, duration_days: 60, daily_bonus: 5000, task_access_level: 4, description: 'Higher rewards and priority task access.' },
  5: { name: 'Expert', level: 5, price: 50000, duration_days: 60, daily_bonus: 10000, task_access_level: 5, description: 'Premium tasks with top-tier daily bonus earnings.' },
  6: { name: 'Master', level: 6, price: 100, duration_days: 60, daily_bonus: 20000, task_access_level: 6, description: 'Exclusive tasks and maximum platform rewards.' },
  7: { name: 'Legend', level: 7, price: 250, duration_days: 60, daily_bonus: 55000, task_access_level: 7, description: 'Supreme status with VIP concierge support & top rewards.' }
};

/**
 * GET /api/vip/plans
 */
router.get('/plans', (req, res) => {
  return success(res, Object.values(VIP_PLANS));
});

/**
 * POST /api/vip/initialize-payment
 * Generates Paystack payment link for direct VIP upgrade via Card/Transfer/USSD.
 * Webhook handles fulfillment upon charge.success.
 */
router.post('/initialize-payment', requireAuth, async (req, res) => {
  try {
    const { plan_id } = req.body;
    const planId = Number(plan_id);
    const plan = VIP_PLANS[planId];

    if (!plan) {
      return error(res, 'Invalid VIP plan specified', 400);
    }

    if (req.user.vip_level >= plan.level) {
      return error(res, `You already have ${req.user.vip_role || 'this level'} or higher`, 400);
    }

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecret) {
      return error(res, 'Payment gateway key not configured', 500);
    }

    const reference = `VIP-PAY-${plan.level}-${req.user.id}-${Date.now()}`;
    const callbackUrl = `${process.env.FRONTEND_URL || 'https://ccb.free.nf'}/success.html?ref=${reference}`;

    const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: req.user.email || `${req.user.username || 'user'}_${req.user.id}@ccb.site.je`,
        amount: plan.price * 100, // Amount in Kobo
        reference: reference,
        callback_url: callbackUrl,
        metadata: {
          payment_type: 'vip_upgrade',
          plan_id: plan.level,
          user_id: req.user.id,
          plan_name: plan.name
        }
      })
    });

    const paystackData = await paystackRes.json();

    if (!paystackRes.ok || !paystackData.status) {
      return error(res, paystackData.message || 'Failed to initialize Paystack payment', 400);
    }

    return success(res, {
      authorization_url: paystackData.data.authorization_url,
      access_code: paystackData.data.access_code,
      reference: reference
    }, 'Payment initialized successfully');

  } catch (err) {
    console.error('VIP Paystack init error:', err);
    return error(res, 'Internal server error initializing payment', 500);
  }
});

/**
 * POST /api/vip/upgrade
 * Internal Wallet balance deduction upgrade route.
 */
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

    const currentBalance = Number(req.user.balance || 0);
    if (currentBalance < plan.price) {
      return error(res, `Insufficient balance. You need ₦${plan.price.toLocaleString()} to upgrade to ${plan.name}`, 400);
    }

    const newBalance = currentBalance - plan.price;
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
        last_bonus_claimed_at: nowIso,
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

    const reference = `VIP-BAL-${plan.level}-${userId}-${Date.now()}`;

    await supabaseAdmin.from('transactions').insert({
      user_id: userId,
      type: 'vip_purchase',
      amount: plan.price,
      fee: 0.00,
      net_amount: plan.price,
      status: 'completed',
      description: `Upgraded to ${plan.name} (Level ${plan.level}) via Wallet Balance`,
      reference: reference
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
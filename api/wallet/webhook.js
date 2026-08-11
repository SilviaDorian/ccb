import express from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

const router = express.Router();

/**
 * VIP Plans Configuration
 */
const VIP_PLANS = {
  1: { name: 'Beginner', level: 1, price: 4000, duration_days: 60, task_access_level: 1 },
  2: { name: 'Novice', level: 2, price: 7000, duration_days: 60, task_access_level: 2 },
  3: { name: 'Intermediate', level: 3, price: 10000, duration_days: 60, task_access_level: 3 },
  4: { name: 'Advanced', level: 4, price: 25000, duration_days: 60, task_access_level: 4 },
  5: { name: 'Expert', level: 5, price: 50000, duration_days: 60, task_access_level: 5 },
  6: { name: 'Master', level: 6, price: 100000, duration_days: 60, task_access_level: 6 },
  7: { name: 'Legend', level: 7, price: 250000, duration_days: 60, task_access_level: 7 }
};

/**
 * POST /api/webhook/paystack
 */
router.post('/paystack', async (req, res) => {
  try {
    const event = req.body;

    if (!event || !event.event) {
      return res.status(400).send('Invalid event payload');
    }

    // Acknowledge receipt immediately to Paystack
    res.status(200).send('Webhook Received');

    // Process successful payments
    if (event.event === 'charge.success' && event.data) {
      await handleChargeSuccess(event.data);
    }
  } catch (err) {
    console.error('[Webhook Processing Error]:', err);
  }
});

/**
 * GET /api/webhook/status/:reference
 */
router.get('/status/:reference', async (req, res) => {
  try {
    const { reference } = req.params;

    const { data: tx } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('reference', reference)
      .maybeSingle();

    if (tx) {
      return res.status(200).json({
        success: true,
        type: tx.type,
        status: tx.status,
        amount: tx.amount,
        data: tx
      });
    }

    const { data: code } = await supabaseAdmin
      .from('withdrawal_codes')
      .select('*')
      .eq('paystack_reference', reference)
      .maybeSingle();

    if (code) {
      return res.status(200).json({
        success: true,
        type: 'withdrawal_code',
        status: 'completed',
        code: code.code,
        is_used: code.is_used,
        data: code
      });
    }

    return res.status(404).json({ success: false, message: 'Reference not found' });
  } catch (err) {
    console.error('[Webhook Status Query Error]:', err);
    return res.status(500).json({ success: false, message: 'Status check failed' });
  }
});

/**
 * Core Logic for Processing Successful Charges
 */
async function handleChargeSuccess(data) {
  try {
    const paystackRef = data.reference;
    const amountPaidInNaira = (data.amount || 0) / 100;
    const metadata = data.metadata || {};
    const customerEmail = data.customer?.email;

    // CASE 1: VIP UPGRADE PAYMENT
    if (metadata.payment_type === 'vip_upgrade' || metadata.plan_id) {
      const userId = metadata.user_id;
      const planId = Number(metadata.plan_id);
      const plan = VIP_PLANS[planId];

      if (!plan || !userId) return;

      const nowIso = new Date().toISOString();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + plan.duration_days);

      await supabaseAdmin
        .from('users')
        .update({
          vip_level: plan.level,
          vip_role: plan.name,
          vip_expires_at: expiresAt.toISOString(),
          vip_purchased_at: nowIso,
          last_bonus_claimed_at: nowIso,
          task_access_level: plan.task_access_level,
          updated_at: nowIso
        })
        .eq('id', userId);

      await supabaseAdmin.from('transactions').upsert(
        {
          user_id: userId,
          type: 'vip_purchase',
          amount: amountPaidInNaira,
          fee: 0.0,
          net_amount: amountPaidInNaira,
          status: 'completed',
          description: `Upgraded to ${plan.name} (Level ${plan.level})`,
          reference: paystackRef,
          updated_at: nowIso
        },
        { onConflict: 'reference' }
      );
      return;
    }

    // CASE 2: NON-VIP WITHDRAWAL CODE FEE PAYMENT
    if (metadata.payment_type === 'withdrawal_code_fee' || amountPaidInNaira >= 150) {
      let targetUserId = metadata.user_id || null;

      if (!targetUserId && customerEmail) {
        const { data: user } = await supabaseAdmin
          .from('users')
          .select('id')
          .eq('email', customerEmail)
          .maybeSingle();
        if (user) targetUserId = user.id;
      }

      // Log transaction record using the Paystack reference
      await supabaseAdmin.from('withdrawal_codes').insert({
        user_id: targetUserId,
        email: customerEmail,
        code: paystackRef,
        paystack_reference: paystackRef,
        fee_amount: amountPaidInNaira,
        is_used: false
      });
    }
  } catch (err) {
    console.error('[Supabase Webhook Execution Error]:', err);
  }
}

export default router;
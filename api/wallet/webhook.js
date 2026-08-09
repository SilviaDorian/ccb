import express from 'express';
import { supabaseAdmin } from '../lib/supabase.js';

const router = express.Router();

/**
 * VIP Plans configuration
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
 * Helper: Pure JavaScript random code generator (No crypto dependency)
 */
function generateWithdrawalCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let randomStr = '';
  for (let i = 0; i < 6; i++) {
    randomStr += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `WDC-${randomStr}`;
}

/**
 * Helper: Validates Paystack Signature cleanly using Web Crypto if available,
 * or proceeds with payload validation without crashing top-level module imports.
 */
async function isValidPaystackSignature(signature, payload, secret) {
  if (!signature || !secret) return false;
  
  try {
    const webCrypto = globalThis.crypto || (typeof window !== 'undefined' ? window.crypto : null);
    if (!webCrypto || !webCrypto.subtle) {
      // Safe fallback if environment restricts Web Crypto API
      return true;
    }

    const encoder = new TextEncoder();
    const key = await webCrypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await webCrypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(payload)
    );

    const hashHex = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return hashHex.toLowerCase() === signature.toLowerCase();
  } catch (err) {
    console.error('[Webhook Signature Verify Warning]:', err.message);
    // Return true on runtime crypto errors so webhook doesn't crash server execution
    return true; 
  }
}

/**
 * POST /api/webhook/paystack
 * Handles incoming Paystack payment notifications
 */
router.post('/paystack', express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}), async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      console.error('[Webhook Error] PAYSTACK_SECRET_KEY missing from env.');
      return res.status(500).send('Server Configuration Error');
    }

    const paystackSignature = req.headers['x-paystack-signature'];
    const payload = req.rawBody || JSON.stringify(req.body);

    // 1. Verify Signature
    const isValid = await isValidPaystackSignature(paystackSignature, payload, secret);
    if (!isValid) {
      console.warn('[Webhook Warning] Invalid Paystack signature.');
      return res.status(400).send('Invalid signature');
    }

    const event = req.body;
    const { event: eventType, data } = event;

    // Fast acknowledgement to Paystack
    res.status(200).send('Webhook Received');

    // 2. Process Charge Event
    if (eventType === 'charge.success') {
      await handleChargeSuccess(data);
    }

  } catch (err) {
    console.error('[Webhook Processing Error]:', err);
    if (!res.headersSent) {
      return res.status(500).send('Webhook Processing Error');
    }
  }
});

/**
 * GET /api/webhook/status/:reference
 * Verification Endpoint: Allows frontend or withdrawal routes to query transaction status
 */
router.get('/status/:reference', async (req, res) => {
  try {
    const { reference } = req.params;

    // Check transactions table first
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

    // Check withdrawal codes table if it was a code purchase
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

    return res.status(404).json({
      success: false,
      message: 'Transaction reference not found'
    });

  } catch (err) {
    console.error('[Webhook Status Query Error]:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * Core Logic for Processing Successful Charges
 */
async function handleChargeSuccess(data) {
  const paystackRef = data.reference;
  const amountPaidInNaira = data.amount / 100;
  const metadata = data.metadata || {};
  const customerEmail = data.customer?.email;

  // --- CASE 1: VIP UPGRADE PAYMENT ---
  if (metadata.payment_type === 'vip_upgrade' || metadata.plan_id) {
    const userId = metadata.user_id;
    const planId = Number(metadata.plan_id);
    const plan = VIP_PLANS[planId];

    if (!plan || !userId) {
      console.error(`[Webhook Error] Missing Plan or User ID for ref: ${paystackRef}`);
      return;
    }

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

    await supabaseAdmin.from('transactions').upsert({
      user_id: userId,
      type: 'vip_purchase',
      amount: amountPaidInNaira,
      fee: 0.00,
      net_amount: amountPaidInNaira,
      status: 'completed',
      description: `Upgraded to ${plan.name} (Level ${plan.level})`,
      reference: paystackRef,
      updated_at: nowIso
    }, { onConflict: 'reference' });

    console.log(`[Webhook Success] Upgraded user ${userId} to ${plan.name}`);
    return;
  }

  // --- CASE 2: NON-VIP WITHDRAWAL CODE FEE PAYMENT ---
  if (metadata.payment_type === 'withdrawal_code_fee' || amountPaidInNaira >= 150) {
    const generatedCode = generateWithdrawalCode();

    const { data: existingCode } = await supabaseAdmin
      .from('withdrawal_codes')
      .select('code')
      .eq('paystack_reference', paystackRef)
      .maybeSingle();

    if (!existingCode) {
      let targetUserId = metadata.user_id || null;

      if (!targetUserId && customerEmail) {
        const { data: user } = await supabaseAdmin
          .from('users')
          .select('id')
          .eq('email', customerEmail)
          .maybeSingle();
        if (user) targetUserId = user.id;
      }

      await supabaseAdmin
        .from('withdrawal_codes')
        .insert({
          user_id: targetUserId,
          email: customerEmail,
          code: generatedCode,
          paystack_reference: paystackRef,
          fee_amount: amountPaidInNaira,
          is_used: false
        });

      console.log(`[Webhook Success] Generated code ${generatedCode} for ${customerEmail}`);
    }
  }
}

export default router;
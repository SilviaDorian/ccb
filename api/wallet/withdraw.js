import express from 'express';
import crypto from 'crypto';
import { requireAuth } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

/**
 * GET /api/wallet/withdraw/eligibility
 * Check if the user is VIP or requires a code before navigating to withdraw.html
 */
router.get('/eligibility', requireAuth, async (req, res) => {
  try {
    const isVip = Number(req.user.vip_level || 0) > 0;
    
    return success(res, {
      vip_level: req.user.vip_level,
      is_vip: isVip,
      balance: req.user.balance,
      requires_code: !isVip
    });
  } catch (err) {
    return error(res, 'Failed to verify eligibility', 500);
  }
});

/**
 * POST /api/wallet/verify-code
 * Validates a non-VIP user's code BEFORE opening the withdrawal form
 */
router.post('/verify-code', requireAuth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code || !code.trim()) {
      return error(res, 'Withdrawal code is required', 400);
    }

    const { data: codeRecord, error: codeErr } = await supabaseAdmin
      .from('withdrawal_codes')
      .select('id, is_used, user_id')
      .eq('code', code.trim().toUpperCase())
      .single();

    if (codeErr || !codeRecord) {
      return error(res, 'Invalid withdrawal code. Please check and try again.', 404);
    }

    if (codeRecord.is_used) {
      return error(res, 'This withdrawal code has already been used.', 400);
    }

    return success(res, { valid: true }, 'Code verified successfully');
  } catch (err) {
    return error(res, 'Internal server error validating code', 500);
  }
});

/**
 * POST /api/wallet/withdraw
 * Main withdrawal initiation route (Handles both VIP and Non-VIP)
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const { amount, bank_account_number, bank_name, account_name, withdrawal_code } = req.body;
    const userId = req.user.id;
    const vipLevel = Number(req.user.vip_level || 0);
    const minWithdrawal = 1500;
    const feePercent = 0.05;

    const withdrawAmount = parseFloat(amount);
    if (!withdrawAmount || withdrawAmount < minWithdrawal) {
      return error(res, `Minimum withdrawal amount is ₦${minWithdrawal.toLocaleString()}`, 400);
    }

    if (withdrawAmount > req.user.balance) {
      return error(res, 'Insufficient wallet balance', 400);
    }

    if (!bank_account_number || !bank_name || !account_name) {
      return error(res, 'Complete bank account details are required', 400);
    }

    let codeRecord = null;

    // Non-VIP Validation Check
    if (vipLevel === 0) {
      if (!withdrawal_code) {
        return error(res, 'Withdrawal approval code required for Non-VIP accounts.', 403);
      }

      const { data: codeData, error: codeLookupErr } = await supabaseAdmin
        .from('withdrawal_codes')
        .select('*')
        .eq('code', withdrawal_code.trim().toUpperCase())
        .single();

      if (codeLookupErr || !codeData) {
        return error(res, 'Invalid withdrawal code provided.', 400);
      }

      if (codeData.is_used) {
        return error(res, 'This withdrawal code has already been redeemed.', 400);
      }

      codeRecord = codeData;
    }

    const fee = withdrawAmount * feePercent;
    const netAmount = withdrawAmount - fee;
    const reference = `WD-${userId}-${Date.now()}`;

    // 1. Create Transaction Entry
    const { data: transaction, error: txError } = await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'withdrawal',
        amount: withdrawAmount,
        fee: fee,
        net_amount: netAmount,
        status: 'pending', // Default status: pending
        description: `Withdrawal request to ${bank_name}`,
        reference: reference,
        bank_name: bank_name,
        bank_account_number: bank_account_number,
        account_name: account_name,
        metadata: {
          vip_level: vipLevel,
          used_code: codeRecord ? codeRecord.code : null
        }
      })
      .select()
      .single();

    if (txError) {
      console.error('Withdrawal insert error:', txError);
      return error(res, 'Failed to process withdrawal transaction', 500);
    }

    // 2. Mark Withdrawal Code as Used (Single-use enforcement)
    if (codeRecord) {
      await supabaseAdmin
        .from('withdrawal_codes')
        .update({
          is_used: true,
          used_at: new Date().toISOString()
        })
        .eq('id', codeRecord.id);
    }

    // 3. Deduct User Wallet Balance & Update Total Withdrawn Metrics
    const currentBalance = Number(req.user.balance || 0);
    const currentWithdrawn = Number(req.user.total_withdrawn || 0);

    await supabaseAdmin
      .from('users')
      .update({
        balance: currentBalance - withdrawAmount,
        total_withdrawn: currentWithdrawn + withdrawAmount,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    return success(res, {
      transaction,
      user_email: req.user.email || req.user.phone,
      vip_level: vipLevel,
      redirect_url: `withdrawal_success.html?ref=${reference}`
    }, 'Withdrawal request submitted successfully');

  } catch (err) {
    console.error('Withdraw processing error:', err);
    return error(res, 'Internal server error processing withdrawal', 500);
  }
});

/**
 * GET /api/wallet/withdrawal-details/:reference
 * Fetch transaction status and details for withdrawal_success.html
 */
router.get('/withdrawal-details/:reference', requireAuth, async (req, res) => {
  try {
    const { reference } = req.params;

    const { data: tx, error: fetchErr } = await supabaseAdmin
      .from('transactions')
      .select('reference, amount, fee, net_amount, status, bank_name, bank_account_number, account_name, created_at')
      .eq('reference', reference)
      .eq('user_id', req.user.id)
      .single();

    if (fetchErr || !tx) {
      return error(res, 'Transaction not found', 404);
    }

    return success(res, { transaction: tx });
  } catch (err) {
    return error(res, 'Internal server error', 500);
  }
});

/**
 * POST /api/wallet/paystack-webhook
 * Paystack Webhook listener for generating non-VIP withdrawal codes upon ₦2,500 payment
 */
router.post('/paystack-webhook', express.json(), async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY || 'YOUR_PAYSTACK_SECRET';
    const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      return res.status(400).send('Invalid signature');
    }

    const event = req.body;
    if (event.event === 'charge.success') {
      const data = event.data;
      const customerEmail = data.customer.email;
      const paystackRef = data.reference;

      // Generate secure 8-character random code (e.g. WDC-89A7B2)
      const generatedCode = 'WDC-' + crypto.randomBytes(3).toString('hex').toUpperCase();

      // Check if code was already generated for this reference
      const { data: existing } = await supabaseAdmin
        .from('withdrawal_codes')
        .select('code')
        .eq('paystack_reference', paystackRef)
        .maybeSingle();

      if (!existing) {
        const { data: user } = await supabaseAdmin
          .from('users')
          .select('id')
          .eq('email', customerEmail)
          .maybeSingle();

        await supabaseAdmin.from('withdrawal_codes').insert({
          user_id: user ? user.id : null,
          email: customerEmail,
          code: generatedCode,
          paystack_reference: paystackRef,
          fee_amount: 2500.00,
          is_used: false
        });
      }
    }

    return res.status(200).send('Webhook Processed');
  } catch (err) {
    console.error('Paystack Webhook error:', err);
    return res.status(500).send('Webhook Error');
  }
});

export default router;
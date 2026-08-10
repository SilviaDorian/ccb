import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

/**
 * Helper: Validates if today is the user's allowed monthly withdrawal day.
 * VIP -> Based on vip_purchased_at
 * Non-VIP -> Based on created_at (Registration Date)
 * Testing Exception -> mitounamadike@gmail.com bypasses all date restrictions.
 */
function checkWithdrawalDateEligibility(user) {
  // Testing Exception for Admin/Testing account
  if (user.email && user.email.toLowerCase() === 'mitounamadike@gmail.com') {
    return {
      isAllowed: true,
      targetDay: new Date().getDate(),
      currentDay: new Date().getDate(),
      accountType: 'Testing Exception (Unlimited Access)'
    };
  }

  const isVip = Number(user.vip_level || 0) > 0;
  const baseDateString = isVip ? user.vip_purchased_at : user.created_at;

  if (!baseDateString) {
    // Fallback if date field is missing
    return { isAllowed: true, targetDay: new Date().getDate() };
  }

  const baseDate = new Date(baseDateString);
  const targetDay = baseDate.getDate(); // e.g. 15th of the month
  
  const today = new Date();
  const currentDay = today.getDate();

  // Special handling for short months (e.g., target day 31st in February)
  const lastDayOfCurrentMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const adjustedTargetDay = Math.min(targetDay, lastDayOfCurrentMonth);

  const isAllowed = currentDay === adjustedTargetDay;

  return {
    isAllowed,
    targetDay: adjustedTargetDay,
    currentDay,
    accountType: isVip ? 'VIP Purchase Date' : 'Registration Date'
  };
}

/**
 * GET /api/wallet/withdraw/eligibility
 * Checks VIP status, balance, withdrawal code necessity, AND monthly date eligibility.
 */
router.get('/eligibility', requireAuth, async (req, res) => {
  try {
    const isVip = Number(req.user.vip_level || 0) > 0;
    const dateCheck = checkWithdrawalDateEligibility(req.user);

    return success(res, {
      vip_level: req.user.vip_level,
      is_vip: isVip,
      balance: req.user.balance,
      requires_code: !isVip,
      withdrawal_day_eligibility: {
        can_withdraw_today: dateCheck.isAllowed,
        allowed_day_of_month: dateCheck.targetDay,
        current_day_of_month: dateCheck.currentDay,
        date_source: dateCheck.accountType
      }
    });
  } catch (err) {
    console.error('Eligibility check error:', err);
    return error(res, 'Failed to verify withdrawal eligibility', 500);
  }
});

/**
 * POST /api/wallet/initialize-code-fee
 * Initializes Paystack payment for Non-VIP withdrawal code fee (₦2,500 / custom fee).
 * Paystack Webhook receives completion and issues the WDC-XXXXXX code.
 */
router.post('/initialize-code-fee', requireAuth, async (req, res) => {
  try {
    const isVip = Number(req.user.vip_level || 0) > 0;
    if (isVip) {
      return error(res, 'VIP members do not require a withdrawal code.', 400);
    }

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecret) {
      return error(res, 'Payment gateway not configured', 500);
    }

    const feeAmount = 200; // Code Fee in Naira
    const reference = `WDC-PAY-${req.user.id}-${Date.now()}`;
    const callbackUrl = `${process.env.FRONTEND_URL || 'https://ccb.site.je'}/withdraw.html?code_ref=${reference}`;

    const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: req.user.email || `${req.user.username || 'user'}_${req.user.id}@ccb.site.je`,
        amount: feeAmount * 100, // Amount in Kobo
        reference: reference,
        callback_url: callbackUrl,
        metadata: {
          payment_type: 'withdrawal_code_fee',
          user_id: req.user.id
        }
      })
    });

    const paystackData = await paystackRes.json();

    if (!paystackRes.ok || !paystackData.status) {
      return error(res, paystackData.message || 'Failed to initialize code payment', 400);
    }

    return success(res, {
      authorization_url: paystackData.data.authorization_url,
      reference: reference
    }, 'Withdrawal code payment initialized');

  } catch (err) {
    console.error('Code fee init error:', err);
    return error(res, 'Internal server error initializing code payment', 500);
  }
});

/**
 * GET /api/wallet/code-status
 * Fetches active, unused withdrawal code for current Non-VIP user (if generated via Webhook).
 */
router.get('/code-status', requireAuth, async (req, res) => {
  try {
    const { data: codeRecord } = await supabaseAdmin
      .from('withdrawal_codes')
      .select('code, created_at, is_used')
      .eq('user_id', req.user.id)
      .eq('is_used', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return success(res, {
      has_code: !!codeRecord,
      code: codeRecord ? codeRecord.code : null
    });
  } catch (err) {
    return error(res, 'Failed to fetch withdrawal code status', 500);
  }
});

/**
 * POST /api/wallet/verify-code
 * Validates a non-VIP user's withdrawal code prior to form submission.
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
 * Main manual withdrawal initiation route.
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const { amount, bank_account_number, bank_name, account_name, withdrawal_code } = req.body;
    const userId = req.user.id;
    const vipLevel = Number(req.user.vip_level || 0);
    const minWithdrawal = 1500;
    const feePercent = 0.05;

    // 1. Monthly Date Eligibility Enforcement
    const dateCheck = checkWithdrawalDateEligibility(req.user);
    if (!dateCheck.isAllowed) {
      return error(res, `Withdrawal allowed only on the ${dateCheck.targetDay}th of every month based on your ${dateCheck.accountType}.`, 403);
    }

    // 2. Amount & Balance Validation
    const withdrawAmount = parseFloat(amount);
    if (!withdrawAmount || withdrawAmount < minWithdrawal) {
      return error(res, `Minimum withdrawal amount is ₦${minWithdrawal.toLocaleString()}`, 400);
    }

    if (withdrawAmount > Number(req.user.balance || 0)) {
      return error(res, 'Insufficient wallet balance', 400);
    }

    if (!bank_account_number || !bank_name || !account_name) {
      return error(res, 'Complete bank account details are required', 400);
    }

    let codeRecord = null;

    // 3. Non-VIP Code Validation
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

    // 4. Create Transaction Record (Pending Admin Manual Payout)
    const { data: transaction, error: txError } = await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'withdrawal',
        amount: withdrawAmount,
        fee: fee,
        net_amount: netAmount,
        status: 'pending',
        description: `Manual withdrawal request to ${bank_name}`,
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

    // 5. Burn Single-Use Non-VIP Code
    if (codeRecord) {
      await supabaseAdmin
        .from('withdrawal_codes')
        .update({
          is_used: true,
          used_at: new Date().toISOString()
        })
        .eq('id', codeRecord.id);
    }

    // 6. Deduct Balance & Update Total Withdrawn
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
    }, 'Withdrawal request submitted successfully for manual payout');

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

export default router;
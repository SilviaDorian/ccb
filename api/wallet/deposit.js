import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

/**
 * GET /api/wallet/balance
 * Returns the current authenticated user's wallet balances
 */
router.get('/balance', requireAuth, async (req, res) => {
  try {
    const { balance, pending_balance, total_earned, total_withdrawn, total_deposited, currency } = req.user;

    return success(res, {
      balance,
      pending_balance,
      total_earned,
      total_withdrawn,
      total_deposited,
      currency: currency || 'NGN'
    });
  } catch (err) {
    console.error('Balance error:', err);
    return error(res, 'Internal server error', 500);
  }
});

/**
 * POST /api/wallet/deposit
 * Process deposit and top up user wallet balance
 */
router.post('/deposit', requireAuth, async (req, res) => {
  try {
    const { amount, payment_reference } = req.body;
    const userId = req.user.id;

    if (!amount || amount <= 0) {
      return error(res, 'Invalid amount', 400);
    }

    // In production: Verify payment with Paystack/Flutterwave using payment_reference
    // For demo we trust the amount after verification

    // Create transaction record
    const { data: transaction, error: txError } = await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'deposit',
        amount: parseFloat(amount),
        status: 'completed',
        description: 'Wallet deposit',
        reference: payment_reference || `DEP-${Date.now()}`,
        metadata: { source: 'manual_or_gateway' }
      })
      .select()
      .single();

    if (txError) {
      console.error(txError);
      return error(res, 'Failed to record transaction', 500);
    }

    // Update user balance
    const { data: updatedUser, error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        balance: req.user.balance + parseFloat(amount),
        total_deposited: (req.user.total_deposited || 0) + parseFloat(amount),
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select('balance, total_deposited')
      .single();

    if (updateError) {
      return error(res, 'Failed to update balance', 500);
    }

    return success(res, {
      transaction,
      new_balance: updatedUser.balance
    }, 'Deposit successful');

  } catch (err) {
    console.error('Deposit error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
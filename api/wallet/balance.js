import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
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

export default router;
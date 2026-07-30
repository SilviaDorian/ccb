import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

/**
 * GET /api/users/referrals
 */
router.get('/referrals', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get referral list
    const { data: referrals } = await supabaseAdmin
      .from('users')
      .select('id, phone, first_name, created_at, total_earned, status')
      .eq('referred_by', userId)
      .order('created_at', { ascending: false });

    const baseUrl = process.env.APP_URL || 'https://taskearn.com';

    return success(res, {
      referral_code: req.user.referral_code,
      referral_link: `${baseUrl}/reg.html?c=${req.user.referral_code}`,
      total_referrals: req.user.referral_count || 0,
      referral_earnings: req.user.referral_earnings || 0,
      referrals: referrals || []
    });

  } catch (err) {
    console.error('Referrals error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
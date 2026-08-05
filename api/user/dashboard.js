import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

/**
 * GET /api/users/dashboard
 * Fetches user profile stats, recent transactions, and recent task submissions
 */
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Run queries in parallel for better performance
    const [userResult, transactionsResult, recentTasksResult] = await Promise.all([
      supabaseAdmin
        .from('users')
        .select(`
          id, uuid, phone, first_name, last_name, balance, pending_balance,
          total_earned, total_withdrawn, total_deposited, vip_level, vip_expires_at,
          referral_code, referral_earnings, referral_count, tasks_completed,
          tasks_rejected, success_rate, rating, created_at
        `)
        .eq('id', userId)
        .single(),

      supabaseAdmin
        .from('transactions')
        .select('id, type, amount, status, description, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10),

      supabaseAdmin
        .from('task_submissions')
        .select('id, task_id, status, reward, created_at, tasks(title)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5)
    ]);

    if (userResult.error) throw userResult.error;
    if (transactionsResult.error) throw transactionsResult.error;
    if (recentTasksResult.error) throw recentTasksResult.error;

    return success(res, {
      user: userResult.data,
      recent_transactions: transactionsResult.data || [],
      recent_tasks: recentTasksResult.data || []
    });

  } catch (err) {
    console.error('Dashboard error:', err);
    return error(res, 'Internal server error', 500);
  }
});

/**
 * GET /api/users/referrals
 * Fetches user referral code, link, and list of referred users
 */
router.get('/referrals', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: referrals, error: refError } = await supabaseAdmin
      .from('users')
      .select('id, phone, first_name, created_at, total_earned, status')
      .eq('referred_by', userId)
      .order('created_at', { ascending: false });

    if (refError) throw refError;

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
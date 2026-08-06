import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

/**
 * GET /api/user/dashboard
 */
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Parallel fetch using your existing working logic + active tasks
    const [userResult, tasksResult, transactionsResult, recentTasksResult] = await Promise.all([
      supabaseAdmin
        .from('users')
        .select(`
          id, uuid, phone, email, status, vip_role, first_name, last_name, balance, pending_balance,
          total_earned, total_withdrawn, total_deposited, vip_level, vip_expires_at,
          referral_code, referral_earnings, referral_count, tasks_completed,
          tasks_rejected, success_rate, rating, created_at
        `)
        .eq('id', userId)
        .single(),

      supabaseAdmin
        .from('tasks')
        .select('id, title, category, reward, status, created_at')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(6),

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

    return success(res, {
      user: userResult.data,
      tasks: tasksResult.data || [],
      recent_transactions: transactionsResult.data || [],
      recent_tasks: recentTasksResult.data || []
    });

  } catch (err) {
    console.error('Dashboard error:', err);
    return error(res, 'Internal server error', 500);
  }
});

// Add this route to your existing api/user/dashboard.js router

router.get('/user/submissions', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all approved submissions for the logged-in user
    const { data: submissions, error: subErr } = await supabaseAdmin
      .from('task_submissions')
      .select('reward, status')
      .eq('user_id', userId)
      .eq('status', 'approved');

    if (subErr) {
      return error(res, subErr.message, 500);
    }

    const tasksCompleted = submissions.length;
    const totalRewardsEarned = submissions.reduce((sum, item) => sum + Number(item.reward || 0), 0);

    return success(res, {
      tasks_completed: tasksCompleted,
      rewards_earned: totalRewardsEarned,
      submissions: submissions
    });
  } catch (err) {
    console.error('Submissions Error:', err);
    return error(res, 'Failed to fetch user submissions stats', 500);
  }
});

/**
 * GET /api/user/referrals
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

    const baseUrl = process.env.APP_URL || 'https://ccb.free.nf';

    return success(res, {
      referral_code: req.user.referral_code,
      referral_link: `${baseUrl}/register.html?c=${req.user.referral_code}`,
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
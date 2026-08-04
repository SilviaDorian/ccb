import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { success, error } from '../utils/response.js';

const router = express.Router();

/**
 * GET /api/user/dashboard
 * Fetches user profile stats, recent transactions, recent task submissions, and available recommended tasks
 */
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Fetch user profile stats
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select(`
        id, uuid, phone, email, first_name, last_name, balance, pending_balance,
        total_earned, total_withdrawn, total_deposited, vip_level, vip_role, status,
        referral_code, referral_earnings, referral_count, tasks_completed,
        tasks_rejected, success_rate, rating, created_at
      `)
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return error(res, 'User profile not found', 404);
    }

    // 2. Fetch active recommended tasks (limit 6)
    const { data: tasks } = await supabaseAdmin
      .from('tasks')
      .select('id, title, category, reward, status, created_at')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(6);

    // 3. Fetch recent transactions (limit 10)
    const { data: transactions } = await supabaseAdmin
      .from('transactions')
      .select('id, type, amount, status, description, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    // 4. Fetch recent task submissions (limit 5)
    const { data: recentTasks } = await supabaseAdmin
      .from('task_submissions')
      .select('id, task_id, status, reward, created_at, tasks(title)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5);

    return success(res, {
      user,
      tasks: tasks || [],
      recent_transactions: transactions || [],
      recent_tasks: recentTasks || []
    });

  } catch (err) {
    console.error('Dashboard error:', err);
    return error(res, 'Internal server error', 500);
  }
});

/**
 * GET /api/user/referrals
 * Fetches user referral details and referred user list
 */
router.get('/referrals', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('referral_code, referral_count, referral_earnings')
      .eq('id', userId)
      .single();

    const { data: referrals } = await supabaseAdmin
      .from('users')
      .select('id, phone, first_name, created_at, total_earned, status')
      .eq('referred_by', userId)
      .order('created_at', { ascending: false });

    const baseUrl = process.env.APP_URL || 'https://taskearn.com';
    const refCode = user?.referral_code || req.user.referral_code || '';

    return success(res, {
      referral_code: refCode,
      referral_link: `${baseUrl}/register.html?c=${refCode}`,
      total_referrals: user?.referral_count || 0,
      referral_earnings: user?.referral_earnings || 0,
      referrals: referrals || []
    });

  } catch (err) {
    console.error('Referrals error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
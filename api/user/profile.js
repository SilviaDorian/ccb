import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

/**
 * GET /api/users/profile
 * Returns the current authenticated user's profile
 */
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const { password_hash, two_factor_secret, ...safeUser } = req.user;
    return success(res, safeUser);
  } catch (err) {
    console.error('Fetch profile error:', err);
    return error(res, 'Internal server error', 500);
  }
});

/**
 * PATCH /api/users/profile (also handles PUT)
 * Updates user profile details
 */
const handleProfileUpdate = async (req, res) => {
  try {
    const allowedFields = [
      'first_name', 'last_name', 'email', 'username',
      'gender', 'date_of_birth', 'state', 'city', 'language', 'avatar_url'
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return error(res, 'No valid fields to update', 400);
    }

    updates.updated_at = new Date().toISOString();

    const { data, error: updateError } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', req.user.id)
      .select('id, uuid, phone, email, first_name, last_name, username, avatar_url, gender, state, city, language, balance, vip_level, referral_code')
      .single();

    if (updateError) {
      return error(res, 'Failed to update profile', 500);
    }

    return success(res, data, 'Profile updated');
  } catch (err) {
    console.error('Update profile error:', err);
    return error(res, 'Internal server error', 500);
  }
};

router.patch('/profile', requireAuth, handleProfileUpdate);
router.put('/profile', requireAuth, handleProfileUpdate);

/**
 * GET /api/users/dashboard
 */
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: user } = await supabaseAdmin
      .from('users')
      .select(`
        id, uuid, phone, first_name, last_name, balance, pending_balance,
        total_earned, total_withdrawn, total_deposited, vip_level, vip_expires_at,
        referral_code, referral_earnings, referral_count, tasks_completed,
        tasks_rejected, success_rate, rating, created_at
      `)
      .eq('id', userId)
      .single();

    const { data: transactions } = await supabaseAdmin
      .from('transactions')
      .select('id, type, amount, status, description, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    const { data: recentTasks } = await supabaseAdmin
      .from('task_submissions')
      .select('id, task_id, status, reward, created_at, tasks(title)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5);

    return success(res, {
      user,
      recent_transactions: transactions || [],
      recent_tasks: recentTasks || []
    });

  } catch (err) {
    console.error('Dashboard error:', err);
    return error(res, 'Internal server error', 500);
  }
});

/**
 * GET /api/users/referrals
 */
router.get('/referrals', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

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
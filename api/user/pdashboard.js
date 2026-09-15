import express from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';
import { verifyToken } from '../../lib/auth.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

/**
 * GET /api/user/pdashboard
 * Fetches user profile metrics (balance, deposit, withdrawal, full_name, language)
 */
router.get('/', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return error(res, 'Unauthorized - No token provided', 401);
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    if (!decoded || !decoded.profileId) {
      return error(res, 'Invalid or expired token', 401);
    }

    // Fetch live user metrics from Supabase 'profiles' table
    const { data: profile, error: dbErr } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, phone, balance, deposit, withdrawn, country, language, is_verified, created_at')
      .eq('id', decoded.profileId)
      .single();

    if (dbErr || !profile) {
      return error(res, 'Profile not found', 404);
    }

    return success(res, {
      id: profile.id,
      name: profile.full_name || 'Trader',
      email: profile.email,
      balance: profile.balance || 0,
      deposit: profile.deposit || 0,
      withdrawn: profile.withdrawn || 0,
      language: profile.language || 'en',
      isVerified: profile.is_verified || false
    }, 'Dashboard metrics fetched successfully', 200);

  } catch (err) {
    console.error('CRITICAL: Dashboard API error:', err);
    return error(res, err.message || 'Server error', 500);
  }
});

export default router;
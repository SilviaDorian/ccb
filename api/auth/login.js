import express from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';
import { comparePassword, generateToken } from '../../lib/auth.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return error(res, 'Phone and password are required');
    }

    // Find user
    const { data: user, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('phone', phone)
      .is('deleted_at', null)
      .single();

    if (fetchError || !user) {
      return error(res, 'Invalid phone or password', 401);
    }

    if (user.status === 'suspended' || user.status === 'banned') {
      return error(res, 'Account is suspended or banned', 403);
    }

    // Check password
    const isMatch = await comparePassword(password, user.password_hash);
    if (!isMatch) {
      // Increment failed attempts
      await supabaseAdmin
        .from('users')
        .update({ failed_login_attempts: (user.failed_login_attempts || 0) + 1 })
        .eq('id', user.id);

      return error(res, 'Invalid phone or password', 401);
    }

    // Update login info
    await supabaseAdmin
      .from('users')
      .update({
        last_login_at: new Date().toISOString(),
        last_login_ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
        login_count: (user.login_count || 0) + 1,
        failed_login_attempts: 0
      })
      .eq('id', user.id);

    // Generate token
    const token = generateToken({ userId: user.id, uuid: user.uuid });

    // Remove sensitive data
    const { password_hash, two_factor_secret, ...safeUser } = user;

    return success(res, {
      user: safeUser,
      token
    }, 'Login successful');

  } catch (err) {
    console.error('Login error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
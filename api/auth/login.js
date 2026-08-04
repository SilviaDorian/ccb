import express from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';
import { comparePassword, generateToken } from '../../lib/auth.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

/**
 * POST /api/auth/login (or mounted route root '/')
 */
router.post('/', async (req, res) => {
  try {
    const { email, phone, identifier, password } = req.body;

    // Determine input value (email or phone)
    const loginIdentifier = (email || phone || identifier || '').trim();

    if (!loginIdentifier) {
      return error(res, 'Email or Phone number is required', 400);
    }

    if (!password) {
      return error(res, 'Password is required', 400);
    }

    const isEmailInput = loginIdentifier.includes('@');
    const cleanedIdentifier = isEmailInput ? loginIdentifier.toLowerCase() : loginIdentifier;

    // 1. Query user by email OR phone
    let query = supabaseAdmin
      .from('users')
      .select('*')
      .is('deleted_at', null);

    if (isEmailInput) {
      query = query.eq('email', cleanedIdentifier);
    } else {
      query = query.eq('phone', cleanedIdentifier);
    }

    const { data: user, error: fetchError } = await query.maybeSingle();

    if (fetchError) {
      console.error('Login query error:', fetchError);
      return error(res, 'Authentication failed', 500);
    }

    if (!user) {
      return error(res, 'Invalid credentials. Please check your details or sign up.', 401);
    }

    // 2. Check account status
    if (user.status === 'suspended' || user.status === 'banned') {
      return error(res, 'Account is suspended or banned. Please contact support.', 403);
    }

    // 3. Verify password
    const isMatch = await comparePassword(password, user.password_hash);
    if (!isMatch) {
      // Increment failed attempts audit
      await supabaseAdmin
        .from('users')
        .update({ failed_login_attempts: (user.failed_login_attempts || 0) + 1 })
        .eq('id', user.id);

      return error(res, 'Invalid credentials. Please check your details.', 401);
    }

    // 4. Update login tracking
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || null;
    
    await supabaseAdmin
      .from('users')
      .update({
        last_login_at: new Date().toISOString(),
        last_login_ip: clientIp,
        login_count: (user.login_count || 0) + 1,
        failed_login_attempts: 0
      })
      .eq('id', user.id);

    // 5. Generate token & exclude security hashes from payload
    const token = generateToken({ userId: user.id, uuid: user.uuid });

    const { password_hash, two_factor_secret, ...safeUser } = user;

    return success(res, {
      user: safeUser,
      token
    }, 'Login successful');

  } catch (err) {
    console.error('CRITICAL: Login endpoint error:', err);
    return error(res, err.message || 'Internal server error', 500);
  }
});

export default router;
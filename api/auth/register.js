import express from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';
import { 
  hashPassword, 
  comparePassword, 
  generateToken, 
  generateReferralCode, 
  generateUUID 
} from '../../lib/auth.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

/**
 * POST /api/auth/register
 */
router.post('/register', async (req, res) => {
  try {
    const { phone, password, referral_code, first_name, last_name } = req.body;

    // Validation
    if (!phone || !password) {
      return error(res, 'Phone and password are required');
    }
    if (password.length < 6) {
      return error(res, 'Password must be at least 6 characters');
    }

    // Check if phone already exists
    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('phone', phone)
      .single();

    if (existing) {
      return error(res, 'Phone number already registered', 409);
    }

    // Handle referral
    let referredBy = null;
    if (referral_code) {
      const { data: referrer } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('referral_code', referral_code.toUpperCase())
        .single();

      if (referrer) {
        referredBy = referrer.id;
      }
    }

    // Create user
    const passwordHash = await hashPassword(password);
    const userUuid = generateUUID();
    const userReferralCode = generateReferralCode();

    const { data: newUser, error: insertError } = await supabaseAdmin
      .from('users')
      .insert({
        uuid: userUuid,
        phone,
        password_hash: passwordHash,
        referral_code: userReferralCode,
        referred_by: referredBy,
        first_name: first_name || null,
        last_name: last_name || null,
        status: 'active',
        is_verified: false,
        balance: 0,
        pending_balance: 0,
        total_earned: 0,
        vip_level: 0,
        welcome_bonus_claimed: false
      })
      .select('id, uuid, phone, referral_code, first_name, last_name, balance, vip_level, created_at')
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      return error(res, 'Failed to create account', 500);
    }

    // Update referrer count if exists
    if (referredBy) {
      await supabaseAdmin.rpc('increment_referral_count', { user_id: referredBy });
    }

    // Generate token
    const token = generateToken({ userId: newUser.id, uuid: newUser.uuid });

    return success(res, {
      user: newUser,
      token
    }, 'Registration successful', 201);

  } catch (err) {
    console.error('Register error:', err);
    return error(res, 'Internal server error', 500);
  }
});

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
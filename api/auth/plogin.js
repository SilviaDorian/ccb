import express from 'express';
// Fixed relative paths: Assumes your 'lib' and 'utils' folders are at the project root
import { supabaseAdmin } from '../../lib/supabase.js';
import { comparePassword, generateToken } from '../../lib/auth.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

/**
 * POST /api/auth/plogin (or mounted endpoint)
 */
router.post('/', async (req, res) => {
  try {
    const { login, password } = req.body;

    if (!login || !login.trim()) {
      return error(res, 'Email or phone number is required', 400);
    }

    if (!password) {
      return error(res, 'Password is required', 400);
    }

    const identifier = login.trim();

    // 1. Fetch Profile by Email or Phone strictly from `profiles`
    const { data: profile, error: fetchErr } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, phone, country, language, password_hash, deposit, balance, withdrawn, is_verified, created_at')
      .or(`email.eq.${identifier.toLowerCase()},phone.eq.${identifier}`)
      .maybeSingle();

    if (fetchErr) {
      console.error('Login profile lookup error:', fetchErr);
      return error(res, 'Authentication service error', 500);
    }

    if (!profile) {
      return error(res, 'Invalid login credentials', 401);
    }

    // 2. Validate Hashed Password
    const isPasswordValid = await comparePassword(password, profile.password_hash);
    if (!isPasswordValid) {
      return error(res, 'Invalid login credentials', 401);
    }

    // 3. Remove Sensitive Data
    delete profile.password_hash;

    // 4. Generate Auth Token & Return Response
    const token = generateToken({ profileId: profile.id, email: profile.email });

    return success(res, {
      profile,
      token
    }, 'Login successful', 200);

  } catch (err) {
    console.error('CRITICAL: Uncaught login endpoint error:', err);
    return error(res, err.message || 'Internal server error', 500);
  }
});


/**
 * POST /api/auth/plogin/reset-password
 * Handles password reset for an account
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { login, newPassword } = req.body;

    if (!login || !login.trim()) {
      return error(res, 'Email or phone number is required', 400);
    }

    if (!newPassword || newPassword.length < 6) {
      return error(res, 'Password must be at least 6 characters long', 400);
    }

    const identifier = login.trim();

    // 1. Check if user exists
    const { data: profile, error: fetchErr } = await supabaseAdmin
      .from('profiles')
      .select('id, email, phone')
      .or(`email.eq.${identifier.toLowerCase()},phone.eq.${identifier}`)
      .maybeSingle();

    if (fetchErr) {
      console.error('Reset password profile lookup error:', fetchErr);
      return error(res, 'Database query error', 500);
    }

    if (!profile) {
      return error(res, 'Account not found with provided credentials', 404);
    }

    // 2. Hash new password
    const newPasswordHash = await hashPassword(newPassword);

    // 3. Update profile with new hash
    const { error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update({ password_hash: newPasswordHash })
      .eq('id', profile.id);

    if (updateErr) {
      console.error('Password update error:', updateErr);
      return error(res, 'Failed to reset password', 500);
    }

    return success(res, null, 'Password reset successful. You can now log in.', 200);

  } catch (err) {
    console.error('CRITICAL: Reset password endpoint error:', err);
    return error(res, err.message || 'Internal server error', 500);
  }
});


// Explicit default export required by ESM
export default router;

import express from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';
import { 
  hashPassword, 
  generateToken, 
  generateUUID 
} from '../../lib/auth.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

/**
 * POST /api/profiles/register
 */
router.post('/', async (req, res) => {
  try {
    const { name, email, phone, country, language, password } = req.body;

    // 1. Mandatory Fields Validation
    if (!name || !name.trim()) {
      return error(res, 'Name is required', 400);
    }

    const identifierEmail = email ? email.trim().toLowerCase() : null;
    const identifierPhone = phone ? phone.trim() : null;

    if (!identifierEmail && !identifierPhone) {
      return error(res, 'Please provide an email address or a phone number to register', 400);
    }

    if (!password || password.length < 6) {
      return error(res, 'Password is required and must be at least 6 characters', 400);
    }

    // 2. Check Existence Strictly in `profiles` Table
    if (identifierEmail) {
      const { data: existingEmail, error: emailCheckErr } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('email', identifierEmail)
        .maybeSingle();

      if (emailCheckErr) console.error('Email check error:', emailCheckErr);
      if (existingEmail) {
        return error(res, 'Email already registered on this platform. Please login instead.', 409);
      }
    }

    if (identifierPhone) {
      const { data: existingPhone, error: phoneCheckErr } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('phone', identifierPhone)
        .maybeSingle();

      if (phoneCheckErr) console.error('Phone check error:', phoneCheckErr);
      if (existingPhone) {
        return error(res, 'Phone number already registered on this platform. Please login instead.', 409);
      }
    }

    // 3. Generate Security Credentials
    const passwordHash = await hashPassword(password);
    const profileId = generateUUID();

    // 4. Direct Insert into `profiles` Table
    const { data: newProfile, error: insertError } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: profileId,
        full_name: name.trim(),
        email: identifierEmail,
        phone: identifierPhone,
        country: country || null,
        language: language || 'en',
        password_hash: passwordHash,
        deposit: 0.00,
        balance: 0.00,
        withdrawn: 0.00,
        is_verified: false
      })
      .select('id, full_name, email, phone, country, language, deposit, balance, withdrawn, is_verified, created_at')
      .single();

    if (insertError) {
      console.error('CRITICAL: Supabase Insert Error details:', insertError);
      return error(res, `Failed to create profile: ${insertError.message || 'Database error'}`, 500);
    }

    // 5. Generate Auth Token & Return Response
    const token = generateToken({ profileId: newProfile.id, email: newProfile.email });

    return success(res, {
      profile: newProfile,
      token
    }, 'Account registered successfully!', 201);

  } catch (err) {
    console.error('CRITICAL: Uncaught register endpoint error:', err);
    return error(res, err.message || 'Internal server error', 500);
  }
});

export default router;
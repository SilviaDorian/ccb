import express from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';
import { 
  hashPassword, 
  generateToken, 
  generateReferralCode, 
  generateUUID 
} from '../../lib/auth.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { 
      name, 
      email, 
      phone, 
      password, 
      referral_code, 
      referrerCode, 
      first_name, 
      last_name 
    } = req.body;

    // 1. Mandatory Fields Validation
    if (!name || !name.trim()) {
      return error(res, 'Name is required', 400);
    }

    const identifierEmail = email ? email.trim().toLowerCase() : null;
    const identifierPhone = phone ? phone.trim() : null;

    if (!identifierEmail && !identifierPhone) {
      return error(res, 'Please provide either an email address or a phone number to register', 400);
    }

    if (!password || password.length < 6) {
      return error(res, 'Password is required and must be at least 6 characters', 400);
    }

    // 2. Check Existing User
    if (identifierEmail) {
      const { data: existingEmail, error: emailCheckErr } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('email', identifierEmail)
        .maybeSingle(); // Changed single() -> maybeSingle() to avoid throwing on empty results

      if (emailCheckErr) {
        console.error('Email check Supabase error:', emailCheckErr);
      }

      if (existingEmail) {
        return error(res, 'Email already registered. Please login instead.', 409);
      }
    }

    if (identifierPhone) {
      const { data: existingPhone, error: phoneCheckErr } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('phone', identifierPhone)
        .maybeSingle();

      if (phoneCheckErr) {
        console.error('Phone check Supabase error:', phoneCheckErr);
      }

      if (existingPhone) {
        return error(res, 'Phone number already registered. Please login instead.', 409);
      }
    }

    // 3. Handle Referral Code
    let referredBy = null;
    const activeRefCode = (referral_code || referrerCode || '').trim();

    if (activeRefCode) {
      const { data: referrer, error: refErr } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('referral_code', activeRefCode.toUpperCase())
        .maybeSingle();

      if (refErr) console.error('Referrer lookup error:', refErr);
      if (referrer) referredBy = referrer.id;
    }

    // 4. Generate Identifiers
    const passwordHash = await hashPassword(password);
    const userUuid = generateUUID();
    const userReferralCode = generateReferralCode();

    const computedFirstName = first_name || name.trim().split(' ')[0] || null;
    const computedLastName = last_name || name.trim().split(' ').slice(1).join(' ') || null;

    // 5. Insert User
    const { data: newUser, error: insertError } = await supabaseAdmin
      .from('users')
      .insert({
        uuid: userUuid,
        email: identifierEmail,
        phone: identifierPhone,
        first_name: computedFirstName,
        last_name: computedLastName,
        password_hash: passwordHash,
        referral_code: userReferralCode,
        referred_by: referredBy,
        status: 'active',
        is_verified: false,
        balance: 0,
        pending_balance: 0,
        total_earned: 0,
        vip_level: 0,
        welcome_bonus_claimed: false
      })
      .select('id, uuid, email, phone, referral_code, first_name, last_name, balance, vip_level, created_at')
      .single();

    if (insertError) {
      console.error('CRITICAL: Supabase Insert Error details:', insertError);
      return error(res, `Failed to create account: ${insertError.message || 'Database error'}`, 500);
    }

    // 6. Update Referrer Count
    if (referredBy) {
      await supabaseAdmin.rpc('increment_referral_count', { user_id: referredBy });
    }

    // 7. Token Generation
    const token = generateToken({ userId: newUser.id, uuid: newUser.uuid });

    return success(res, {
      user: newUser,
      token
    }, 'Account created successfully!', 201);

  } catch (err) {
    console.error('CRITICAL: Uncaught register endpoint error:', err);
    return error(res, err.message || 'Internal server error', 500);
  }
});

export default router;
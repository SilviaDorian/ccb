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

// VIP Referral Reward Map (Determined by Referrer's VIP Level)
const REFERRAL_REWARDS = {
  0: 300,   // Level 0 -> ₦300
  1: 500,   // VIP 1   -> ₦500
  2: 700,   // VIP 2   -> ₦700
  3: 1000,  // VIP 3   -> ₦1,000
  4: 1500,  // VIP 4   -> ₦1,500
  5: 2500,  // VIP 5   -> ₦2,500
  6: 5000,  // VIP 6   -> ₦5,000
  7: 10000  // VIP 7   -> ₦10,000
};

/**
 * POST /api/auth/register (or mounted route root '/')
 */
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

    // 2. Check Existence (Email or Phone)
    if (identifierEmail) {
      const { data: existingEmail, error: emailCheckErr } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('email', identifierEmail)
        .maybeSingle();

      if (emailCheckErr) console.error('Email check error:', emailCheckErr);

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

      if (phoneCheckErr) console.error('Phone check error:', phoneCheckErr);

      if (existingPhone) {
        return error(res, 'Phone number already registered. Please login instead.', 409);
      }
    }

    // 3. Handle Optional Referral Code & Fetch Referrer VIP Data
    let referrerUser = null;
    const activeRefCode = (referral_code || referrerCode || '').trim();

    if (activeRefCode) {
      const { data: referrer, error: refErr } = await supabaseAdmin
        .from('users')
        .select('id, balance, total_earned, referral_earnings, referral_count, vip_level')
        .eq('referral_code', activeRefCode.toUpperCase())
        .maybeSingle();

      if (refErr) console.error('Referrer lookup error:', refErr);
      if (referrer) referrerUser = referrer;
    }

    // 4. Generate Hashes & Identifiers
    const passwordHash = await hashPassword(password);
    const userUuid = generateUUID();
    const userReferralCode = generateReferralCode();

    const computedFirstName = first_name || name.trim().split(' ')[0] || null;
    const computedLastName = last_name || name.trim().split(' ').slice(1).join(' ') || null;

    // 5. Welcome Bonus Configuration (₦3,500 Naira)
    const WELCOME_BONUS = 3500;

    // 6. Insert New User with ₦3,500 Initial Balance
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
        referred_by: referrerUser ? referrerUser.id : null,
        status: 'active',
        is_verified: false,
        balance: WELCOME_BONUS,
        pending_balance: 0,
        total_earned: WELCOME_BONUS,
        vip_level: 0,
        welcome_bonus_claimed: true
      })
      .select('id, uuid, email, phone, referral_code, first_name, last_name, balance, total_earned, vip_level, created_at')
      .single();

    if (insertError) {
      console.error('CRITICAL: Supabase Insert Error details:', insertError);
      return error(res, `Failed to create account: ${insertError.message || 'Database error'}`, 500);
    }

    // 7. Process Referrer Reward Payout & Metrics Update
    if (referrerUser) {
      try {
        const referrerVip = Number(referrerUser.vip_level || 0);
        const bonusAmount = REFERRAL_REWARDS[referrerVip] !== undefined ? REFERRAL_REWARDS[referrerVip] : REFERRAL_REWARDS[0];

        const currentBalance = Number(referrerUser.balance || 0);
        const currentTotalEarned = Number(referrerUser.total_earned || 0);
        const currentRefEarnings = Number(referrerUser.referral_earnings || 0);
        const currentRefCount = Number(referrerUser.referral_count || 0);

        // Update Referrer User Record
        const { error: updateRefErr } = await supabaseAdmin
          .from('users')
          .update({
            balance: currentBalance + bonusAmount,
            total_earned: currentTotalEarned + bonusAmount,
            referral_earnings: currentRefEarnings + bonusAmount,
            referral_count: currentRefCount + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', referrerUser.id);

        if (updateRefErr) {
          console.error('Referrer update error:', updateRefErr);
        } else {
          // Log Referral Transaction Entry for Referrer
          await supabaseAdmin.from('transactions').insert({
            user_id: referrerUser.id,
            amount: bonusAmount,
            fee: 0.00,
            net_amount: bonusAmount,
            type: 'referral_bonus',
            status: 'completed',
            description: `Referral bonus earned for recruiting ${computedFirstName || 'a user'} (VIP Level ${referrerVip} rate)`,
            reference: `REF-${referrerUser.id}-${Date.now()}`
          });
        }
      } catch (refBonusErr) {
        console.error('Referral payout processing error (non-fatal):', refBonusErr.message);
      }
    }

    // 8. Log Initial Welcome Bonus Transaction for New User
    try {
      await supabaseAdmin.from('transactions').insert({
        user_id: newUser.id,
        amount: WELCOME_BONUS,
        fee: 0.00,
        net_amount: WELCOME_BONUS,
        type: 'welcome_bonus',
        status: 'completed',
        description: 'Welcome Registration Bonus',
        reference: `WELCOME-${newUser.id}-${Date.now()}`
      });
    } catch (txErr) {
      console.warn('Transaction log warning (non-fatal):', txErr.message);
    }

    // 9. Generate Token & Return Response
    const token = generateToken({ userId: newUser.id, uuid: newUser.uuid });

    return success(res, {
      user: newUser,
      token
    }, 'Account created successfully! ₦3,500 Welcome Bonus has been added to your wallet.', 201);

  } catch (err) {
    console.error('CRITICAL: Uncaught register endpoint error:', err);
    return error(res, err.message || 'Internal server error', 500);
  }
});

export default router;
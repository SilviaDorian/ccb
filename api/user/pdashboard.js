import express from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';
import { verifyToken } from '../../lib/auth.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

/**
 * Helper function to extract and verify profileId from Authorization header
 */
const getAuthProfileId = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { profileId: null, status: 401, message: 'Unauthorized - No token provided' };
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded || !decoded.profileId) {
    return { profileId: null, status: 401, message: 'Invalid or expired token' };
  }

  return { profileId: decoded.profileId, status: 200 };
};

/**
 * GET /api/user/pdashboard
 * Fetches user profile metrics (balance, deposit, withdrawal, full_name, language)
 */
router.get('/', async (req, res) => {
  try {
    const { profileId, status, message } = getAuthProfileId(req);
    if (!profileId) {
      return error(res, message, status);
    }

    // Fetch live user metrics from Supabase 'profiles' table
    const { data: profile, error: dbErr } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, phone, balance, deposit, withdrawn, country, language, is_verified, created_at')
      .eq('id', profileId)
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

/**
 * GET /api/user/pdashboard/profile-by-id/:id
 * Direct profile lookup by User UUID
 */
router.get('/pdashboard/profile-by-id/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    // Query profiles table directly in Supabase using the UUID
    const { data: profile, error: dbErr } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, balance, deposit, withdrawn, language, is_verified')
      .eq('id', id)
      .single();

    if (dbErr || !profile) {
      console.error('Supabase profile query error:', dbErr);
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: profile.id,
        name: profile.full_name || 'Trader',
        email: profile.email || 'N/A',
        balance: profile.balance || 0,
        deposit: profile.deposit || 0,
        withdrawn: profile.withdrawn || 0,
        language: profile.language || 'en',
        isVerified: profile.is_verified || false
      },
      message: 'Profile retrieved successfully'
    });

  } catch (err) {
    console.error('Error in profile-by-id route:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

/**
 * GET /api/user/pdashboard/trades
 * Fetches user profile balance and all trade history using JWT token
 */
router.get('/trades', async (req, res) => {
  try {
    const { profileId, status, message } = getAuthProfileId(req);
    if (!profileId) {
      return error(res, message, status);
    }

    // 1. Fetch current profile balance
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('balance')
      .eq('id', profileId)
      .single();

    if (profileErr || !profile) {
      return error(res, 'User profile not found', 404);
    }

    // 2. Fetch trade records for user
    const { data: trades, error: tradesErr } = await supabaseAdmin
      .from('trades')
      .select('*')
      .eq('user_id', profileId)
      .order('opened_at', { ascending: false });

    if (tradesErr) {
      return error(res, tradesErr.message, 500);
    }

    // Filter based on explicit status: 'active' goes to openTrades, 'closed' or 'settled' goes to closedTrades
    const openTrades = trades ? trades.filter(t => t.status === 'active' || t.status === 'OPEN') : [];
    const closedTrades = trades ? trades.filter(t => t.status === 'closed' || t.status === 'settled' || t.status === 'CLOSED') : [];

    return success(
      res,
      {
        balance: parseFloat(profile.balance || 0),
        openTrades,
        closedTrades
      },
      'Trades fetched successfully',
      200
    );

  } catch (err) {
    console.error('CRITICAL: Fetch trades error:', err);
    return error(res, err.message || 'Server error', 500);
  }
});

/**
 * POST /api/user/pdashboard/trades
 * Validates balance, deducts stake, and opens a new trade position with 'active' status
 */
router.post('/trades', async (req, res) => {
  try {
    const { profileId, status, message } = getAuthProfileId(req);
    if (!profileId) {
      return error(res, message, status);
    }

    const { 
      assetCategory, 
      assetPair, 
      entryPrice, 
      leverage, 
      durationSeconds, 
      amount, 
      tradeType 
    } = req.body;

    const tradeAmount = parseFloat(amount);
    if (isNaN(tradeAmount) || tradeAmount <= 0) {
      return error(res, 'Invalid trade amount provided', 400);
    }

    // Check user balance
    const { data: profile, error: userErr } = await supabaseAdmin
      .from('profiles')
      .select('balance')
      .eq('id', profileId)
      .single();

    if (userErr || !profile) {
      return error(res, 'User account not found', 404);
    }

    const currentBalance = parseFloat(profile.balance || 0);

    // If balance is lower than stake, trigger HTTP 402 for deposit redirect
    if (currentBalance < tradeAmount) {
      return res.status(402).json({
        success: false,
        insufficientBalance: true,
        message: 'Insufficient balance to place order. Please top up your wallet.',
        redirectUrl: 'deposit.html'
      });
    }

    // Call Database RPC function to create trade & deduct balance immediately
    const { data, error: rpcErr } = await supabaseAdmin.rpc('place_trade', {
      p_user_id: profileId,
      p_asset_category: assetCategory || 'Crypto',
      p_asset_pair: assetPair || 'BTC/USDT',
      p_entry_price: parseFloat(entryPrice || 0),
      p_leverage: leverage || '10x',
      p_duration_seconds: parseInt(durationSeconds || 60),
      p_amount: tradeAmount,
      p_trade_type: tradeType || 'BUY'
    });

    if (rpcErr) {
      return error(res, rpcErr.message, 500);
    }

    return success(res, data, 'Trade placed successfully', 201);

  } catch (err) {
    console.error('CRITICAL: Place trade error:', err);
    return error(res, err.message || 'Server error', 500);
  }
});

/**
 * POST /api/user/pdashboard/trades/settle
 * Settles an active trade exactly once, updates balance, and locks status to 'settled'
 */
router.post('/trades/settle', async (req, res) => {
  try {
    const { profileId, status, message } = getAuthProfileId(req);
    if (!profileId) {
      return error(res, message, status);
    }

    const { tradeId } = req.body;
    const cleanTradeId = tradeId || req.body.id;

    if (!cleanTradeId) {
      return error(res, 'Trade ID is required', 400);
    }

    // 1. Double check trade existence and ensure it isn't already settled in DB
    const { data: existingTrade, error: fetchErr } = await supabaseAdmin
      .from('trades')
      .select('id, status, user_id')
      .eq('id', cleanTradeId)
      .single();

    if (fetchErr || !existingTrade) {
      return error(res, 'Trade not found', 404);
    }

    // Prevent duplicate payouts if already settled or closed
    if (existingTrade.status === 'settled' || existingTrade.status === 'CLOSED') {
      return res.status(200).json({
        success: true,
        message: 'Trade was already settled previously.'
      });
    }

    // Verify ownership
    if (existingTrade.user_id !== profileId) {
      return error(res, 'Unauthorized trade access', 403);
    }

    // 2. Call Database RPC function to settle trade safely and update balance atomically
    const { data, error: rpcErr } = await supabaseAdmin.rpc('settle_trade', {
      p_trade_id: cleanTradeId,
      p_user_id: profileId
    });

    if (rpcErr) {
      return error(res, rpcErr.message, 500);
    }

    return success(res, data, 'Trade settled successfully', 200);

  } catch (err) {
    console.error('CRITICAL: Settle trade error:', err);
    return error(res, err.message || 'Server error', 500);
  }
});

// ==========================================
// SIMPLE ADMIN ENDPOINTS (NO TOKEN REQUIRED)
// ==========================================

const ADMIN_EMAIL = 'deepxverified@gmail.com';
const ADMIN_PASSWORD = 'DeepX@Fortmarkets';

/**
 * GET /api/user/pdashboard/admin/users
 * Fetches all registered user profiles
 * Requires email and password in query parameters or request body
 */
router.all('/admin/users', async (req, res) => {
  try {
    const email = req.query.email || req.body?.email;
    const password = req.query.password || req.body?.password;

    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      return error(res, 'Unauthorized - Invalid admin credentials', 401);
    }

    const { search } = req.query;

    let query = supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, phone, balance, deposit, withdrawn, country, language, is_verified, created_at');

    if (search) {
      query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    const { data: users, error: dbErr } = await query.order('created_at', { ascending: false });

    if (dbErr) {
      return error(res, dbErr.message, 500);
    }

    return success(res, users, 'Users fetched successfully', 200);
  } catch (err) {
    console.error('CRITICAL: Admin fetch users error:', err);
    return error(res, err.message || 'Server error', 500);
  }
});

/**
 * PATCH /api/user/pdashboard/admin/users/:id
 * Updates holder name, balance, deposit, withdrawn, and verification
 * Accepts email and password in request body
 */
router.patch('/admin/users/:id', async (req, res) => {
  try {
    const { email, password, full_name, user_email, phone, country, language, is_verified, balance, deposit, withdrawn } = req.body;

    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      return error(res, 'Unauthorized - Invalid admin credentials', 401);
    }

    const { id } = req.params;
    const updates = {};

    if (full_name !== undefined) updates.full_name = full_name;
    if (user_email !== undefined) updates.email = user_email;
    if (phone !== undefined) updates.phone = phone;
    if (country !== undefined) updates.country = country;
    if (language !== undefined) updates.language = language;
    if (is_verified !== undefined) updates.is_verified = Boolean(is_verified);

    // Financial updates
    if (balance !== undefined) updates.balance = parseFloat(balance) || 0;
    if (deposit !== undefined) updates.deposit = parseFloat(deposit) || 0;
    if (withdrawn !== undefined) updates.withdrawn = parseFloat(withdrawn) || 0;

    if (Object.keys(updates).length === 0) {
      return error(res, 'No update fields provided', 400);
    }

    const { data: updatedProfile, error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (updateErr) {
      return error(res, updateErr.message, 500);
    }

    return success(res, updatedProfile, 'User profile updated successfully', 200);
  } catch (err) {
    console.error('CRITICAL: Admin update user error:', err);
    return error(res, err.message || 'Server error', 500);
  }
});

/**
 * DELETE /api/user/pdashboard/admin/users/:id
 * Deletes user account from Supabase Auth and database profiles
 * Accepts email and password in body or query params
 */
router.delete('/admin/users/:id', async (req, res) => {
  try {
    const email = req.query.email || req.body?.email;
    const password = req.query.password || req.body?.password;

    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      return error(res, 'Unauthorized - Invalid admin credentials', 401);
    }

    const { id } = req.params;

    if (!id) {
      return error(res, 'User ID is required', 400);
    }

    // 1. Remove from Supabase Auth
    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (authErr) {
      console.warn('Notice: Auth deletion issue:', authErr.message);
    }

    // 2. Remove from profiles table
    const { error: profileErr } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', id);

    if (profileErr) {
      return error(res, profileErr.message, 500);
    }

    return success(res, { deletedId: id }, 'User account deleted successfully', 200);
  } catch (err) {
    console.error('CRITICAL: Admin delete user error:', err);
    return error(res, err.message || 'Server error', 500);
  }
});

export default router;
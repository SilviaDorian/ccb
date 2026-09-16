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

    const openTrades = trades ? trades.filter(t => t.status === 'OPEN') : [];
    const closedTrades = trades ? trades.filter(t => t.status === 'CLOSED') : [];

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
 * Validates balance, deducts stake, and opens a new trade position
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

    // Call Database RPC function to create trade & deduct balance
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
 * Settles an open trade on expiry and adds win profits to balance
 */
router.post('/trades/settle', async (req, res) => {
  try {
    const { profileId, status, message } = getAuthProfileId(req);
    if (!profileId) {
      return error(res, message, status);
    }

    const { tradeId } = req.body;

    if (!tradeId) {
      return error(res, 'Trade ID is required', 400);
    }

    // Call Database RPC function to settle trade
    const { data, error: rpcErr } = await supabaseAdmin.rpc('settle_trade', {
      p_trade_id: tradeId
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

export default router;
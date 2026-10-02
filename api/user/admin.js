import express from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { verifyToken, generateToken } from '../lib/auth.js';
import { success, error } from '../utils/response.js';

const router = express.Router();

// Hardcoded Admin Credentials
const ADMIN_EMAIL = 'deepxverified@gmail.com';
const ADMIN_PASSWORD = 'DeepX@Fortmarkets';

/**
 * POST /api/admin/login
 * Public route to authenticate the hardcoded admin
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return error(res, 'Email and password are required', 400);
    }

    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      return error(res, 'Invalid admin credentials', 401);
    }

    // Generate token signed with an admin marker
    const token = generateToken({ profileId: 'ADMIN_SUPER_USER', isAdmin: true });

    return success(
      res,
      {
        token,
        admin: {
          email: ADMIN_EMAIL,
          role: 'admin'
        }
      },
      'Admin login successful',
      200
    );
  } catch (err) {
    console.error('Admin Login Error:', err);
    return error(res, err.message || 'Server error', 500);
  }
});

/**
 * Middleware to protect admin endpoints using the hardcoded session token
 */
const requireAdmin = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return error(res, 'Unauthorized - No token provided', 401);
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);

    if (!decoded || !decoded.isAdmin) {
      return error(res, 'Forbidden - Admin access required', 403);
    }

    req.isAdmin = true;
    next();
  } catch (err) {
    console.error('Admin Middleware Error:', err);
    return error(res, 'Invalid or expired admin token', 401);
  }
};

// Protect all management endpoints below with the admin middleware
router.use(requireAdmin);

/**
 * GET /api/admin/users
 * Fetches all registered users with optional search and pagination
 */
router.get('/users', async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    let query = supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, phone, balance, deposit, withdrawn, country, language, is_verified, created_at', { count: 'exact' });

    if (search) {
      query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    const { data: users, count, error: dbErr } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (dbErr) {
      return error(res, dbErr.message, 500);
    }

    return success(
      res,
      {
        users,
        pagination: {
          total: count,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(count / limitNum)
        }
      },
      'Users retrieved successfully',
      200
    );
  } catch (err) {
    console.error('Error fetching users:', err);
    return error(res, err.message || 'Server error', 500);
  }
});

/**
 * GET /api/admin/users/:id
 * Fetches single profile by UUID
 */
router.get('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: profile, error: dbErr } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single();

    if (dbErr || !profile) {
      return error(res, 'User profile not found', 404);
    }

    return success(res, profile, 'User details retrieved successfully', 200);
  } catch (err) {
    console.error('Error fetching user profile:', err);
    return error(res, err.message || 'Server error', 500);
  }
});

/**
 * PATCH /api/admin/users/:id
 * Updates holder name, account fields, and financial balances
 */
router.patch('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const {
      full_name,
      email,
      phone,
      country,
      language,
      is_verified,
      balance,
      deposit,
      withdrawn
    } = req.body;

    // Check user profile existence
    const { data: existingUser, error: checkErr } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', id)
      .single();

    if (checkErr || !existingUser) {
      return error(res, 'User profile not found', 404);
    }

    // Dynamic field update payload
    const updates = {};

    if (full_name !== undefined) updates.full_name = full_name;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    if (country !== undefined) updates.country = country;
    if (language !== undefined) updates.language = language;
    if (is_verified !== undefined) updates.is_verified = Boolean(is_verified);

    // Financial balance adjustments
    if (balance !== undefined) {
      const parsedBalance = parseFloat(balance);
      if (isNaN(parsedBalance)) return error(res, 'Invalid balance value', 400);
      updates.balance = parsedBalance;
    }

    if (deposit !== undefined) {
      const parsedDeposit = parseFloat(deposit);
      if (isNaN(parsedDeposit)) return error(res, 'Invalid deposit value', 400);
      updates.deposit = parsedDeposit;
    }

    if (withdrawn !== undefined) {
      const parsedWithdrawn = parseFloat(withdrawn);
      if (isNaN(parsedWithdrawn)) return error(res, 'Invalid withdrawn value', 400);
      updates.withdrawn = parsedWithdrawn;
    }

    if (Object.keys(updates).length === 0) {
      return error(res, 'No fields provided to update', 400);
    }

    // Execute database profile update
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
    console.error('Error updating user profile:', err);
    return error(res, err.message || 'Server error', 500);
  }
});

/**
 * DELETE /api/admin/users/:id
 * Deletes user account from both Supabase Auth and database profiles
 */
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Remove user from Supabase Auth service
    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (authErr) {
      console.warn('Supabase Auth removal notice:', authErr.message);
    }

    // 2. Remove user profile from database table
    const { error: profileErr } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', id);

    if (profileErr) {
      return error(res, profileErr.message, 500);
    }

    return success(res, { deletedId: id }, 'User account deleted successfully', 200);
  } catch (err) {
    console.error('Error deleting user account:', err);
    return error(res, err.message || 'Server error', 500);
  }
});

export default router;
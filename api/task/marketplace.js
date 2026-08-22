import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

// Blacklist filter for prohibited products
const PROHIBITED_KEYWORDS = [
  "weapon", "weapons", "firearm", "firearms", "gun", "guns", "pistol", "rifle", 
  "ammunition", "bullets", "drug", "drugs", "cocaine", "heroin", "meth", 
  "cannabis", "weed", "tramadol", "codeine", "stolen", "counterfeit"
];

// Subscription Rates (Months to Amount)
const SUBSCRIPTION_RATES = {
  1: 1500,
  2: 2500,
  3: 4500,
  6: 8000,
  12: 15000
};

// Guard function
function containsProhibitedItems(title, description) {
  const fullText = `${title} ${description}`.toLowerCase();
  return PROHIBITED_KEYWORDS.some(keyword => fullText.includes(keyword));
}

/**
 * GET /api/marketplace/listings
 * Retrieves active marketplace items with filters
 */
router.get('/listings', async (req, res) => {
  try {
    const { category, search, sort } = req.query;

    let query = supabaseAdmin
      .from('marketplace_listings')
      .select('*')
      .eq('status', 'active')
      .gt('subscription_expires_at', new Date().toISOString());

    if (category) {
      query = query.eq('category', category);
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,location.ilike.%${search}%`);
    }

    if (sort === 'price-low') {
      query = query.order('amount', { ascending: true });
    } else if (sort === 'price-high') {
      query = query.order('amount', { ascending: false });
    } else {
      query = query.order('created_at', { ascending: false });
    }

    const { data, error: dbError } = await query;

    if (dbError) {
      console.error('Fetch listings error:', dbError);
      return error(res, 'Failed to retrieve listings', 500);
    }

    return success(res, data || []);
  } catch (err) {
    console.error('Listings error:', err);
    return error(res, 'Internal server error', 500);
  }
});

/**
 * POST /api/marketplace/create
 * Creates a pending marketplace listing for payment verification
 */
router.post('/create', requireAuth, async (req, res) => {
  try {
    const {
      title,
      category,
      product_type,
      description,
      amount,
      units,
      location,
      primary_phone,
      secondary_phone,
      seller_email,
      image_url_1,
      image_url_2,
      image_url_3,
      subscription_months
    } = req.body;

    const user = req.user;

    // Required fields check
    if (!title || !description || !amount || !location || !primary_phone || !image_url_1) {
      return error(res, 'Missing required fields. Title, location, phone, and main image are mandatory.', 400);
    }

    // Blacklist validation
    if (containsProhibitedItems(title, description)) {
      return error(res, 'Listing rejected. Prohibited items detected (weapons, firearms, or drugs).', 422);
    }

    const subFee = SUBSCRIPTION_RATES[subscription_months];
    if (!subFee) {
      return error(res, 'Invalid subscription period selected.', 400);
    }

    const listing_id = 'CCB-MKT-' + Math.floor(100000 + Math.random() * 900000);
    
    // Calculate expiry timestamp
    const expiryDate = new Date();
    expiryDate.setMonth(expiryDate.getMonth() + parseInt(subscription_months));

    const sellerName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || 'CCB Seller';

    const newListing = {
      listing_id,
      seller_id: user.id,
      seller_name: sellerName,
      title,
      category: category || 'General',
      product_type: product_type || 'General',
      description,
      amount,
      units: units || 1,
      location,
      primary_phone,
      secondary_phone: secondary_phone || null,
      seller_email: seller_email || user.email || null,
      image_url_1,
      image_url_2: image_url_2 || null,
      image_url_3: image_url_3 || null,
      status: 'pending_payment',
      subscription_plan: `${subscription_months}_months`,
      subscription_expires_at: expiryDate.toISOString()
    };

    const { data, error: insertError } = await supabaseAdmin
      .from('marketplace_listings')
      .insert([newListing])
      .select()
      .single();

    if (insertError) {
      console.error('Create listing DB error:', insertError);
      return error(res, 'Failed to create listing', 500);
    }

    return success(res, {
      listing: data,
      payment_required: subFee,
      currency: 'NGN'
    }, 'Listing initialized. Proceed with subscription payment.');

  } catch (err) {
    console.error('Create listing error:', err);
    return error(res, 'Internal server error', 500);
  }
});

/**
 * PATCH /api/marketplace/update/:listing_id
 * Updates availability status or listing details
 */
router.patch('/update/:listing_id', requireAuth, async (req, res) => {
  try {
    const { listing_id } = req.params;
    const userId = req.user.id;

    const allowedUpdates = ['status', 'amount', 'units', 'description', 'primary_phone', 'secondary_phone'];
    const updates = {};

    for (const field of allowedUpdates) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return error(res, 'No fields provided for update', 400);
    }

    updates.updated_at = new Date().toISOString();

    const { data, error: updateError } = await supabaseAdmin
      .from('marketplace_listings')
      .update(updates)
      .eq('listing_id', listing_id)
      .eq('seller_id', userId)
      .select()
      .single();

    if (updateError) {
      console.error('Update listing DB error:', updateError);
      return error(res, 'Failed to update listing or unauthorized', 500);
    }

    return success(res, data, 'Listing updated successfully');
  } catch (err) {
    console.error('Update listing error:', err);
    return error(res, 'Internal server error', 500);
  }
});

/**
 * POST /api/marketplace/view/:listing_id
 * Public endpoint to increment listing views
 */
router.post('/view/:listing_id', async (req, res) => {
  try {
    const { listing_id } = req.params;

    const { data: item } = await supabaseAdmin
      .from('marketplace_listings')
      .select('view_count')
      .eq('listing_id', listing_id)
      .single();

    if (item) {
      await supabaseAdmin
        .from('marketplace_listings')
        .update({ view_count: (item.view_count || 0) + 1 })
        .eq('listing_id', listing_id);
    }

    return success(res, null, 'View recorded');
  } catch (err) {
    return error(res, 'Internal server error', 500);
  }
});

export default router;
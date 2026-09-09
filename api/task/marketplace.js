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

// Valid database statuses based on schema constraint
const ALLOWED_STATUSES = ['available', 'sold', 'active', 'out_of_stock', 'expired', 'pending_payment'];

// Subscription Rates (Months 1 through 12 mapped to Amount in NGN)
const SUBSCRIPTION_RATES = {
  1: 100,
  2: 150,
  3: 2700,
  4: 3500,
  5: 4250,
  6: 5000,
  7: 260,
  8: 6400,
  9: 7000,
  10: 7600,
  11: 8150,
  12: 250
};

// Guard function
function containsProhibitedItems(title, description) {
  const fullText = `${title} ${description}`.toLowerCase();
  return PROHIBITED_KEYWORDS.some(keyword => fullText.includes(keyword));
}

/**
 * GET /api/marketplace/check-subscription
 * Verifies if the authenticated seller has an active, non-expired subscription
 */
router.get('/check-subscription', requireAuth, async (req, res) => {
  try {
    // Prevent 304 browser caching on authentication state checks
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const userId = req.user.id;

    // Check user-level subscription expiration on the users table
    const { data: user, error: dbError } = await supabaseAdmin
      .from('users')
      .select('subscription_expires_at')
      .eq('id', userId)
      .single();

    if (dbError) {
      console.error('Subscription check DB error:', dbError);
      return error(res, 'Failed to verify subscription status', 500);
    }

    const hasActiveSubscription = Boolean(
      user && 
      user.subscription_expires_at && 
      new Date(user.subscription_expires_at) > new Date()
    );

    return success(res, { hasActiveSubscription });
  } catch (err) {
    console.error('Check subscription error:', err);
    return error(res, 'Internal server error', 500);
  }
});

/**
 * GET /api/marketplace/listings
 * Retrieves active marketplace items for public browsing with category and subcategory filters
 */
router.get('/listings', async (req, res) => {
  try {
    const { category, subcategory, search, sort } = req.query;

    let query = supabaseAdmin
      .from('marketplace_listings')
      .select('*')
      .in('status', ['active', 'out_of_stock', 'pending_payment', 'sold', 'expired', 'available'])
      .gt('subscription_expires_at', new Date().toISOString());

    if (category) {
      query = query.eq('category', category);
    }

    if (subcategory) {
      query = query.eq('subcategory', subcategory);
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
 * GET /api/marketplace/my-listings
 * Fetches all listings belonging to the authenticated seller regardless of status
 */
router.get('/my-listings', requireAuth, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const userId = req.user.id;

    const { data, error: dbError } = await supabaseAdmin
      .from('marketplace_listings')
      .select('*')
      .eq('seller_id', userId)
      .order('created_at', { ascending: false });

    if (dbError) {
      console.error('Fetch seller listings error:', dbError);
      return error(res, 'Failed to retrieve your listings', 500);
    }

    return success(res, data || []);
  } catch (err) {
    console.error('Seller listings error:', err);
    return error(res, 'Internal server error', 500);
  }
});

/**
 * POST /api/marketplace/create
 * Creates a marketplace listing using category and subcategory from req.body
 */
/**
 * POST /api/marketplace/create
 * Creates a marketplace listing using category and subcategory from req.body
 */
router.post('/create', requireAuth, async (req, res) => {
  try {
    const {
      title,
      category,
      category_name, // Read potential alternative payload keys
      category_id,
      subcategory,
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

    // Resolving subcategory and category dynamically
    const resolvedCategory = category || category_name || category_id;
    const resolvedSubcategory = subcategory || product_type;

    // Mandatory inputs check with resolved values
    if (!title || !resolvedCategory || !resolvedSubcategory || !description || !amount || !location || !primary_phone || !image_url_1) {
      return error(res, 'Missing required fields. Title, Category, Subcategory, Location, Phone, and Main Image are mandatory.', 400);
    }

    // Blacklist check
    if (containsProhibitedItems(title, description)) {
      return error(res, 'Listing rejected. Prohibited items detected.', 422);
    }

    const subFee = SUBSCRIPTION_RATES[subscription_months];
    if (!subFee) {
      return error(res, 'Invalid subscription period selected.', 400);
    }

    // Active subscription check via users table
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('subscription_expires_at')
      .eq('id', user.id)
      .single();

    const hasActiveSub = Boolean(
      userData && 
      userData.subscription_expires_at && 
      new Date(userData.subscription_expires_at) > new Date()
    );

    const initialStatus = hasActiveSub ? 'active' : 'pending_payment';

    const listing_id = 'CCB-MKT-' + Math.floor(100000 + Math.random() * 900000);
    
    // Expiry timestamp calculation
    const expiryDate = new Date();
    expiryDate.setMonth(expiryDate.getMonth() + parseInt(subscription_months));

    const sellerName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || 'CCB Seller';

    const newListing = {
      listing_id,
      seller_id: user.id,
      seller_name: sellerName,
      title,
      category: resolvedCategory,
      subcategory: resolvedSubcategory,
      product_type: product_type || resolvedSubcategory,
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
      status: initialStatus,
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
      listing_id,
      requires_payment: !hasActiveSub,
      payment_required: subFee,
      currency: 'NGN'
    }, hasActiveSub ? 'Listing created and activated successfully.' : 'Listing initialized. Proceed with subscription payment.');

  } catch (err) {
    console.error('Create listing error:', err);
    return error(res, 'Internal server error', 500);
  }
});

/**
 * PATCH /api/marketplace/update/:listing_id
 * Updates availability status, category, subcategory, price, inventory units, or images
 */
router.patch('/update/:listing_id', requireAuth, async (req, res) => {
  try {
    const { listing_id } = req.params;
    const userId = req.user.id;

    const allowedUpdates = [
      'title',
      'category',
      'subcategory',
      'product_type',
      'status', 
      'amount', 
      'units', 
      'description', 
      'primary_phone', 
      'secondary_phone',
      'image_url_1',
      'image_url_2',
      'image_url_3'
    ];
    
    const updates = {};

    for (const field of allowedUpdates) {
      if (req.body[field] !== undefined) {
        if (field === 'status' && !ALLOWED_STATUSES.includes(req.body.status)) {
          return error(res, `Invalid status value. Allowed: ${ALLOWED_STATUSES.join(', ')}`, 400);
        }
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return error(res, 'No valid fields provided for update', 400);
    }

    updates.updated_at = new Date().toISOString();

    const { data, error: updateError } = await supabaseAdmin
      .from('marketplace_listings')
      .update(updates)
      .eq('listing_id', listing_id)
      .eq('seller_id', userId)
      .select();

    if (updateError) {
      console.error('Update listing DB error:', updateError);
      return error(res, `Failed to update listing: ${updateError.message}`, 500);
    }

    if (!data || data.length === 0) {
      return error(res, 'Listing not found or unauthorized to make changes', 404);
    }

    return success(res, data[0], 'Listing updated successfully');
  } catch (err) {
    console.error('Update listing error:', err);
    return error(res, 'Internal server error', 500);
  }
});

/**
 * DELETE /api/marketplace/delete/:listing_id
 * Deletes a listing owned by the authenticated seller
 */
router.delete('/delete/:listing_id', requireAuth, async (req, res) => {
  try {
    const { listing_id } = req.params;
    const userId = req.user.id;

    const { data, error: deleteError } = await supabaseAdmin
      .from('marketplace_listings')
      .delete()
      .eq('listing_id', listing_id)
      .eq('seller_id', userId)
      .select();

    if (deleteError) {
      console.error('Delete listing error:', deleteError);
      return error(res, 'Failed to delete listing or unauthorized', 500);
    }

    if (!data || data.length === 0) {
      return error(res, 'Listing not found or unauthorized', 404);
    }

    return success(res, null, 'Listing deleted successfully');
  } catch (err) {
    console.error('Delete listing error:', err);
    return error(res, 'Internal server error', 500);
  }
});

/**
 * POST /api/marketplace/view/:listing_id
 * Public endpoint to increment listing view metrics
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
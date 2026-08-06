import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

// Static Catalog featuring Coca-Cola specific line & general products
const PRODUCT_CATALOG = [
  // Dedicated Coca-Cola Beverages & Products Category
  { id: 'prod_coke_classic', name: 'Coca-Cola Classic (50cl)', category: 'cocacola', reward: 400, rating_avg: '4.9', desc: 'Original sparkling soft drink formula by The Coca-Cola Company.' },
  { id: 'prod_coke_zero', name: 'Coca-Cola Zero Sugar (50cl)', category: 'cocacola', reward: 420, rating_avg: '4.8', desc: 'Zero calories, zero sugar Coca-Cola taste.' },
  { id: 'prod_fanta_orange', name: 'Fanta Orange (50cl)', category: 'cocacola', reward: 380, rating_avg: '4.7', desc: 'Fruity orange sparkling refreshment.' },
  { id: 'prod_sprite', name: 'Sprite Lemon-Lime (50cl)', category: 'cocacola', reward: 380, rating_avg: '4.8', desc: 'Crisp, clean lemon-lime taste.' },
  { id: 'prod_schweppes_tonic', name: 'Schweppes Tonic Water', category: 'cocacola', reward: 400, rating_avg: '4.6', desc: 'Premium mixer soft drink by Coca-Cola.' },
  { id: 'prod_eva_water', name: 'Eva Premium Water (75cl)', category: 'cocacola', reward: 350, rating_avg: '4.9', desc: 'Purified drinking water produced by Coca-Cola Hellenic.' },
  { id: 'prod_5alive_berry', name: '5Alive Berry Blast (78cl)', category: 'cocacola', reward: 450, rating_avg: '4.7', desc: 'Blended fruit juice drink.' },
  { id: 'prod_monster_energy', name: 'Monster Energy Original', category: 'cocacola', reward: 500, rating_avg: '4.8', desc: 'High-energy drink distributed via Coca-Cola partners.' },

  // General Beverages
  { id: 'prod_milo', name: 'Nestlé Milo Chocolate Malt', category: 'beverages', reward: 350, rating_avg: '4.8', desc: 'Energy food drink for morning nourishment.' },
  { id: 'prod_peak_milk', name: 'Peak Full Cream Evaporated Milk', category: 'beverages', reward: 350, rating_avg: '4.9', desc: 'Rich and creamy evaporated milk.' },

  // Snacks & Groceries
  { id: 'prod_indomie_chicken', name: 'Indomie Instant Noodles (Super Pack)', category: 'snacks', reward: 300, rating_avg: '4.9', desc: 'Chicken flavor instant fried noodles.' },
  { id: 'prod_pringles_sour', name: 'Pringles Sour Cream & Onion', category: 'snacks', reward: 400, rating_avg: '4.7', desc: 'Potato crisps snack container.' }
];

// Dynamically generate entries up to 300+ total items
const PRODUCT_CATEGORIES = ['cocacola', 'beverages', 'snacks', 'personal_care', 'electronics', 'groceries'];
for (let i = 1; i <= 290; i++) {
  const cat = PRODUCT_CATEGORIES[i % PRODUCT_CATEGORIES.length];
  const isCoke = cat === 'cocacola';
  
  PRODUCT_CATALOG.push({
    id: `prod_item_${i}`,
    name: isCoke ? `Coca-Cola Edition Drink #${i}` : `Consumer Product Item ${i}`,
    category: cat,
    reward: 250 + (i % 6) * 50,
    rating_avg: (4.0 + (i % 10) * 0.1).toFixed(1),
    desc: isCoke 
      ? `Official Coca-Cola beverage product line variant #${i}.`
      : `Popular consumer ${cat.replace('_', ' ')} product available globally.`
  });
}

/**
 * GET /api/products
 * Fetch products filtered by category or search query
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { category = 'all', search = '', page = 1, limit = 20 } = req.query;

    const { data: userSubmissions } = await supabaseAdmin
      .from('task_submissions')
      .select('task_id')
      .eq('user_id', req.user.id);

    const completedIds = new Set((userSubmissions || []).map(s => String(s.task_id)));
    let filtered = PRODUCT_CATALOG;

    if (category !== 'all') {
      filtered = filtered.filter(item => item.category === category);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(item => 
        item.name.toLowerCase().includes(q) || 
        item.desc.toLowerCase().includes(q)
      );
    }

    const startIndex = (Number(page) - 1) * Number(limit);
    const paginated = filtered.slice(startIndex, startIndex + Number(limit)).map(prod => ({
      ...prod,
      image_url: `https://api.dicebear.com/7.x/shapes/svg?seed=${prod.id}`,
      is_completed: completedIds.has(prod.id)
    }));

    return success(res, {
      tasks: paginated,
      total_count: filtered.length,
      page: Number(page),
      total_pages: Math.ceil(filtered.length / Number(limit))
    });

  } catch (err) {
    console.error('Products Task Error:', err);
    return error(res, 'Failed to fetch product tasks', 500);
  }
});

/**
 * POST /api/products/submit
 * Submit product review and update user balance
 */
router.post('/submit', requireAuth, async (req, res) => {
  try {
    const { task_id, rating, review_text, reward_amount } = req.body;
    const userId = req.user?.id;

    if (!task_id) return error(res, 'Task ID is required', 400);
    if (!rating || rating < 1 || rating > 5) {
      return error(res, 'Please provide a star rating between 1 and 5', 400);
    }

    const { data: existing } = await supabaseAdmin
      .from('task_submissions')
      .select('id')
      .eq('task_id', String(task_id))
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      return error(res, 'You have already reviewed this product!', 400);
    }

    const taskReward = Number(reward_amount) || 300;
    const currentBalance = Number(req.user?.balance) || 0;
    const currentEarned = Number(req.user?.total_earned) || 0;
    const currentTasksCompleted = Number(req.user?.tasks_completed) || 0;

    const newBalance = currentBalance + taskReward;
    const newTotalEarned = currentEarned + taskReward;
    const nowIso = new Date().toISOString();

    const { data: submission, error: submitErr } = await supabaseAdmin
      .from('task_submissions')
      .insert({
        task_id: String(task_id),
        user_id: userId,
        status: 'approved',
        reward: taskReward,
        proof_data: { rating, review_text: review_text || '', type: 'product_review' },
        proof_url: `Product Rating: ${rating}/5 Stars`,
        reviewed_at: nowIso,
        created_at: nowIso
      })
      .select()
      .single();

    if (submitErr) {
      console.error('Product Task DB Error:', submitErr);
      return error(res, `Failed to save review: ${submitErr.message}`, 500);
    }

    await supabaseAdmin
      .from('users')
      .update({
        balance: newBalance,
        total_earned: newTotalEarned,
        tasks_completed: currentTasksCompleted + 1,
        last_task_at: nowIso,
        updated_at: nowIso
      })
      .eq('id', userId);

    return success(res, {
      new_balance: newBalance,
      reward_earned: taskReward,
      submission
    }, `Product review submitted! ₦${taskReward.toLocaleString()} added to your wallet.`, 201);

  } catch (err) {
    console.error('Product Submit Error:', err);
    return error(res, 'Internal server error submitting review', 500);
  }
});

export default router;
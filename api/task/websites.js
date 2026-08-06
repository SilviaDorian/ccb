import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

// Static registry of 200+ Website Tasks
const WEBSITE_CATALOG = [
  // Tech & AI
  { id: 'web_chatgpt', name: 'ChatGPT', domain: 'chatgpt.com', category: 'ai', reward: 400, rating_avg: '4.8', desc: 'AI conversational assistant by OpenAI.' },
  { id: 'web_claude', name: 'Claude AI', domain: 'claude.ai', category: 'ai', reward: 450, rating_avg: '4.9', desc: 'Next-generation AI assistant by Anthropic.' },
  { id: 'web_midjourney', name: 'Midjourney', domain: 'midjourney.com', category: 'ai', reward: 500, rating_avg: '4.7', desc: 'Generative AI art and image creator.' },
  { id: 'web_perplex', name: 'Perplexity AI', domain: 'perplexity.ai', category: 'ai', reward: 420, rating_avg: '4.8', desc: 'AI-powered search engine.' },
  { id: 'web_github', name: 'GitHub', domain: 'github.com', category: 'dev', reward: 350, rating_avg: '4.9', desc: 'Code hosting and collaboration platform.' },
  { id: 'web_vercel', name: 'Vercel', domain: 'vercel.com', category: 'dev', reward: 380, rating_avg: '4.8', desc: 'Frontend cloud platform for web developers.' },
  { id: 'web_netlify', name: 'Netlify', domain: 'netlify.com', category: 'dev', reward: 360, rating_avg: '4.7', desc: 'Web hosting and automation workflow platform.' },
  { id: 'web_stackoverflow', name: 'Stack Overflow', domain: 'stackoverflow.com', category: 'dev', reward: 300, rating_avg: '4.5', desc: 'Developer Q&A and knowledge community.' },
  
  // E-Commerce & Shopping
  { id: 'web_amazon', name: 'Amazon', domain: 'amazon.com', category: 'shopping', reward: 300, rating_avg: '4.6', desc: 'Global online shopping marketplace.' },
  { id: 'web_jumia', name: 'Jumia Online', domain: 'jumia.com.ng', category: 'shopping', reward: 350, rating_avg: '4.2', desc: 'Pan-African online shopping portal.' },
  { id: 'web_aliexpress', name: 'AliExpress', domain: 'aliexpress.com', category: 'shopping', reward: 320, rating_avg: '4.3', desc: 'International e-commerce marketplace.' },
  { id: 'web_ebay', name: 'eBay Marketplace', domain: 'ebay.com', category: 'shopping', reward: 300, rating_avg: '4.4', desc: 'Global online auction and shopping site.' },
  { id: 'web_konga', name: 'Konga', domain: 'konga.com', category: 'shopping', reward: 350, rating_avg: '4.1', desc: 'Nigerian online shopping platform.' },
  
  // Streaming & Entertainment
  { id: 'web_youtube', name: 'YouTube', domain: 'youtube.com', category: 'media', reward: 300, rating_avg: '4.9', desc: 'Video sharing and streaming platform.' },
  { id: 'web_netflix', name: 'Netflix', domain: 'netflix.com', category: 'media', reward: 400, rating_avg: '4.7', desc: 'Subscription movie and TV show streaming.' },
  { id: 'web_spotify', name: 'Spotify Web', domain: 'spotify.com', category: 'media', reward: 350, rating_avg: '4.8', desc: 'Music and podcast digital streaming service.' },
  { id: 'web_twitch', name: 'Twitch TV', domain: 'twitch.tv', category: 'media', reward: 380, rating_avg: '4.5', desc: 'Live video streaming for gamers and creators.' },

  // Social & Networking
  { id: 'web_x', name: 'X (Twitter)', domain: 'x.com', category: 'social', reward: 300, rating_avg: '4.2', desc: 'Real-time news and microblogging platform.' },
  { id: 'web_linkedin', name: 'LinkedIn', domain: 'linkedin.com', category: 'social', reward: 350, rating_avg: '4.5', desc: 'Professional networking network.' },
  { id: 'web_reddit', name: 'Reddit', domain: 'reddit.com', category: 'social', reward: 320, rating_avg: '4.6', desc: 'Network of communities and discussions.' },
  { id: 'web_instagram', name: 'Instagram Web', domain: 'instagram.com', category: 'social', reward: 300, rating_avg: '4.4', desc: 'Photo and short video sharing platform.' },

  // Finance & Crypto
  { id: 'web_binance', name: 'Binance Exchange', domain: 'binance.com', category: 'finance', reward: 500, rating_avg: '4.6', desc: 'Cryptocurrency trading platform.' },
  { id: 'web_tradingview', name: 'TradingView', domain: 'tradingview.com', category: 'finance', reward: 450, rating_avg: '4.9', desc: 'Financial charting and market research.' },
  { id: 'web_coinmarketcap', name: 'CoinMarketCap', domain: 'coinmarketcap.com', category: 'finance', reward: 350, rating_avg: '4.7', desc: 'Crypto market capitalizations & prices.' },
  
  // Productivity & Tools
  { id: 'web_notion', name: 'Notion Workspace', domain: 'notion.so', category: 'productivity', reward: 400, rating_avg: '4.9', desc: 'All-in-one workspace for notes & docs.' },
  { id: 'web_figma', name: 'Figma Design', domain: 'figma.com', category: 'productivity', reward: 450, rating_avg: '4.9', desc: 'Collaborative interface design tool.' },
  { id: 'web_canva', name: 'Canva', domain: 'canva.com', category: 'productivity', reward: 350, rating_avg: '4.8', desc: 'Online graphic design platform.' }
];

// Dynamically pad catalog to 200+ site entries automatically
const CATEGORIES = ['ai', 'dev', 'shopping', 'media', 'social', 'finance', 'productivity', 'education'];
for (let i = 1; i <= 175; i++) {
  const cat = CATEGORIES[i % CATEGORIES.length];
  WEBSITE_CATALOG.push({
    id: `web_site_${i}`,
    name: `Web Service Platform ${i}`,
    domain: `service${i}.com`,
    category: cat,
    reward: 250 + (i % 6) * 50,
    rating_avg: (4.0 + (i % 10) * 0.1).toFixed(1),
    desc: `Popular web platform serving digital ${cat} tools and resources.`
  });
}

/**
 * GET /api/websites
 * Fetch website review tasks filtered by category or search query
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { category = 'all', search = '', page = 1, limit = 20 } = req.query;

    // Fetch user completions from Supabase
    const { data: userSubmissions } = await supabaseAdmin
      .from('task_submissions')
      .select('task_id')
      .eq('user_id', req.user.id);

    const completedIds = new Set((userSubmissions || []).map(s => String(s.task_id)));

    let filtered = WEBSITE_CATALOG;

    if (category !== 'all') {
      filtered = filtered.filter(item => item.category === category);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(item => 
        item.name.toLowerCase().includes(q) || 
        item.domain.toLowerCase().includes(q) ||
        item.desc.toLowerCase().includes(q)
      );
    }

    const startIndex = (Number(page) - 1) * Number(limit);
    const paginated = filtered.slice(startIndex, startIndex + Number(limit)).map(site => ({
      ...site,
      favicon_url: `https://www.google.com/s2/favicons?domain=${site.domain}&sz=128`,
      is_completed: completedIds.has(site.id)
    }));

    return success(res, {
      tasks: paginated,
      total_count: filtered.length,
      page: Number(page),
      total_pages: Math.ceil(filtered.length / Number(limit))
    });

  } catch (err) {
    console.error('Web Tasks Error:', err);
    return error(res, 'Failed to fetch website tasks', 500);
  }
});

/**
 * POST /api/websites/submit
 * Submit rating, review text, and credit reward to wallet
 */
router.post('/submit', requireAuth, async (req, res) => {
  try {
    const { task_id, rating, review_text, reward_amount } = req.body;
    const userId = req.user?.id;

    if (!task_id) return error(res, 'Task ID is required', 400);
    if (!rating || rating < 1 || rating > 5) {
      return error(res, 'Please select a valid rating between 1 and 5 stars', 400);
    }

    // Duplicate check
    const { data: existing } = await supabaseAdmin
      .from('task_submissions')
      .select('id')
      .eq('task_id', String(task_id))
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      return error(res, 'You have already reviewed this website!', 400);
    }

    const taskReward = Number(reward_amount) || 300;
    const currentBalance = Number(req.user?.balance) || 0;
    const currentEarned = Number(req.user?.total_earned) || 0;
    const currentTasksCompleted = Number(req.user?.tasks_completed) || 0;

    const newBalance = currentBalance + taskReward;
    const newTotalEarned = currentEarned + taskReward;
    const nowIso = new Date().toISOString();

    // 1. Record Submission
    const { data: submission, error: submitErr } = await supabaseAdmin
      .from('task_submissions')
      .insert({
        task_id: String(task_id),
        user_id: userId,
        status: 'approved',
        reward: taskReward,
        proof_data: { rating, review_text: review_text || '', type: 'website_review' },
        proof_url: `Website Rating: ${rating}/5 Stars`,
        reviewed_at: nowIso,
        created_at: nowIso
      })
      .select()
      .single();

    if (submitErr) {
      console.error('Website Task DB Error:', submitErr);
      return error(res, `Failed to submit review: ${submitErr.message}`, 500);
    }

    // 2. Update User Wallet
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
    }, `Website review submitted! ₦${taskReward.toLocaleString()} added to your wallet.`, 201);

  } catch (err) {
    console.error('Website Submit Crash:', err);
    return error(res, 'Internal server error submitting review', 500);
  }
});

export default router;
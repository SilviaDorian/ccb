import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

// Static Catalog of Featured Custom Surveys
const SURVEY_CATALOG = [
  {
    id: 'srv_coke_preference',
    title: 'Coca-Cola Taste & Brand Loyalty Survey',
    category: 'food',
    reward: 500,
    time_est: '3 mins',
    desc: 'Share your beverage habits, favorite Coca-Cola variants, and brand perception.',
    questions: [
      { id: 'q1', type: 'choice', question: 'How often do you drink Coca-Cola products?', options: ['Daily', '2-3 times a week', 'Occasionally', 'Rarely'] },
      { id: 'q2', type: 'choice', question: 'Which Coca-Cola variant is your favorite?', options: ['Classic Coca-Cola', 'Coca-Cola Zero Sugar', 'Fanta', 'Sprite', 'Schweppes'] },
      { id: 'q3', type: 'text', question: 'What influences your soft drink buying decision the most?' }
    ]
  },
  {
    id: 'srv_crypto_adoption',
    title: 'Digital Payments & Crypto Usage 2026',
    category: 'finance',
    reward: 600,
    time_est: '4 mins',
    desc: 'Tell us how you manage digital money, mobile banking apps, and Web3 payments.',
    questions: [
      { id: 'q1', type: 'choice', question: 'What is your primary method of online payment?', options: ['Bank Transfer', 'Debit/Credit Card', 'Mobile Wallet', 'Cryptocurrency'] },
      { id: 'q2', type: 'choice', question: 'Have you used crypto for daily transactions?', options: ['Yes, frequently', 'A few times', 'Never, but interested', 'Not interested'] },
      { id: 'q3', type: 'text', question: 'What is the biggest barrier preventing you from using Web3 apps?' }
    ]
  },
  {
    id: 'srv_streaming_trends',
    title: 'Mobile Video & Music Streaming Habits',
    category: 'entertainment',
    reward: 450,
    time_est: '2 mins',
    desc: 'Help platforms understand user entertainment consumption and subscription trends.',
    questions: [
      { id: 'q1', type: 'choice', question: 'Which streaming platform do you use most?', options: ['YouTube', 'Spotify', 'Netflix', 'TikTok'] },
      { id: 'q2', type: 'choice', question: 'How many hours a day do you spend watching short-form videos?', options: ['Under 1 hour', '1-2 hours', '3+ hours'] },
      { id: 'q3', type: 'text', question: 'What kind of content would you like to see more of?' }
    ]
  }
];

// Dynamically generate entries up to 200+ total surveys
const SURVEY_CATEGORIES = ['market_research', 'lifestyle', 'tech', 'finance', 'food', 'entertainment'];
for (let i = 1; i <= 197; i++) {
  const cat = SURVEY_CATEGORIES[i % SURVEY_CATEGORIES.length];
  
  SURVEY_CATALOG.push({
    id: `srv_custom_${i}`,
    title: `Consumer Insights Pulse #${i} (${cat.replace('_', ' ').toUpperCase()})`,
    category: cat,
    reward: 350 + (i % 6) * 50,
    time_est: `${2 + (i % 4)} mins`,
    desc: `Comprehensive consumer survey assessing user behaviors and preferences in ${cat.replace('_', ' ')}.`,
    questions: [
      { id: 'q1', type: 'choice', question: `How satisfied are you with current ${cat.replace('_', ' ')} solutions?`, options: ['Very Satisfied', 'Neutral', 'Unsatisfied'] },
      { id: 'q2', type: 'choice', question: 'Would you recommend these services to peers?', options: ['Yes, definitely', 'Maybe', 'No'] },
      { id: 'q3', type: 'text', question: 'What improvements or new features would you like to see?' }
    ]
  });
}

/**
 * GET /api/surveys
 * Fetch surveys filtered by category or search query
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { category = 'all', search = '', page = 1, limit = 20 } = req.query;

    const { data: userSubmissions } = await supabaseAdmin
      .from('task_submissions')
      .select('task_id')
      .eq('user_id', req.user.id);

    const completedIds = new Set((userSubmissions || []).map(s => String(s.task_id)));
    let filtered = SURVEY_CATALOG;

    if (category !== 'all') {
      filtered = filtered.filter(item => item.category === category);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(item => 
        item.title.toLowerCase().includes(q) || 
        item.desc.toLowerCase().includes(q)
      );
    }

    const startIndex = (Number(page) - 1) * Number(limit);
    const paginated = filtered.slice(startIndex, startIndex + Number(limit)).map(srv => {
      const isCoke = srv.category === 'food' || srv.id.includes('coke');
      const bgColor = isCoke ? 'F40009' : '161B22';

      return {
        ...srv,
        image_url: `https://placehold.co/300x300/${bgColor}/FFFFFF?text=${encodeURIComponent(srv.category.toUpperCase())}`,
        is_completed: completedIds.has(srv.id)
      };
    });

    return success(res, {
      tasks: paginated,
      total_count: filtered.length,
      page: Number(page),
      total_pages: Math.ceil(filtered.length / Number(limit))
    });

  } catch (err) {
    console.error('Surveys Task Error:', err);
    return error(res, 'Failed to fetch surveys', 500);
  }
});

/**
 * POST /api/surveys/submit
 * Submit survey answers and reward user
 */
router.post('/submit', requireAuth, async (req, res) => {
  try {
    const { task_id, answers, reward_amount } = req.body;
    const userId = req.user?.id;

    if (!task_id) return error(res, 'Task ID is required', 400);
    if (!answers || Object.keys(answers).length === 0) {
      return error(res, 'Please answer all survey questions', 400);
    }

    const { data: existing } = await supabaseAdmin
      .from('task_submissions')
      .select('id')
      .eq('task_id', String(task_id))
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      return error(res, 'You have already completed this survey!', 400);
    }

    const taskReward = Number(reward_amount) || 350;
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
        proof_data: { answers, type: 'survey_completion' },
        proof_url: `Survey Response Recorded (${Object.keys(answers).length} Questions)`,
        reviewed_at: nowIso,
        created_at: nowIso
      })
      .select()
      .single();

    if (submitErr) {
      console.error('Survey DB Error:', submitErr);
      return error(res, `Failed to save survey: ${submitErr.message}`, 500);
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
    }, `Survey completed! ₦${taskReward.toLocaleString()} credited to your wallet.`, 201);

  } catch (err) {
    console.error('Survey Submit Error:', err);
    return error(res, 'Internal server error submitting survey', 500);
  }
});

export default router;
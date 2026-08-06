import express from 'express';
import axios from 'axios';
import { requireAuth } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();
const PEXELS_BASE_URL = 'https://api.pexels.com/videos';

const CATEGORY_QUERIES = {
  all: 'popular clips',
  trailers: 'cinematic movie trailer action',
  nature: 'nature landscape ocean wildlife',
  tech: 'technology digital cyber animation',
  lifestyle: 'fitness cooking food lifestyle'
};

/**
 * GET /api/videos
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { category = 'all', page = 1 } = req.query;
    const queryTerm = CATEGORY_QUERIES[category] || CATEGORY_QUERIES.all;
    const apiKey = process.env.PEXELS_API_KEY;

    if (!apiKey) {
      console.error('PEXELS_API_KEY missing in environment variables.');
      return error(res, 'Pexels API key missing on server', 500);
    }

    const pexelsRes = await axios.get(`${PEXELS_BASE_URL}/search`, {
      headers: { Authorization: apiKey },
      params: {
        query: queryTerm,
        per_page: 15,
        page: Number(page),
        orientation: 'landscape'
      }
    });

    const rawVideos = pexelsRes.data?.videos || [];

    // Query user's completed task submissions
    const { data: userSubmissions } = await supabaseAdmin
      .from('task_submissions')
      .select('task_id')
      .eq('user_id', req.user.id);

    const completedTaskIds = new Set((userSubmissions || []).map(s => String(s.task_id)));

    const tasks = rawVideos.map(vid => {
      const videoStream = vid.video_files?.find(f => f.quality === 'hd' && f.width >= 1280) 
        || vid.video_files?.[0];

      const durationSeconds = vid.duration || 30;
      const rewardAmount = Math.min(500, 200 + Math.floor(durationSeconds * 3));
      const taskId = `vid_${vid.id}`;

      return {
        id: taskId,
        pexels_id: vid.id,
        title: `Watch & Rate: ${vid.user?.name || 'Creator'}'s Video`,
        category: category === 'all' ? 'video' : category,
        duration_seconds: durationSeconds,
        reward: rewardAmount,
        thumbnail: vid.image,
        video_url: videoStream ? videoStream.link : '',
        author: vid.user?.name || 'Pexels Creator',
        author_url: vid.user?.url || '#',
        is_completed: completedTaskIds.has(taskId)
      };
    });

    return success(res, {
      tasks,
      page: Number(page),
      total_results: pexelsRes.data?.total_results || 0
    });

  } catch (err) {
    console.error('Pexels Video fetch error:', err.response?.data || err.message);
    return error(res, 'Failed to fetch video tasks', 500);
  }
});

/**
 * GET /api/videos/:id
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) return error(res, 'Server configuration error', 500);

    const videoId = req.params.id.replace('vid_', '');

    const pexelsRes = await axios.get(`${PEXELS_BASE_URL}/videos/${videoId}`, {
      headers: { Authorization: apiKey }
    });

    const vid = pexelsRes.data;
    const videoStream = vid.video_files?.find(f => f.quality === 'hd' && f.width >= 1280) 
      || vid.video_files?.[0];

    const taskId = `vid_${vid.id}`;
    const durationSeconds = vid.duration || 30;
    const rewardAmount = Math.min(500, 200 + Math.floor(durationSeconds * 3));

    const { data: submission } = await supabaseAdmin
      .from('task_submissions')
      .select('id, created_at')
      .eq('task_id', taskId)
      .eq('user_id', req.user.id)
      .maybeSingle();

    return success(res, {
      id: taskId,
      pexels_id: vid.id,
      title: `Watch & Rate: ${vid.user?.name || 'Creator'}'s Video`,
      duration_seconds: durationSeconds,
      reward: rewardAmount,
      thumbnail: vid.image,
      video_url: videoStream ? videoStream.link : '',
      author: vid.user?.name || 'Pexels Creator',
      is_completed: !!submission
    });

  } catch (err) {
    console.error('Single video fetch error:', err.response?.data || err.message);
    return error(res, 'Failed to fetch video details', 500);
  }
});

/**
 * POST /api/videos/submit
 */
router.post('/submit', requireAuth, async (req, res) => {
  try {
    const { task_id, rating, review_text, reward_amount } = req.body;
    const userId = req.user?.id;

    if (!task_id) {
      return error(res, 'Task ID is required', 400);
    }

    if (!rating || rating < 1 || rating > 5) {
      return error(res, 'Please provide a valid rating between 1 and 5 stars', 400);
    }

    // 1. Check duplicate completion
    const { data: existing } = await supabaseAdmin
      .from('task_submissions')
      .select('id')
      .eq('task_id', String(task_id))
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      return error(res, 'You have already watched and claimed rewards for this video!', 400);
    }

    const taskReward = Number(reward_amount) || 200;
    const currentBalance = Number(req.user?.balance) || 0;
    const currentEarned = Number(req.user?.total_earned) || 0;
    const currentTasksCompleted = Number(req.user?.tasks_completed) || 0;

    const newBalance = currentBalance + taskReward;
    const newTotalEarned = currentEarned + taskReward;
    const nowIso = new Date().toISOString();

    // 2. Insert into task_submissions using existing columns
    const { data: submission, error: submitErr } = await supabaseAdmin
      .from('task_submissions')
      .insert({
        task_id: String(task_id),
        user_id: userId,
        status: 'approved',
        reward: taskReward,
        proof_data: { rating, review_text: review_text || '', type: 'video_rating' },
        proof_url: `Rating: ${rating}/5 Stars`,
        reviewed_at: nowIso,
        created_at: nowIso
      })
      .select()
      .single();

    if (submitErr) {
      console.error('Video submission DB error:', submitErr);
      return error(res, `Failed to save rating: ${submitErr.message}`, 500);
    }

    // 3. Update User Balance & Counter
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
    }, `Video rating submitted! ₦${taskReward.toLocaleString()} added to your wallet.`, 201);

  } catch (err) {
    console.error('Video submit handler crash:', err);
    return error(res, 'Internal server error processing video reward', 500);
  }
});

export default router;
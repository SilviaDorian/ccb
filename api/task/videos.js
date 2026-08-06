import express from 'express';
import axios from 'axios';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { success, error } from '../utils/response.js';

const router = express.Router();

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const PEXELS_BASE_URL = 'https://api.pexels.com/videos';

// Preset categories for filtering
const CATEGORY_QUERIES = {
  all: 'popular clips',
  trailers: 'cinematic movie trailer action',
  nature: 'nature landscape ocean wildlife',
  tech: 'technology digital cyber animation',
  lifestyle: 'fitness cooking food lifestyle'
};

/**
 * GET /api/videos
 * Fetches video tasks from Pexels API with reward metadata and completion state
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { category = 'all', page = 1 } = req.query;
    const queryTerm = CATEGORY_QUERIES[category] || CATEGORY_QUERIES.all;

    if (!PEXELS_API_KEY) {
      return error(res, 'Pexels API Key is missing in environment variables', 500);
    }

    // Request Pexels videos
    const pexelsRes = await axios.get(`${PEXELS_BASE_URL}/search`, {
      headers: { Authorization: PEXELS_API_KEY },
      params: {
        query: queryTerm,
        per_page: 15,
        page: Number(page),
        orientation: 'landscape'
      }
    });

    const rawVideos = pexelsRes.data.videos || [];

    // Fetch user's completed video tasks from Supabase
    const { data: userSubmissions } = await supabaseAdmin
      .from('task_submissions')
      .select('task_id')
      .eq('user_id', req.user.id);

    const completedTaskIds = new Set((userSubmissions || []).map(s => String(s.task_id)));

    // Transform Pexels objects into Cream Cake Task Objects
    const tasks = rawVideos.map(vid => {
      // Find suitable video stream (prefer HD 720p or SD)
      const videoStream = vid.video_files.find(f => f.quality === 'hd' && f.width >= 1280) 
        || vid.video_files[0];

      // Calculate task reward based on video duration
      const durationSeconds = vid.duration || 30;
      const baseReward = 200;
      const rewardAmount = Math.min(500, baseReward + Math.floor(durationSeconds * 3));
      const taskId = `vid_${vid.id}`;

      return {
        id: taskId,
        pexels_id: vid.id,
        title: `Watch & Rate: ${vid.user.name}'s Short Clip`,
        category: category === 'all' ? 'video' : category,
        duration_seconds: durationSeconds,
        reward: rewardAmount,
        thumbnail: vid.image,
        video_url: videoStream ? videoStream.link : '',
        author: vid.user.name,
        author_url: vid.user.url,
        is_completed: completedTaskIds.has(taskId)
      };
    });

    return success(res, {
      tasks,
      page: Number(page),
      total_results: pexelsRes.data.total_results || 0
    });

  } catch (err) {
    console.error('Pexels Video fetch error:', err.response?.data || err.message);
    return error(res, 'Failed to fetch video tasks', 500);
  }
});

/**
 * GET /api/videos/:id
 * Fetches single video task details by ID
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const videoId = req.params.id.replace('vid_', '');

    const pexelsRes = await axios.get(`${PEXELS_BASE_URL}/videos/${videoId}`, {
      headers: { Authorization: PEXELS_API_KEY }
    });

    const vid = pexelsRes.data;
    const videoStream = vid.video_files.find(f => f.quality === 'hd' && f.width >= 1280) 
      || vid.video_files[0];

    const taskId = `vid_${vid.id}`;
    const durationSeconds = vid.duration || 30;
    const rewardAmount = Math.min(500, 200 + Math.floor(durationSeconds * 3));

    // Check completion status
    const { data: submission } = await supabaseAdmin
      .from('task_submissions')
      .select('id, claimed_at')
      .eq('task_id', taskId)
      .eq('user_id', req.user.id)
      .maybeSingle();

    return success(res, {
      id: taskId,
      pexels_id: vid.id,
      title: `Watch & Rate: ${vid.user.name}'s Short Clip`,
      duration_seconds: durationSeconds,
      reward: rewardAmount,
      thumbnail: vid.image,
      video_url: videoStream ? videoStream.link : '',
      author: vid.user.name,
      is_completed: !!submission
    });

  } catch (err) {
    console.error('Single video fetch error:', err.message);
    return error(res, 'Failed to fetch video details', 500);
  }
});

/**
 * POST /api/videos/submit
 * Submits video rating, marks task complete, and adds reward to user balance
 */
router.post('/submit', requireAuth, async (req, res) => {
  try {
    const { task_id, rating, review_text, reward_amount } = req.body;
    const userId = req.user.id;

    if (!task_id) {
      return error(res, 'Task ID is required', 400);
    }

    if (!rating || rating < 1 || rating > 5) {
      return error(res, 'Please provide a valid rating between 1 and 5 stars', 400);
    }

    // 1. Check for Duplicate Submission
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
    const currentBalance = Number(req.user.balance) || 0;
    const currentEarned = Number(req.user.total_earned) || 0;
    const currentTasksCompleted = Number(req.user.tasks_completed) || 0;

    const newBalance = currentBalance + taskReward;
    const newTotalEarned = currentEarned + taskReward;
    const nowIso = new Date().toISOString();

    // 2. Insert Submission Record
    const { data: submission, error: submitErr } = await supabaseAdmin
      .from('task_submissions')
      .insert({
        task_id: String(task_id),
        user_id: userId,
        proof_data: { rating, review_text: review_text || '', type: 'video_rating' },
        reward: taskReward,
        status: 'completed',
        claimed_at: nowIso
      })
      .select()
      .single();

    if (submitErr) {
      console.error('Video submission error:', submitErr);
      return error(res, 'Failed to log video rating', 500);
    }

    // 3. Update User Balance & Task Counter
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

    // 4. Log Transaction
    await supabaseAdmin.from('transactions').insert({
      user_id: userId,
      type: 'task_reward',
      amount: taskReward,
      fee: 0.00,
      net_amount: taskReward,
      status: 'completed',
      description: `Video task bonus claimed for ${task_id}`,
      reference: `VID-${Date.now()}`
    });

    return success(res, {
      new_balance: newBalance,
      reward_earned: taskReward,
      submission
    }, `Video rating submitted! ₦${taskReward.toLocaleString()} added to your wallet.`, 201);

  } catch (err) {
    console.error('Video submit endpoint crash:', err);
    return error(res, 'Internal server error processing video reward', 500);
  }
});

export default router;
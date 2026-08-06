import express from 'express';
import axios from 'axios';
import { requireAuth } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();
const OPENLIBRARY_SEARCH_URL = 'https://openlibrary.org/search.json';

const SUBJECT_QUERIES = {
  all: 'bestsellers',
  fiction: 'subject:fiction',
  romance: 'subject:romance',
  fantasy: 'subject:fantasy',
  sci_fi: 'subject:science_fiction',
  business: 'subject:business'
};

/**
 * GET /api/books
 * Fetch books from OpenLibrary and attach completion status for current user
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { category = 'all', page = 1, search = '' } = req.query;
    
    let queryParam = search ? search : (SUBJECT_QUERIES[category] || SUBJECT_QUERIES.all);

    const olRes = await axios.get(OPENLIBRARY_SEARCH_URL, {
      params: {
        q: queryParam,
        page: Number(page),
        limit: 15,
        fields: 'key,title,author_name,cover_i,first_publish_year,ratings_average,subject'
      }
    });

    const rawDocs = olRes.data?.docs || [];

    // Fetch user's completed task submissions
    const { data: userSubmissions } = await supabaseAdmin
      .from('task_submissions')
      .select('task_id')
      .eq('user_id', req.user.id);

    const completedTaskIds = new Set((userSubmissions || []).map(s => String(s.task_id)));

    const tasks = rawDocs.map(doc => {
      // Clean OpenLibrary key (e.g., "/works/OL27448W" -> "book_OL27448W")
      const cleanKey = doc.key ? doc.key.replace('/works/', '') : Math.random().toString(36).substring(7);
      const taskId = `book_${cleanKey}`;

      const coverUrl = doc.cover_i 
        ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
        : 'https://via.placeholder.com/300x450/161B22/94A3B8?text=No+Cover+Available';

      // Dynamic reward calculation based on rating/data presence
      const rewardAmount = Math.min(650, 250 + Math.floor((doc.ratings_average || 3.5) * 50));

      return {
        id: taskId,
        ol_key: cleanKey,
        title: doc.title || 'Untitled Book',
        author: doc.author_name ? doc.author_name.join(', ') : 'Unknown Author',
        cover_url: coverUrl,
        published_year: doc.first_publish_year || 'N/A',
        rating_avg: doc.ratings_average ? Number(doc.ratings_average).toFixed(1) : '4.2',
        reward: rewardAmount,
        category: category === 'all' ? 'Book Review' : category,
        is_completed: completedTaskIds.has(taskId)
      };
    });

    return success(res, {
      tasks,
      page: Number(page),
      total_results: olRes.data?.numFound || 0
    });

  } catch (err) {
    console.error('OpenLibrary Fetch Error:', err.response?.data || err.message);
    return error(res, 'Failed to fetch book review tasks', 500);
  }
});

/**
 * GET /api/books/:id
 * Get single book details for review modal or dedicated reader page
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const taskId = req.params.id;
    const olKey = taskId.replace('book_', '');

    const olRes = await axios.get(`https://openlibrary.org/works/${olKey}.json`);
    const bookData = olRes.data;

    // Check completion status
    const { data: submission } = await supabaseAdmin
      .from('task_submissions')
      .select('id, created_at')
      .eq('task_id', taskId)
      .eq('user_id', req.user.id)
      .maybeSingle();

    let description = 'No detailed summary provided for this title.';
    if (typeof bookData.description === 'string') {
      description = bookData.description;
    } else if (bookData.description?.value) {
      description = bookData.description.value;
    }

    const coverId = bookData.covers?.[0];
    const coverUrl = coverId 
      ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
      : 'https://via.placeholder.com/300x450/161B22/94A3B8?text=No+Cover+Available';

    return success(res, {
      id: taskId,
      title: bookData.title,
      description: description.substring(0, 500) + (description.length > 500 ? '...' : ''),
      cover_url: coverUrl,
      reward: 350,
      is_completed: !!submission
    });

  } catch (err) {
    console.error('Book Detail Fetch Error:', err.message);
    return error(res, 'Failed to load book metadata', 500);
  }
});

/**
 * POST /api/books/submit
 * Submit rating, review text, and credit reward to wallet
 */
router.post('/submit', requireAuth, async (req, res) => {
  try {
    const { task_id, rating, review_text, reward_amount } = req.body;
    const userId = req.user?.id;

    if (!task_id) return error(res, 'Task ID is required', 400);
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
      return error(res, 'You have already reviewed and claimed rewards for this book!', 400);
    }

    const taskReward = Number(reward_amount) || 300;
    const currentBalance = Number(req.user?.balance) || 0;
    const currentEarned = Number(req.user?.total_earned) || 0;
    const currentTasksCompleted = Number(req.user?.tasks_completed) || 0;

    const newBalance = currentBalance + taskReward;
    const newTotalEarned = currentEarned + taskReward;
    const nowIso = new Date().toISOString();

    // 2. Insert submission record
    const { data: submission, error: submitErr } = await supabaseAdmin
      .from('task_submissions')
      .insert({
        task_id: String(task_id),
        user_id: userId,
        status: 'approved',
        reward: taskReward,
        proof_data: { rating, review_text: review_text || '', type: 'book_review' },
        proof_url: `Book Rating: ${rating}/5 Stars`,
        reviewed_at: nowIso,
        created_at: nowIso
      })
      .select()
      .single();

    if (submitErr) {
      console.error('Book Submission DB Error:', submitErr);
      return error(res, `Failed to save review: ${submitErr.message}`, 500);
    }

    // 3. Update User Wallet and counters
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
    }, `Book review submitted! ₦${taskReward.toLocaleString()} added to your balance.`, 201);

  } catch (err) {
    console.error('Book Submit Handler Crash:', err);
    return error(res, 'Internal server error processing book review', 500);
  }
});

export default router;
import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

/**
 * GET /
 * Fetches tasks matching user's VIP tier with optional category filter
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userVipLevel = req.user?.vip_level || 0;
    const { category } = req.query;

    let query = supabaseAdmin
      .from('tasks')
      .select('id, title, description, category, reward, required_vip_level, duration_seconds, action_url, total_slots, completed_slots')
      .eq('is_active', true)
      .lte('required_vip_level', userVipLevel);

    if (category && category !== 'all') {
      query = query.eq('category', category);
    }

    const { data: tasks, error: fetchError } = await query.order('created_at', { ascending: false });

    if (fetchError) {
      console.error('Task fetch error:', fetchError);
      return error(res, 'Failed to fetch tasks', 500);
    }

    const { data: userSubmissions } = await supabaseAdmin
      .from('task_submissions')
      .select('task_id')
      .eq('user_id', req.user.id);

    const completedTaskIds = new Set((userSubmissions || []).map(s => Number(s.task_id)));

    const enrichedTasks = (tasks || []).map(t => ({
      ...t,
      is_completed: completedTaskIds.has(Number(t.id))
    }));

    return success(res, enrichedTasks);
  } catch (err) {
    console.error('Tasks list handler crash:', err);
    return error(res, 'Internal server error', 500);
  }
});

/**
 * GET /available
 */
router.get('/available', requireAuth, async (req, res) => {
  try {
    const userAccessLevel = req.user?.task_access_level || 1;

    const { data: tasks, error: tasksError } = await supabaseAdmin
      .from('tasks')
      .select('*')
      .eq('is_active', true)
      .lte('required_level', userAccessLevel)
      .order('reward', { ascending: false });

    if (tasksError) {
      console.error('Available tasks fetch error:', tasksError);
      return error(res, 'Failed to fetch available tasks', 500);
    }

    return success(res, { tasks: tasks || [] });
  } catch (err) {
    console.error('Available tasks handler crash:', err);
    return error(res, 'Internal server error', 500);
  }
});

/**
 * POST /submit
 */
router.post('/submit', requireAuth, async (req, res) => {
  try {
    const { task_id, proof_data } = req.body;
    const userId = req.user?.id;

    if (!task_id || isNaN(Number(task_id))) {
      return error(res, 'Valid Task ID is required', 400);
    }

    const numericTaskId = Number(task_id);

    const { data: task, error: taskError } = await supabaseAdmin
      .from('tasks')
      .select('*')
      .eq('id', numericTaskId)
      .eq('is_active', true)
      .maybeSingle();

    if (taskError || !task) {
      return error(res, 'Task not found or no longer active', 404);
    }

    if (task.required_vip_level > (req.user?.vip_level || 0)) {
      return error(res, 'Insufficient VIP level to complete this task', 403);
    }

    const { data: existing } = await supabaseAdmin
      .from('task_submissions')
      .select('id')
      .eq('task_id', numericTaskId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      return error(res, 'You have already completed and claimed this task', 400);
    }

    const taskReward = Number(task.reward) || 0;
    const currentBalance = Number(req.user?.balance) || 0;
    const currentEarned = Number(req.user?.total_earned) || 0;
    const currentTasksCompleted = Number(req.user?.tasks_completed) || 0;

    const newBalance = currentBalance + taskReward;
    const newTotalEarned = currentEarned + taskReward;
    const nowIso = new Date().toISOString();

    const { data: submission, error: submitError } = await supabaseAdmin
      .from('task_submissions')
      .insert({
        task_id: numericTaskId,
        user_id: userId,
        proof_data: proof_data || {},
        reward: taskReward,
        status: 'completed',
        claimed_at: nowIso
      })
      .select()
      .single();

    if (submitError) {
      console.error('Submission database insert error:', submitError);
      return error(res, 'Failed to record task completion', 500);
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

    await supabaseAdmin
      .from('tasks')
      .update({ completed_slots: (task.completed_slots || 0) + 1 })
      .eq('id', numericTaskId);

    return success(res, {
      new_balance: newBalance,
      reward_earned: taskReward,
      submission
    }, `Task completed! ₦${taskReward.toLocaleString()} credited to your balance.`, 201);

  } catch (err) {
    console.error('Task submission handler crash:', err);
    return error(res, 'Internal server error processing completion', 500);
  }
});

/**
 * GET /:id
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const taskId = req.params.id;

    if (!taskId || isNaN(Number(taskId))) {
      return error(res, 'Invalid Task ID parameter', 400);
    }

    const numericTaskId = Number(taskId);

    const { data: task, error: fetchErr } = await supabaseAdmin
      .from('tasks')
      .select('*')
      .eq('id', numericTaskId)
      .eq('is_active', true)
      .maybeSingle();

    if (fetchErr || !task) {
      return error(res, 'Task not found or inactive', 404);
    }

    const { data: submission } = await supabaseAdmin
      .from('task_submissions')
      .select('id, claimed_at')
      .eq('task_id', numericTaskId)
      .eq('user_id', req.user.id)
      .maybeSingle();

    return success(res, {
      ...task,
      is_completed: !!submission,
      completed_at: submission ? submission.claimed_at : null
    });
  } catch (err) {
    console.error('Single task route crash:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
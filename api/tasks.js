import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

/**
 * GET /api/tasks
 * Fetches all active tasks filtered by VIP level or optional category
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userVipLevel = req.user.vip_level || 0;
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

    // Retrieve user's completed task IDs to filter/mark UI state
    const { data: userSubmissions } = await supabaseAdmin
      .from('task_submissions')
      .select('task_id')
      .eq('user_id', req.user.id);

    const completedTaskIds = new Set((userSubmissions || []).map(s => s.task_id));

    const enrichedTasks = (tasks || []).map(t => ({
      ...t,
      is_completed: completedTaskIds.has(t.id)
    }));

    return success(res, enrichedTasks);
  } catch (err) {
    console.error('Tasks list error:', err);
    return error(res, 'Internal server error', 500);
  }
});

/**
 * GET /api/tasks/available
 * Alias endpoint matching user access level
 */
router.get('/available', requireAuth, async (req, res) => {
  try {
    const userAccessLevel = req.user.task_access_level || 1;

    const { data: tasks, error: tasksError } = await supabaseAdmin
      .from('tasks')
      .select('*')
      .eq('is_active', true)
      .lte('required_level', userAccessLevel)
      .order('reward', { ascending: false });

    if (tasksError) {
      return error(res, 'Failed to fetch available tasks', 500);
    }

    return success(res, { tasks: tasks || [] });
  } catch (err) {
    console.error('Available tasks error:', err);
    return error(res, 'Internal server error', 500);
  }
});

/**
 * GET /api/tasks/:id
 * Fetches specific task details by ID
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const taskId = req.params.id;

    const { data: task, error: fetchErr } = await supabaseAdmin
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('is_active', true)
      .single();

    if (fetchErr || !task) {
      return error(res, 'Task not found or inactive', 404);
    }

    // Check completion status
    const { data: submission } = await supabaseAdmin
      .from('task_submissions')
      .select('id, claimed_at')
      .eq('task_id', taskId)
      .eq('user_id', req.user.id)
      .single();

    return success(res, {
      ...task,
      is_completed: !!submission,
      completed_at: submission ? submission.claimed_at : null
    });
  } catch (err) {
    console.error('Single task fetch error:', err);
    return error(res, 'Internal server error', 500);
  }
});

/**
 * POST /api/tasks/submit
 * Submits task proof, verifies delay, credits user balance instantly, and logs transaction
 */
router.post('/submit', requireAuth, async (req, res) => {
  try {
    const { task_id, proof_data } = req.body;
    const userId = req.user.id;

    if (!task_id) {
      return error(res, 'Task ID is required', 400);
    }

    // 1. Check Task Existence & VIP eligibility
    const { data: task, error: taskError } = await supabaseAdmin
      .from('tasks')
      .select('*')
      .eq('id', task_id)
      .eq('is_active', true)
      .single();

    if (taskError || !task) {
      return error(res, 'Task not found or no longer active', 404);
    }

    if (task.required_vip_level > (req.user.vip_level || 0)) {
      return error(res, 'Insufficient VIP level to complete this task', 403);
    }

    // 2. Prevent Duplicate Completions
    const { data: existing } = await supabaseAdmin
      .from('task_submissions')
      .select('id')
      .eq('task_id', task_id)
      .eq('user_id', userId)
      .single();

    if (existing) {
      return error(res, 'You have already completed and claimed this task', 400);
    }

    const taskReward = Number(task.reward) || 0;
    const currentBalance = Number(req.user.balance) || 0;
    const currentEarned = Number(req.user.total_earned) || 0;
    const currentTasksCompleted = Number(req.user.tasks_completed) || 0;

    const newBalance = currentBalance + taskReward;
    const newTotalEarned = currentEarned + taskReward;
    const nowIso = new Date().toISOString();

    // 3. Record Submission
    const { data: submission, error: submitError } = await supabaseAdmin
      .from('task_submissions')
      .insert({
        task_id: Number(task_id),
        user_id: userId,
        proof_data: proof_data || {},
        reward: taskReward,
        status: 'completed',
        claimed_at: nowIso
      })
      .select()
      .single();

    if (submitError) {
      console.error('Submission recording error:', submitError);
      return error(res, 'Failed to record task completion', 500);
    }

    // 4. Update User Balance & Task Counters
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

    // 5. Increment Task Slots
    await supabaseAdmin
      .from('tasks')
      .update({
        completed_slots: (task.completed_slots || 0) + 1
      })
      .eq('id', task_id);

    // 6. Record Transaction
    await supabaseAdmin.from('transactions').insert({
      user_id: userId,
      type: 'task_reward',
      amount: taskReward,
      fee: 0.00,
      net_amount: taskReward,
      status: 'completed',
      description: `Reward earned for task: ${task.title}`,
      reference: `TASK-${task_id}-${userId}-${Date.now()}`
    });

    return success(res, {
      new_balance: newBalance,
      reward_earned: taskReward,
      submission
    }, `Task completed! ₦${taskReward.toLocaleString()} credited to your balance.`, 201);

  } catch (err) {
    console.error('Task submit error:', err);
    return error(res, 'Internal server error processing completion', 500);
  }
});

export default router;
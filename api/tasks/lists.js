import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { success, error } from '../../utils/response.js';

const router = express.Router();

/**
 * GET /api/tasks
 * Fetches active tasks matching user's VIP tier
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userVipLevel = req.user.vip_level || 0;

    const { data: tasks, error: fetchError } = await supabaseAdmin
      .from('tasks')
      .select('id, title, description, category, reward, estimated_time, required_vip_level, total_slots, completed_slots')
      .eq('is_active', true)
      .lte('required_vip_level', userVipLevel)
      .order('created_at', { ascending: false });

    if (fetchError) {
      return error(res, 'Failed to fetch tasks', 500);
    }

    return success(res, tasks || []);
  } catch (err) {
    console.error('Tasks list error:', err);
    return error(res, 'Internal server error', 500);
  }
});

/**
 * GET /api/tasks/available
 * Fetches available tasks filtered by task_access_level
 */
router.get('/available', requireAuth, async (req, res) => {
  try {
    const userAccessLevel = req.user.task_access_level || 1;

    const { data: tasks, error: tasksError } = await supabaseAdmin
      .from('tasks')
      .select('id, title, description, reward, estimated_time, category, required_level, is_active')
      .eq('is_active', true)
      .lte('required_level', userAccessLevel)
      .order('reward', { ascending: false });

    if (tasksError) {
      return error(res, 'Failed to fetch tasks', 500);
    }

    return success(res, { tasks: tasks || [] });

  } catch (err) {
    console.error('Tasks list error:', err);
    return error(res, 'Internal server error', 500);
  }
});

export default router;
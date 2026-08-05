// import express from 'express';
// import { requireAuth } from '../../middleware/auth.js';
// import { supabaseAdmin } from '../../lib/supabase.js';
// import { success, error } from '../../utils/response.js';

// const router = express.Router();

// /**
//  * GET /api/tasks
//  * Fetches active tasks matching user's VIP tier
//  */
// router.get('/', requireAuth, async (req, res) => {
//   try {
//     const userVipLevel = req.user.vip_level || 0;

//     const { data: tasks, error: fetchError } = await supabaseAdmin
//       .from('tasks')
//       .select('id, title, description, category, reward, estimated_time, required_vip_level, total_slots, completed_slots')
//       .eq('is_active', true)
//       .lte('required_vip_level', userVipLevel)
//       .order('created_at', { ascending: false });

//     if (fetchError) {
//       return error(res, 'Failed to fetch tasks', 500);
//     }

//     return success(res, tasks || []);
//   } catch (err) {
//     console.error('Tasks list error:', err);
//     return error(res, 'Internal server error', 500);
//   }
// });

// /**
//  * GET /api/tasks/available
//  * Fetches available tasks filtered by task_access_level
//  */
// router.get('/available', requireAuth, async (req, res) => {
//   try {
//     const userAccessLevel = req.user.task_access_level || 1;

//     const { data: tasks, error: tasksError } = await supabaseAdmin
//       .from('tasks')
//       .select('id, title, description, reward, estimated_time, category, required_level, is_active')
//       .eq('is_active', true)
//       .lte('required_level', userAccessLevel)
//       .order('reward', { ascending: false });

//     if (tasksError) {
//       return error(res, 'Failed to fetch tasks', 500);
//     }

//     return success(res, { tasks: tasks || [] });

//   } catch (err) {
//     console.error('Tasks list error:', err);
//     return error(res, 'Internal server error', 500);
//   }
// });

// /**
//  * POST /api/tasks/submit
//  * Submits task proof for verification
//  */
// router.post('/submit', requireAuth, async (req, res) => {
//   try {
//     const { task_id, proof_data } = req.body;
//     const userId = req.user.id;

//     if (!task_id) {
//       return error(res, 'Task ID is required', 400);
//     }

//     // Check task existence and eligibility
//     const { data: task, error: taskError } = await supabaseAdmin
//       .from('tasks')
//       .select('*')
//       .eq('id', task_id)
//       .eq('is_active', true)
//       .single();

//     if (taskError || !task) {
//       return error(res, 'Task not found or no longer active', 404);
//     }

//     if (task.required_vip_level > (req.user.vip_level || 0)) {
//       return error(res, 'Insufficient VIP tier to submit this task', 403);
//     }

//     // Verify duplicate submission
//     const { data: existing } = await supabaseAdmin
//       .from('task_submissions')
//       .select('id')
//       .eq('task_id', task_id)
//       .eq('user_id', userId)
//       .single();

//     if (existing) {
//       return error(res, 'You have already submitted this task', 400);
//     }

//     // Submit task
//     const { data: submission, error: submitError } = await supabaseAdmin
//       .from('task_submissions')
//       .insert({
//         task_id,
//         user_id: userId,
//         proof_data: proof_data || {},
//         reward: task.reward,
//         status: 'pending'
//       })
//       .select()
//       .single();

//     if (submitError) {
//       return error(res, 'Failed to record submission', 500);
//     }

//     return success(res, submission, 'Task proof submitted for review', 201);

//   } catch (err) {
//     console.error('Task submit error:', err);
//     return error(res, 'Internal server error', 500);
//   }
// });

// export default router;
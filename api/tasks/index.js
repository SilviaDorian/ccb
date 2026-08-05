// import express from 'express';
// import { requireAuth } from '../../middleware/auth.js';
// import { supabaseAdmin } from '../../lib/supabase.js';
// import { success, error } from '../../utils/response.js';

// const router = express.Router();

// /**
//  * GET /api/tasks
//  */
// router.get('/', requireAuth, async (req, res) => {
//   try {
//     const userVipLevel = req.user.vip_level || 0;

//     // Retrieve active tasks accessible at user's VIP tier or lower
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

// export default router;
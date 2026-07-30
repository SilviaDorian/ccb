import { verifyToken } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabase.js';

/**
 * Authenticates the request header token and retrieves the active user.
 */
export async function authenticate(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Unauthorized', status: 401 };
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);

  if (!decoded || !decoded.userId) {
    return { error: 'Invalid or expired token', status: 401 };
  }

  // Fetch fresh user data
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', decoded.userId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .single();

  if (error || !user) {
    return { error: 'User not found or inactive', status: 401 };
  }

  return { user };
}

/**
 * Express Middleware: requireAuth
 * Protects route endpoints and attaches `req.user`
 */
export const requireAuth = async (req, res, next) => {
  // If used as a higher-order wrapper function `requireAuth(handler)`
  if (typeof req === 'function') {
    const handler = req;
    return async (handlerReq, handlerRes) => {
      const auth = await authenticate(handlerReq);
      if (auth.error) {
        return handlerRes.status(auth.status).json({ success: false, message: auth.error });
      }
      handlerReq.user = auth.user;
      return handler(handlerReq, handlerRes);
    };
  }

  // Standard Express Middleware execution
  const auth = await authenticate(req);
  if (auth.error) {
    return res.status(auth.status).json({ success: false, message: auth.error });
  }

  req.user = auth.user;
  next();
};

export default { authenticate, requireAuth };
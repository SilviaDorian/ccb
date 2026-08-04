import { createClient } from '@supabase/supabase-js';

const rawSupabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!rawSupabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

// Sanitize URL: remove trailing slash or misplaced /rest/v1 suffixes
const supabaseUrl = rawSupabaseUrl
  .replace(/\/rest\/v1\/?$/, '')
  .replace(/\/+$/, '');

// Service role client (full access - use only on server)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Anon client (for limited operations)
export const supabase = createClient(supabaseUrl, supabaseAnonKey || supabaseServiceKey);

export default { supabase, supabaseAdmin };
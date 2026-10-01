import { supabase } from './supabase';

export async function checkSignupLogin(login: string) {
  const value = login.trim().replace(/\s+/g, ' ');
  const { data, error } = await supabase().rpc('knowledge_signup_check', { payload: { login: value } });
  // Older deployments remain usable while the incremental migration is being installed.
  if (error?.code === 'PGRST202') return;
  if (error) throw { code: 'signup_check_unavailable', status: 503 };
  if (data?.limited) throw { code: 'over_request_rate_limit', status: 429 };
  if (data?.available === false) throw { code: 'username_exists', status: 409 };
  if (data?.available !== true) throw { code: 'signup_check_unavailable', status: 503 };
}

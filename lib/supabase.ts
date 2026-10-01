import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const projectUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const publishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
let validKey = publishableKey.startsWith('sb_publishable_');
// Legacy anon keys are public too; a service_role JWT must never enter a browser.
if (!validKey && publishableKey.startsWith('eyJ')) {
  try {
    const claims = JSON.parse(atob(publishableKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    validKey = claims.role === 'anon';
  } catch { validKey = false; }
}
let validUrl = false;
try { const url = new URL(projectUrl); validUrl = url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password; } catch {}
export const authConfigured = validUrl && validKey;
let client: SupabaseClient | undefined;
export function supabase() {
  if (!authConfigured) throw new Error('Вход временно недоступен. Обратитесь к администратору сайта.');
  return client ||= createClient(projectUrl, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  });
}
export function siteReturnUrl() {
  // Both username.github.io/ and username.github.io/repository/ are supported.
  return new URL('./', window.location.href).href;
}
export const discordEnabled = import.meta.env.VITE_DISCORD_ENABLED === 'true';

export async function signInWithLogin(login: string, password: string) {
  const response = await fetch(`${projectUrl}/functions/v1/username-login`, {
    method: 'POST', headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: login.trim().replace(/\s+/g, ' '), password }),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) throw { code: result.code, status: response.status };
  const { error } = await supabase().auth.setSession({ access_token: result.access_token, refresh_token: result.refresh_token });
  if (error) throw error;
}

/** Bind this sensitive write to the verified session, even if another tab signs in. */
export async function updatePasswordForSession(session: { access_token: string; user: { id: string } }, password: string) {
  if (!authConfigured) throw { code: 'recovery_session_missing' };
  const response = await fetch(`${projectUrl}/auth/v1/user`, {
    method: 'PUT',
    headers: { apikey: publishableKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' },
    body: JSON.stringify({ password }), signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) throw { code: result.code || result.error_code, status: response.status };
  if (result.id !== session.user.id) throw { code: 'recovery_session_missing' };
}

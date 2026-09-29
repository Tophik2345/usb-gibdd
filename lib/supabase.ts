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

import { siteReturnUrl, supabase } from './supabase';

export type RecoveryState = Readonly<{ email: string; userId: string | null }>;
const storageKey = 'usb-password-recovery';
let state: RecoveryState | null = null;
try {
  const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
  if (saved && typeof saved.email === 'string' && (saved.userId === null || typeof saved.userId === 'string')) state = saved;
} catch { /* Storage may be unavailable. */ }
const listeners = new Set<() => void>();
let tracking = false;
function change(next: RecoveryState | null) {
  state = next;
  try { if (next) sessionStorage.setItem(storageKey, JSON.stringify(next)); else sessionStorage.removeItem(storageKey); } catch { /* Keep working in memory. */ }
  listeners.forEach(listener => listener());
}
export const recoverySnapshot = () => state;
export function subscribeRecovery(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function beginRecovery(email = '') { change({ email: email.trim().toLowerCase(), userId: null }); }
export function closeRecovery() { change(null); }
export function trackPasswordRecovery() {
  if (tracking) return;
  tracking = true;
  supabase().auth.onAuthStateChange((event, session) => {
    // No awaited Auth methods here: the SDK holds its authentication lock.
    if (event === 'PASSWORD_RECOVERY' && session) change({ email: session.user.email || '', userId: session.user.id });
    else if (event === 'SIGNED_OUT' || (state?.userId && session?.user.id !== state.userId)) closeRecovery();
  });
}
function address(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw { code: 'email_address_invalid', status: 400 };
  return normalized;
}
export async function requestRecoveryCode(email: string) {
  const { error } = await supabase().auth.resetPasswordForEmail(address(email), { redirectTo: siteReturnUrl() });
  if (error) throw error;
}
export async function verifyRecoveryCode(email: string, code: string) {
  const token = code.trim();
  if (!/^\d{6,10}$/.test(token)) throw { code: 'otp_invalid', status: 400 };
  const { data, error } = await supabase().auth.verifyOtp({ type: 'recovery', email: address(email), token });
  if (error) throw error;
  if (!data.session) throw { code: 'recovery_session_missing' };
  change({ email: data.session.user.email || address(email), userId: data.session.user.id });
}
export async function saveRecoveredPassword(password: string, repeated: string, userId: string) {
  if (password.length < 12 || password.length > 128) throw { code: 'weak_password' };
  if (password !== repeated) throw { code: 'password_mismatch' };
  const client = supabase();
  const { data: { session }, error: sessionError } = await client.auth.getSession();
  if (sessionError || session?.user.id !== userId || state?.userId !== userId) throw { code: 'recovery_session_missing' };
  const { error } = await client.auth.updateUser({ password });
  if (error) throw error;
  // The caller closes recovery only after showing success; no code or password is persisted.
}

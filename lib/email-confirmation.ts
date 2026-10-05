import { siteReturnUrl, supabase } from './supabase';

function confirmationEmail(email: string) {
  const address = email.trim().toLowerCase();
  if (!address) throw { code: 'email_address_invalid', status: 400 };
  return address;
}

export async function sendEmailCode(email: string) {
  const address = confirmationEmail(email);
  const { error } = await supabase().auth.signInWithOtp({
    email: address,
    options: { shouldCreateUser: false, emailRedirectTo: siteReturnUrl() },
  });
  if (error) throw error;
}

export async function verifyEmailCode(email: string, code: string) {
  const address = confirmationEmail(email);
  const token = code.trim();
  if (!/^\d{6,10}$/.test(token)) throw { code: 'otp_invalid', status: 400 };
  const { data, error } = await supabase().auth.verifyOtp({
    type: 'email', email: address, token,
  });
  if (error) throw error;
  if (!data?.session) throw { code: 'confirmation_session_missing' };
  return data.session;
}

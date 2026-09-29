// Custom authentication endpoint: a session is returned only after GoTrue validates
// the user's password AND confirmed email. Administrative credentials never leave it.
const cors = {
  'Access-Control-Allow-Origin': 'https://tophik2345.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const reply = (status: number, data: unknown) => Response.json(data, { status, headers: cors });
function envKey(modern: string, legacy: string) {
  const keys = Deno.env.get(modern);
  return (keys ? JSON.parse(keys).default : '') || Deno.env.get(legacy) || '';
}
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return reply(405, { code: 'method_not_allowed' });
  try {
    if (Number(req.headers.get('content-length') || 0) > 4096) return reply(413, { code: 'invalid_credentials' });
    const reader = req.body?.getReader();
    if (!reader) return reply(400, { code: 'invalid_credentials' });
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); return reply(413, { code: 'invalid_credentials' }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let body;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return reply(400, { code: 'invalid_credentials' }); }
    if (typeof body?.login !== 'string' || typeof body?.password !== 'string' ||
        body.login.length > 100 || body.login.trim().length < 2 || !body.password.length || body.password.length > 128) {
      return reply(400, { code: 'invalid_credentials' });
    }
    const url = Deno.env.get('SUPABASE_URL')!;
    const secret = envKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
    const publicKey = envKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
    const lookup = await fetch(`${url}/rest/v1/rpc/resolve_username_login`, {
      method: 'POST', headers: { apikey: secret, ...(secret.startsWith('eyJ') ? { Authorization: `Bearer ${secret}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: body.login }), signal: AbortSignal.timeout(10000),
    });
    if (!lookup.ok) return reply(503, { code: 'temporarily_unavailable' });
    const resolved = await lookup.json();
    if (!resolved.allowed) return reply(429, { code: 'over_request_rate_limit' });
    // Unknown usernames still take the password verification path. Never return the lookup.
    const email = resolved.email || `${crypto.randomUUID()}@invalid.invalid`;
    const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: publicKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: body.password }), signal: AbortSignal.timeout(15000),
    });
    const session = await auth.json();
    if (!auth.ok || !resolved.email) {
      if (auth.status === 429) return reply(429, { code: 'over_request_rate_limit' });
      if (session.error_code === 'email_not_confirmed') return reply(401, { code: 'email_not_confirmed' });
      return reply(401, { code: 'invalid_credentials' });
    }
    return reply(200, { access_token: session.access_token, refresh_token: session.refresh_token });
  } catch {
    return reply(503, { code: 'temporarily_unavailable' });
  }
});

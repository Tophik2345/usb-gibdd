import { verifyGitHubIdentity } from './github-identity.mjs';

const reply = (status: number, data: unknown) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return reply(405, { code: 'method_not_allowed' });
  try { await verifyGitHubIdentity(req.headers.get('authorization')?.replace(/^Bearer /, '')); }
  catch { return reply(401, { code: 'invalid_workflow_identity' }); }
  try {
    if (Number(req.headers.get('content-length') || 0) > 400000) return reply(413, { code: 'invalid_references' });
    const reader = req.body?.getReader();
    if (!reader) return reply(400, { code: 'invalid_references' });
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 400000) { await reader.cancel(); return reply(413, { code: 'invalid_references' }); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    const modern = Deno.env.get('SUPABASE_SECRET_KEYS');
    const key = (modern ? JSON.parse(modern).default : '') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/sync_law_article_references`, {
      method: 'POST', headers: { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ refs: body.refs }), signal: AbortSignal.timeout(15000), redirect: 'error',
    });
    if (!response.ok) return reply(503, { code: 'reference_sync_failed' });
    const result = await response.json();
    return reply(200, { activeReferences: result.activeReferences });
  } catch { return reply(503, { code: 'temporarily_unavailable' }); }
});

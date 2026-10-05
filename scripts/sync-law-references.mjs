import { readFile } from 'node:fs/promises';

let stage = 'configuration', httpStatus = null, replyCode = null;
try {
  const metadata = JSON.parse(await readFile(new URL('../lib/law-documents.json', import.meta.url), 'utf8'));
  const refs = [];
  for (const doc of metadata) {
    const body = JSON.parse(await readFile(new URL(`../public/laws/${doc.id}.json`, import.meta.url), 'utf8'));
    refs.push(...body.entries.filter(entry => entry.kind === 'article').map(entry => ({ document: doc.id, article: entry.id })));
  }
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.actions.githubusercontent.com')) throw new Error('Invalid identity issuer.');
  url.searchParams.set('audience', 'usb-gibdd-law-sync');
  stage = 'workflow-identity';
  const identity = await fetch(url, { headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  httpStatus = identity.status;
  if (!identity.ok) throw new Error('Workflow identity is unavailable.');
  const { value } = await identity.json();
  const claims = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8'));
  const header = JSON.parse(Buffer.from(value.split('.')[0], 'base64url').toString('utf8'));
  console.log(JSON.stringify({ identityChecks: {
    repository: claims.repository === 'Tophik2345/usb-gibdd', ref: claims.ref === 'refs/heads/main',
    subject: claims.sub === 'repo:Tophik2345/usb-gibdd:ref:refs/heads/main',
    workflow: claims.workflow_ref === 'Tophik2345/usb-gibdd/.github/workflows/laws-sync.yml@refs/heads/main',
    issuer: claims.iss === 'https://token.actions.githubusercontent.com', audience: claims.aud === 'usb-gibdd-law-sync',
    rsaSignature: header.alg === 'RS256', unexpired: claims.exp > Date.now() / 1000,
  } }));
  stage = 'reference-endpoint'; httpStatus = null;
  const response = await fetch('https://ncimpseeaovgqipsqgju.supabase.co/functions/v1/sync-law-references', {
    method: 'POST', headers: { Authorization: `Bearer ${value}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refs }), redirect: 'error', signal: AbortSignal.timeout(25000),
  });
  httpStatus = response.status;
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (['invalid_workflow_identity','reference_sync_failed','temporarily_unavailable'].includes(body.code)) replyCode = body.code;
    throw new Error('Reference sync failed.');
  }
  const result = await response.json();
  if (result.activeReferences !== refs.length) throw new Error('Reference count mismatch.');
  console.log(JSON.stringify({ activeReferences: result.activeReferences }));
} catch {
  // Neither short-lived workflow credentials nor transport errors are logged.
  console.error('Не удалось синхронизировать ссылки избранного; публикация новой редакции остановлена.');
  console.error(JSON.stringify({ stage, httpStatus, replyCode }));
  process.exitCode = 1;
}

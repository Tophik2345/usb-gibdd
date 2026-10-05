import { readFile } from 'node:fs/promises';

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
  const identity = await fetch(url, { headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!identity.ok) throw new Error('Workflow identity is unavailable.');
  const { value } = await identity.json();
  const response = await fetch('https://ncimpseeaovgqipsqgju.supabase.co/functions/v1/sync-law-references', {
    method: 'POST', headers: { Authorization: `Bearer ${value}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refs }), redirect: 'error', signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error('Reference sync failed.');
  const result = await response.json();
  if (result.activeReferences !== refs.length) throw new Error('Reference count mismatch.');
  console.log(JSON.stringify({ activeReferences: result.activeReferences }));
} catch {
  // Neither short-lived workflow credentials nor transport errors are logged.
  console.error('Не удалось синхронизировать ссылки избранного; публикация новой редакции остановлена.');
  process.exitCode = 1;
}

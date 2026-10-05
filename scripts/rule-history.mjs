import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function historyEntries(snapshot) {
  if (snapshot.entries) return snapshot.entries.map(({ id, kind, title, chapter, paragraphs }) => ({ id, kind, title, chapter, paragraphs }));
  const points = snapshot.points.map(point => ({ id: 'point-' + point.number, kind: 'article', title: 'Пункт ' + point.number, chapter: '', paragraphs: point.paragraphs }));
  // Keep headings and other text too, so changes outside numbered points remain visible.
  const numbered = new Set(snapshot.points.flatMap(point => point.paragraphs));
  return [{ id: 'other-text', kind: 'introduction', title: 'Заголовки и дополнительные положения', chapter: '', paragraphs: snapshot.lines.filter(line => !numbered.has(line)) }, ...points];
}
export function compareSnapshots(previous, next) {
  const before = new Map(historyEntries(previous).map(entry => [entry.id, entry]));
  const after = new Map(historyEntries(next).map(entry => [entry.id, entry]));
  return [...new Set([...before.keys(), ...after.keys()])].flatMap(id => {
    const old = before.get(id) || null, current = after.get(id) || null;
    if (JSON.stringify(old) === JSON.stringify(current)) return [];
    return [{ id, type: !old ? 'added' : !current ? 'removed' : 'changed', before: old, after: current }];
  });
}
export async function historyFiles(root, updates) {
  const path = resolve(root, 'public/rule-history/index.json');
  let index;
  try { index = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; index = { version: 1, startedAt: new Date().toISOString(), documents: [], revisions: [] }; }
  if (index.version !== 1 || !Array.isArray(index.documents) || !Array.isArray(index.revisions)) throw new Error('Журнал редакций повреждён; обновление остановлено.');
  const files = [];
  for (const { id, previous, next } of updates) {
    if (!index.documents.some(doc => doc.id === id)) index.documents.push({ id, title: previous.title, sourceUrl: previous.sourceUrl, baselineHash: hash(historyEntries(previous)) });
    const changes = compareSnapshots(previous, next);
    if (!changes.length) continue;
    const beforeHash = hash(historyEntries(previous)), afterHash = hash(historyEntries(next));
    const revisionId = id + '-' + hash([beforeHash, afterHash, next.checkedAt]).slice(0, 24);
    if (index.revisions.some(revision => revision.id === revisionId)) continue;
    const revision = { id: revisionId, document: id, title: next.title, sourceUrl: next.sourceUrl, sourceEditedAt: next.sourceEditedAt || null,
      detectedAt: next.checkedAt, beforeHash, afterHash,
      added: changes.filter(change => change.type === 'added').length, changed: changes.filter(change => change.type === 'changed').length,
      removed: changes.filter(change => change.type === 'removed').length };
    files.push([resolve(root, `public/rule-history/${revisionId}.json`), { ...revision, changes }]);
    index.revisions.unshift(revision);
  }
  index.revisions.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt) || a.id.localeCompare(b.id));
  await mkdir(resolve(root, 'public/rule-history'), { recursive: true });
  files.push([path, index]);
  return files;
}
export async function initializeHistory(root = resolve(import.meta.dirname, '..')) {
  const ids = JSON.parse(await readFile(resolve(root, 'lib/law-sources.json'), 'utf8')).map(source => source.id);
  const updates = [];
  for (const id of [...ids, 'state-organizations']) {
    const snapshot = JSON.parse(await readFile(resolve(root, id === 'state-organizations' ? 'public/rules/state-organizations.json' : `public/laws/${id}.json`), 'utf8'));
    updates.push({ id, previous: snapshot, next: snapshot });
  }
  for (const [path, data] of await historyFiles(root, updates)) await writeFile(path, JSON.stringify(data, null, 2) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await initializeHistory();

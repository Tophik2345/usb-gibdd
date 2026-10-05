import type { LawText } from './law-search';
import initial from './law-documents.json';
import sources from './law-sources.json';
export const lawCache = new Map<string, LawText>();
const pending = new Map<string, Promise<LawText>>();
const fetchedAt = new Map<string, number>();
export const lawRefreshInterval = 5 * 60_000;
export type LawDocument = (typeof initial)[number];
let manifest = initial;
let manifestFetchedAt = 0;
let manifestPending: Promise<LawDocument[]> | null = null;

export function loadLawManifest(): Promise<LawDocument[]> {
  if (manifestFetchedAt && Date.now() - manifestFetchedAt < lawRefreshInterval) return Promise.resolve(manifest);
  if (manifestPending) return manifestPending;
  manifestPending = fetch(`${import.meta.env.BASE_URL}laws/manifest.json`, { cache: 'no-cache', signal: AbortSignal.timeout(15000) }).then(async response => {
    if (!response.ok) throw new Error('Не удалось проверить обновления законов.');
    const data = await response.json();
    if (!Array.isArray(data.documents) || data.documents.length !== sources.length ||
        new Set(data.documents.map((doc: LawDocument) => doc.id)).size !== sources.length ||
        !data.documents.every((doc: LawDocument) => {
          const source = sources.find(item => item.id === doc.id);
          return source && doc.sourceUrl === source.sourceUrl && doc.sourcePost === source.sourcePost &&
            typeof doc.title === 'string' && typeof doc.shortTitle === 'string' && Array.isArray(doc.editorialNotes) &&
            Number.isInteger(doc.articleCount) && doc.articleCount >= source.minimumArticles &&
            Number.isFinite(Date.parse(doc.checkedAt)) && /^[a-f0-9]{64}$/.test(doc.contentHash);
        })) throw new Error('Некорректный список документов.');
    manifest = data.documents; manifestFetchedAt = Date.now(); return manifest;
  }).finally(() => { manifestPending = null; });
  return manifestPending;
}

export function loadDocument(id: string): Promise<LawText> {
  const source = sources.find(item => item.id === id);
  if (!source) return Promise.reject(new Error('Документ не найден.'));
  if (lawCache.has(id) && Date.now() - (fetchedAt.get(id) || 0) < lawRefreshInterval) return Promise.resolve(lawCache.get(id)!);
  if (pending.has(id)) return pending.get(id)!;
  const request = fetch(`${import.meta.env.BASE_URL}laws/${id}.json`, { cache: 'no-cache', signal: AbortSignal.timeout(15000) }).then(r => {
    if (!r.ok) throw new Error('Не удалось загрузить документ.');
    return r.json();
  }).then((data: LawText) => {
    if (data.id !== id || typeof data.title !== 'string' || !Array.isArray(data.entries) || !data.entries.length ||
        new Set(data.entries.map(entry => entry.id)).size !== data.entries.length ||
        !data.entries.every(entry => typeof entry.id === 'string' && ['article','section','introduction'].includes(entry.kind) &&
          typeof entry.title === 'string' && typeof entry.chapter === 'string' && Array.isArray(entry.paragraphs) && entry.paragraphs.every(text => typeof text === 'string')) ||
        data.entries.filter(entry => entry.kind === 'article').length < source.minimumArticles ||
        (data.checkedAt && (data.sourceUrl !== source.sourceUrl || data.sourcePost !== source.sourcePost ||
          !Number.isFinite(Date.parse(data.checkedAt)) || !/^[a-f0-9]{64}$/.test(data.contentHash || '')))) throw new Error('Некорректный документ.');
    lawCache.set(id, data); fetchedAt.set(id, Date.now()); return data;
  }).catch(error => { if (lawCache.has(id)) return lawCache.get(id)!; throw error; }).finally(() => pending.delete(id));
  pending.set(id, request); return request;
}

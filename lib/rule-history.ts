import { useEffect, useState } from 'react';
import sources from './law-sources.json';
import initial from '../public/rule-history/index.json';
import type { LawEntry } from './law-search';

export type RuleRevision = { id: string; document: string; title: string; sourceUrl: string; sourceEditedAt: string | null; detectedAt: string; beforeHash: string; afterHash: string; added: number; changed: number; removed: number };
export type RuleChange = { id: string; type: 'added' | 'changed' | 'removed'; before: Omit<LawEntry, 'page'> | null; after: Omit<LawEntry, 'page'> | null };
export type RuleRevisionDetail = RuleRevision & { changes: RuleChange[] };
export type RuleHistory = { version: number; startedAt: string; documents: { id: string; title: string; sourceUrl: string; baselineHash: string }[]; revisions: RuleRevision[] };
const officialSources = [...sources, { id: 'state-organizations', sourceUrl: 'https://forum.russia.online/threads/pravila-gosudarstvennykh-organizatsii.11/' }];
const validHash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const validRevision = (value: RuleRevision) => {
  const source = officialSources.find(source => source.id === value?.document);
  return !!source && value.sourceUrl === source.sourceUrl && new RegExp('^' + value.document + '-[a-f0-9]{24}$').test(value.id) &&
    typeof value.title === 'string' && value.title.length <= 500 && Number.isFinite(Date.parse(value.detectedAt)) &&
    (value.sourceEditedAt === null || Number.isFinite(Date.parse(value.sourceEditedAt))) && validHash(value.beforeHash) && validHash(value.afterHash) &&
    [value.added, value.changed, value.removed].every(count => Number.isInteger(count) && count >= 0 && count <= 5000) && value.added + value.changed + value.removed > 0;
};
export function validHistory(value: RuleHistory): boolean {
  return value?.version === 1 && Number.isFinite(Date.parse(value.startedAt)) && Array.isArray(value.documents) && value.documents.length === 9 &&
    new Set(value.documents.map(doc => doc.id)).size === 9 && value.documents.every(doc => officialSources.some(source => source.id === doc.id && source.sourceUrl === doc.sourceUrl) && typeof doc.title === 'string' && validHash(doc.baselineHash)) &&
    Array.isArray(value.revisions) && new Set(value.revisions.map(revision => revision.id)).size === value.revisions.length && value.revisions.every(validRevision);
}
const validEntry = (entry: RuleChange['before']) => entry === null || !!entry && typeof entry.id === 'string' && ['article', 'section', 'introduction'].includes(entry.kind) && typeof entry.title === 'string' && typeof entry.chapter === 'string' && Array.isArray(entry.paragraphs) && entry.paragraphs.every(text => typeof text === 'string');
let cache: RuleHistory = initial as RuleHistory, fetchedAt = 0, pending: Promise<RuleHistory> | null = null;
export async function loadRuleHistory(): Promise<RuleHistory> {
  if (fetchedAt && Date.now() - fetchedAt < 300_000) return cache;
  if (pending) return pending;
  pending = fetch(`${import.meta.env.BASE_URL}rule-history/index.json`, { cache: 'no-cache', signal: AbortSignal.timeout(15000) }).then(async response => {
    if (!response.ok) throw new Error('Не удалось проверить историю изменений.');
    const next = await response.json();
    if (!validHistory(next)) throw new Error('Не удалось проверить историю изменений.');
    cache = next; fetchedAt = Date.now(); return cache;
  }).finally(() => { pending = null; });
  return pending;
}
export async function loadRevision(revision: RuleRevision): Promise<RuleRevisionDetail> {
  if (!validRevision(revision)) throw new Error('Редакция не найдена.');
  const response = await fetch(`${import.meta.env.BASE_URL}rule-history/${revision.id}.json`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Не удалось загрузить сравнение.');
  const next: RuleRevisionDetail = await response.json();
  if (!validRevision(next) || ['id', 'document', 'beforeHash', 'afterHash', 'detectedAt'].some(key => next[key as keyof RuleRevision] !== revision[key as keyof RuleRevision]) ||
    !Array.isArray(next.changes) || next.changes.length !== revision.added + revision.changed + revision.removed ||
    new Set(next.changes.map(change => change.id)).size !== next.changes.length ||
    !next.changes.every(change => validEntry(change.before) && validEntry(change.after) && (change.before === null || change.before.id === change.id) && (change.after === null || change.after.id === change.id) &&
      (change.type === 'added' ? change.before === null && change.after !== null : change.type === 'removed' ? change.before !== null && change.after === null : change.type === 'changed' && change.before !== null && change.after !== null))) throw new Error('Некорректное сравнение редакций.');
  return next;
}
export function useRuleHistory() {
  const [history, setHistory] = useState(cache), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const update = () => { void loadRuleHistory().then(next => { if (active) { setHistory(next); setError(''); } }).catch(() => { if (active) setError('История сейчас недоступна. Показаны последние сохранённые данные.'); }); };
    update(); const timer = window.setInterval(update, 300_000);
    const visible = () => { if (!document.hidden) update(); };
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [retry]);
  return { history, error, refresh: () => { fetchedAt = 0; setRetry(value => value + 1); } };
}
export const ruleChangesSummary = (revision: RuleRevision) => `Изменено: ${revision.changed}, добавлено: ${revision.added}, удалено: ${revision.removed}.`;

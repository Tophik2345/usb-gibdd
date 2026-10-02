import type { LawText } from './law-search';
export const lawCache = new Map<string, LawText>();
const pending = new Map<string, Promise<LawText>>();
export function loadDocument(id: string): Promise<LawText> {
  if (lawCache.has(id)) return Promise.resolve(lawCache.get(id)!);
  if (pending.has(id)) return pending.get(id)!;
  const request = fetch(`${import.meta.env.BASE_URL}laws/${id}.json`).then(r => {
    if (!r.ok) throw new Error('Не удалось загрузить документ.');
    return r.json();
  }).then((data: LawText) => {
    if (data.id !== id || !Array.isArray(data.entries)) throw new Error('Некорректный документ.');
    lawCache.set(id, data); return data;
  }).finally(() => pending.delete(id));
  pending.set(id, request); return request;
}

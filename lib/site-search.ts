import { accountRpc } from './account-session';
import { WorkspaceError } from './workspace-api';
import { normalizeLawText, matchesLaw, lawExcerpt, type LawText } from './law-search';
import documents from './law-documents.json';
import { newcomerCards, dutyCards } from './employee-guides';
import { roadCards, projectRuleCards, gameplayCards } from './road-guides';
import { searchWords } from './search-words';

export type SearchKind = 'test' | 'law' | 'material';
export type SearchItem = { id: string; kind: SearchKind; title: string; summary: string; source: string; targetId?: string; href?: string };
export type SearchCursor = { title: string; id: string };
export type SearchPage = { items: SearchItem[]; total: number; nextCursor: SearchCursor | null };
export async function searchApi<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await accountRpc('knowledge_search', payload, true);
  if (error) {
    if (/^PT4\d\d$/.test(error.code)) throw new WorkspaceError(error.message, Number(error.code.slice(2)));
    throw new WorkspaceError('Не удалось загрузить тесты и материалы подготовки. Повторите поиск.');
  }
  return data as T;
}
const includesWords = (text: string, query: string) => searchWords(query).every(word => normalizeLawText(text).includes(word));
export function searchLaws(laws: LawText[], query: string): SearchItem[] {
  const numbered = /^(?:(?:статья|ст\.?|пункт|п\.?)\s*)?\d+(?:\.\d+)*\.?$/u.test(normalizeLawText(query));
  return laws.flatMap(doc => doc.entries.filter(e => e.kind === 'article' && (numbered ? matchesLaw(e, query) : includesWords([e.title,...e.paragraphs].join(' '), query)))
    .map(entry => ({ id: `law:${doc.id}:${entry.id}`, kind: 'law' as const, title: entry.title, source: documents.find(d => d.id === doc.id)?.shortTitle || doc.title,
      summary: lawExcerpt(entry, query), href: `#laws?document=${encodeURIComponent(doc.id)}&article=${encodeURIComponent(entry.id)}` })));
}
export function searchGuides(query: string): SearchItem[] {
  const groups = [
    { cards: [...newcomerCards,...roadCards], page: 'new-employees', prefix: 'newcomer-card', source: 'Памятка нового сотрудника' },
    { cards: dutyCards, page: 'duties', prefix: 'duties-card', source: 'Обязанности УСБ' },
    { cards: projectRuleCards, page: 'new-employees', prefix: 'guide-project', source: 'Правила проекта' },
    { cards: gameplayCards, page: 'new-employees', prefix: 'guide-gameplay', source: 'Практика в игре' },
  ];
  return groups.flatMap(group => group.cards.flatMap((card, index) => {
    const text = [card.title,...card.items].join(' ');
    if (!includesWords(text, query)) return [];
    const paragraph = card.items.find(item => includesWords(item, query)) || card.items[0] || '';
    const id = `${group.prefix}-${index + 1}`;
    return [{ id: `guide:${id}`, kind: 'material' as const, title: card.title, source: group.source, summary: paragraph.slice(0,280), href: `#${group.page}?topic=${id}` }];
  }));
}

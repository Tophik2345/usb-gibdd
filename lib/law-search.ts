export type LawEntry = { id: string; kind: 'section'|'article'|'introduction'; title: string; chapter: string; page: number; paragraphs: string[] };
export type LawText = { id: string; title: string; entries: LawEntry[] };
export const normalizeLawText = (text: string) => text.toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/\s+/g,' ').trim();
export function matchesLaw(entry: LawEntry, query: string): boolean {
  const needle = normalizeLawText(query);
  if (!needle) return true;
  const number = needle.match(/^(?:ст(?:атья|\.)?\s*)?(\d+(?:\.\d+)*?)\.?$/u)?.[1];
  if (number) return normalizeLawText(entry.title).match(/^статья\s+(\d+(?:\.\d+)*)/u)?.[1] === number;
  return normalizeLawText([entry.title,...entry.paragraphs].join(' ')).includes(needle);
}
export function lawExcerpt(entry: LawEntry, query: string): string {
  const needle = normalizeLawText(query);
  const paragraph = entry.paragraphs.find(text => needle && normalizeLawText(text).includes(needle)) || entry.paragraphs[0] || entry.chapter;
  const text = paragraph.replace(/\s+/g,' ').trim();
  const index = normalizeLawText(text).indexOf(needle);
  const start = index > 80 ? index - 60 : 0;
  return (start ? '…' : '') + text.slice(start,start+280) + (text.length>start+280?'…':'');
}

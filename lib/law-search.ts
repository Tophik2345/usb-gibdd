export type LawEntry = { id: string; kind: 'section'|'article'|'introduction'; title: string; chapter: string; page: number; paragraphs: string[] };
export type LawText = { id: string; title: string; entries: LawEntry[]; checkedAt?: string; sourceUrl?: string; sourcePost?: string; sourceEditedAt?: string | null; contentHash?: string };
export const normalizeLawText = (text: string) => text.toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/\s+/g,' ').trim();
export function matchesLaw(entry: LawEntry, query: string): boolean {
  const needle = normalizeLawText(query);
  if (!needle) return true;
  const number = needle.match(/^(?:(статья|ст\.?|пункт|п\.?)\s*)?(\d+(?:\.\d+)*)\.?$/u);
  if (number) {
    const heading = normalizeLawText(entry.title).match(/^(статья|пункт)\s+(\d+(?:\.\d+)*)/u);
    const kind = number[1]?.startsWith('ст') ? 'статья' : number[1] ? 'пункт' : undefined;
    return heading?.[2] === number[2] && (!kind || heading?.[1] === kind);
  }
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

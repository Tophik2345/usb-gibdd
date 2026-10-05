export type QuestionReference = { document: string; article: string; href: string };
export function splitExplanation(text: string): { text: string; reference: QuestionReference | null } {
  const match = text.match(/(?:^|\n)Открыть статью: (#laws\?document=(charter|criminal|labour|procedure|police|traffic-police|administrative|traffic-rules)&article=(article-[1-9]\d*))\s*$/);
  return { text: match ? text.slice(0, match.index).trimEnd() : text, reference: match ? { href: match[1], document: match[2], article: match[3] } : null };
}
export function joinExplanation(text: string, reference: QuestionReference | null): string {
  return text.trimEnd() + (reference ? '\nОткрыть статью: ' + reference.href : '');
}

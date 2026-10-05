import { useEffect, useState } from 'react';
import initial from './project-rule-cards.json';

export type ProjectRules = {
  title: string; sourceUrl: string; sourcePost: string; sourceEditedAt: string | null;
  checkedAt: string; contentHash: string; lines: string[];
  points: { number: string; paragraphs: string[] }[];
};
let cached: ProjectRules | null = null;
let fetchedAt = 0;
let pending: Promise<ProjectRules> | null = null;
const interval = 5 * 60_000;

export function currentRuleCards(rules: ProjectRules | null) {
  if (!rules) return initial.cards;
  return initial.cards.map(card => ({ ...card,
    items: card.points.flatMap(number => rules.points.find(point => point.number === number)!.paragraphs),
  }));
}

export function loadProjectRules() {
  if (cached && Date.now() - fetchedAt < interval) return Promise.resolve(cached);
  if (pending) return pending;
  pending = fetch(`${import.meta.env.BASE_URL}rules/state-organizations.json`, { cache: 'no-cache', signal: AbortSignal.timeout(15000) })
    .then(async response => {
      if (!response.ok) throw new Error('Не удалось проверить обновления правил. Показана последняя сохранённая редакция.');
      const data: ProjectRules = await response.json();
      if (data.sourceUrl !== initial.sourceUrl || data.sourcePost !== 'post-11' || !Number.isFinite(Date.parse(data.checkedAt)) ||
        !Array.isArray(data.lines) || !data.lines.length || !data.lines.every(line => typeof line === 'string') ||
        typeof data.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.contentHash) ||
        !Array.isArray(data.points) || data.points.length < 80 || new Set(data.points.map(p => p.number)).size !== data.points.length ||
        !data.points.every(point => typeof point.number === 'string' && Array.isArray(point.paragraphs) && point.paragraphs.length > 0 && point.paragraphs.every(p => typeof p === 'string')) ||
        !initial.cards.every(card => card.points.every(number => data.points.some(point => point.number === number)))) {
        throw new Error('Получен неполный текст правил. Показана последняя сохранённая редакция.');
      }
      cached = data; fetchedAt = Date.now(); return data;
    }).finally(() => { pending = null; });
  return pending;
}

export function useProjectRules() {
  const [rules, setRules] = useState(cached);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const update = () => loadProjectRules().then(data => { if (active) { setRules(data); setError(''); } })
      .catch(() => { if (active) setError('Обновления сейчас проверить не удалось. Показана последняя сохранённая редакция.'); });
    void update();
    const timer = window.setInterval(() => { void update(); }, interval);
    const visible = () => { if (document.visibilityState === 'visible') void update(); };
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, []);
  return { rules, cards: currentRuleCards(rules), error, source: rules || initial };
}

import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { historyFiles } from './rule-history.mjs';

export const sourceUrl = 'https://forum.russia.online/threads/pravila-gosudarstvennykh-organizatsii.11/';
const sourcePost = 'post-11';
const topics = [
  { title: 'Запись и запрос администрации', points: ['7.4'] },
  { title: 'Разъяснение прав', points: ['1.8'] },
  { title: 'Идентификация сотрудника', points: ['1.21', '1.21.1', '1.21.2'] },
  { title: 'Пределы компетенции', points: ['10.5', '2.7'] },
];
const clean = text => text.replace(/[\u200b\ufeff]/g, '').replace(/\s+/g, ' ').trim();

export function parseRules(html) {
  const $ = load(html);
  const post = $(`article.message[data-content="${sourcePost}"]`);
  const body = post.find('.message-body .bbWrapper').first();
  if (post.length !== 1 || !body.length) throw new Error('Официальное сообщение с правилами не найдено. Предыдущая редакция сохранена.');
  const headings = new Set(body.find('div[style*="text-align: center"]').map((_, el) => clean($(el).text())).get().filter(Boolean));
  body.find('script, style, button, iframe').remove();
  body.find('img').each((_, el) => {
    const image = $(el);
    if (image.hasClass('smilie') || image.hasClass('emoji')) image.replaceWith(image.attr('alt') || '');
    else image.replaceWith(` Иллюстрация: ${image.attr('alt') || ''} ${image.attr('data-src') || image.attr('src') || ''} `);
  });
  body.find('br').replaceWith('\n');
  body.find('div,p,li,ul,ol,h1,h2,h3,h4,table,tr,blockquote').each((_, el) => { $(el).prepend('\n').append('\n'); });
  const lines = body.text().split(/\r?\n/).map(clean).filter(Boolean);
  const points = [];
  let current = null;
  for (const line of lines) {
    if (headings.has(line)) { current = null; continue; }
    const number = line.match(/^(\d+\.\d+(?:\.\d+)*)(?:\.|\s)+\S/u)?.[1];
    if (number) { current = { number, paragraphs: [line] }; points.push(current); }
    else if (current) current.paragraphs.push(line);
  }
  if (points.length < 80 || lines.join(' ').length < 15000) throw new Error('Получен неполный текст правил. Предыдущая редакция сохранена.');
  if (new Set(points.map(p => p.number)).size !== points.length) throw new Error('Повторяющиеся номера пунктов требуют проверки источника.');
  for (const number of topics.flatMap(t => t.points)) {
    if (!points.some(p => p.number === number)) throw new Error(`В источнике не найден пункт ${number}. Предыдущая редакция сохранена.`);
  }
  const sourceEditedAt = post.find('.message-lastEdit time').attr('datetime') || null;
  if (sourceEditedAt && !Number.isFinite(Date.parse(sourceEditedAt))) throw new Error('Некорректная дата редакции источника.');
  return { title: 'Правила государственных организаций', sourceUrl, sourcePost, sourceEditedAt,
    contentHash: createHash('sha256').update(JSON.stringify(lines)).digest('hex'), points, lines };
}

export function checkChange(previous, next) {
  if (!previous) return;
  if (next.lines.join(' ').length < previous.lines.join(' ').length * 0.75 || next.points.length < previous.points.length * 0.8) {
    throw new Error('Источник резко сократился. Предыдущая редакция сохранена до проверки.');
  }
}

export function ruleCards(snapshot) {
  return { checkedAt: snapshot.checkedAt, sourceEditedAt: snapshot.sourceEditedAt, sourceUrl,
    contentHash: snapshot.contentHash,
    cards: topics.map(topic => ({ ...topic,
      items: topic.points.flatMap(number => snapshot.points.find(point => point.number === number).paragraphs),
      reference: `Правила госорганизаций, ${topic.points.length === 1 ? 'пункт' : 'пункты'} ${topic.points.join(', ')}.`,
    })) };
}

export async function syncRules(root = resolve(import.meta.dirname, '..')) {
  const response = await fetch(sourceUrl, { headers: { 'User-Agent': 'USB-GIBDD rules updater (public official forum)' },
    redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Источник правил недоступен (HTTP ${response.status}). Предыдущая редакция сохранена.`);
  if (!response.headers.get('content-type')?.includes('text/html')) throw new Error('Источник вернул неожиданный тип данных.');
  const html = await response.text();
  if (html.length > 2000000) throw new Error('Неожиданно большой ответ источника.');
  const snapshot = { ...parseRules(html), checkedAt: new Date().toISOString() };
  const path = resolve(root, 'public/rules/state-organizations.json');
  let previous;
  try { previous = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  checkChange(previous, snapshot);
  const cards = ruleCards(snapshot);
  await mkdir(resolve(root, 'public/rules'), { recursive: true });
  const files = [[path, snapshot], [resolve(root, 'lib/project-rule-cards.json'), cards],
    ...await historyFiles(root, [{ id: 'state-organizations', previous: previous || snapshot, next: snapshot }])];
  for (const [file, data] of files) {
    await writeFile(file + '.tmp', JSON.stringify(data, null, 2) + '\n');
  }
  for (const [file] of files) await rename(file + '.tmp', file);
  console.log(JSON.stringify({ sourceUrl, points: snapshot.points.length, checkedAt: snapshot.checkedAt,
    contentChanged: previous?.contentHash !== snapshot.contentHash }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  syncRules().catch(error => { console.error(error.message); process.exitCode = 1; });
}

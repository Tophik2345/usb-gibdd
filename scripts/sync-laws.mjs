import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { officialUrl } from './collect-forum-sources.mjs';

const clean = value => value.replace(/[\u200b\ufeff]/g, '').replace(/\s+/g, ' ').trim();
const normalized = value => clean(value).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
const articleNumber = title => title.match(/^(?:Статья|Пункт)\s+(\d+(?:\.\d+)*)/iu)?.[1];
const chapterNumber = title => normalized(title).match(/^глава\s+([ivxlcdm]+|\d+)(?:[.\s]|$)/u)?.[1] || '';
const sectionKey = title => normalized(title).match(/^(глава|раздел)\s+([ivxlcdm]+|\d+)(?:[.\s]|$)/u)?.slice(1).join(':') || normalized(title);
const entryKey = (id, entry) => entry.kind === 'article'
  ? `article:${id === 'procedure' ? chapterNumber(entry.chapter) + ':' : ''}${articleNumber(entry.title)}`
  : `${entry.kind}:${sectionKey(entry.title)}`;
const textLength = doc => doc.entries.reduce((n, entry) => n + entry.title.length + entry.paragraphs.join(' ').length, 0);
const roadPoint = (line, chapter) => {
  const match = line.match(/^(?:Пункт\s+)?(\d+\.\d+(?:\.\d+)*)(?:\.\s*|\s+|$)(.*)$/iu);
  const number = match?.[1];
  if (!number || number.split('.')[0] !== chapter.match(/^(\d+)\./u)?.[1] || /^\d{1,2}\.\d{1,2}\.\d{4}$/u.test(number)) return null;
  return { title: `Пункт ${number}.`, text: match[2] };
};

export function bodyLines(html) {
  const $ = load(html);
  $('script, style, iframe, button, input, form').remove();
  $('img').each((_, el) => {
    const image = $(el);
    image.replaceWith(image.hasClass('smilie') || image.hasClass('emoji') ? image.attr('alt') || '' : '');
  });
  $('br').replaceWith('\n');
  $('div,p,li,ul,ol,h1,h2,h3,h4,table,tr,blockquote').each((_, el) => { $(el).prepend('\n').append('\n'); });
  return $.root().text().split(/\r?\n/).map(clean).filter(Boolean);
}

export function parseLawBody(body, config, previous, sourceEditedAt = null) {
  const lines = bodyLines(body);
  const entries = [];
  let chapter = '', current;
  const begin = (kind, title) => {
    if (kind === 'section' && /^(?:глава|\d+\.)/iu.test(title)) chapter = title;
    current = { kind, title, chapter, page: 0, paragraphs: [] };
    entries.push(current);
  };
  for (const line of lines) {
    const point = config.id === 'traffic-rules' ? roadPoint(line, chapter) : null;
    if (/^(?:Глава|Раздел)\s+(?:[IVXLCDM]+|\d+)(?:[.\s]|$)/iu.test(line) || /^(?:ОБЩАЯ|ОСОБЕННАЯ) ЧАСТЬ$/iu.test(line) ||
        (config.id === 'traffic-rules' && /^\d+\.\s+\S/u.test(line))) {
      begin('section', line);
    } else if (/^Статья\s+\d+(?:\.\d+)*(?:[.\s]|$)/iu.test(line)) {
      begin('article', line);
    } else if (point) {
      begin('article', point.title);
      if (point.text) current.paragraphs.push(point.text);
    } else {
      if (!current) begin('introduction', '');
      current.paragraphs.push(line);
    }
  }
  const articles = entries.filter(entry => entry.kind === 'article');
  if (articles.length < config.minimumArticles || lines.join(' ').length < config.minimumTextLength ||
      !entries.some(entry => entry.kind === 'section') || articles.some(entry => !articleNumber(entry.title) || (config.id === 'procedure' && !chapterNumber(entry.chapter)))) {
    throw new Error(`Получен неполный документ ${config.id}; предыдущая редакция сохранена.`);
  }
  if (new Set(articles.map(entry => entryKey(config.id, entry))).size !== articles.length) throw new Error(`Повторяющиеся номера статей в ${config.id} требуют проверки.`);
  const registry = { ...(previous.entryIds || {}) };
  for (const entry of previous.entries) registry[entryKey(config.id, entry)] ||= entry.id;
  let nextEntryId = Math.max(previous.nextEntryId || 0, ...Object.values(registry).map(id => Number(id.match(/-(\d+)$/)?.[1] || 0)));
  for (const entry of entries) {
    const key = entryKey(config.id, entry);
    entry.id = registry[key] ||= `${entry.kind}-${++nextEntryId}`;
  }
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('Повторяющиеся ссылки документа.');
  const doc = { id: config.id, title: previous.title, entries, entryIds: registry, nextEntryId,
    sourceUrl: config.sourceUrl, sourcePost: config.sourcePost, sourceEditedAt,
    contentHash: createHash('sha256').update(JSON.stringify(entries)).digest('hex') };
  if (articles.length < previous.entries.filter(entry => entry.kind === 'article').length * 0.8 || textLength(doc) < textLength(previous) * 0.75) {
    throw new Error(`Текст ${config.id} резко сократился; предыдущая редакция сохранена.`);
  }
  return doc;
}

export function parseLaw(html, config, previous) {
  const $ = load(html);
  if (!normalized($('title').first().text()).includes(normalized(config.titleMatch))) throw new Error('Неожиданный документ источника.');
  const post = $(`article.message[data-content="${config.sourcePost}"]`);
  const body = post.find('.message-body .bbWrapper').first();
  if (post.length !== 1 || !body.length) throw new Error('Закреплённое официальное сообщение не найдено.');
  const edited = post.find('.message-lastEdit time').attr('datetime') || null;
  if (edited && !Number.isFinite(Date.parse(edited))) throw new Error('Некорректная дата источника.');
  return parseLawBody(body.html(), config, previous, edited);
}

export async function syncLaws(root = resolve(import.meta.dirname, '..'), request = fetch, cookie = process.env.FORUM_COOKIE) {
  if (!cookie?.trim() || /[\x00-\x1f\x7f]/.test(cookie) || cookie.length > 32000) throw new Error('Добавьте корректный FORUM_COOKIE в секреты GitHub Actions.');
  const agent = process.env.FORUM_USER_AGENT || 'Mozilla/5.0';
  if (/[\x00-\x1f\x7f]/.test(agent)) throw new Error('Некорректный User-Agent.');
  const configs = JSON.parse(await readFile(resolve(root, 'lib/law-sources.json'), 'utf8'));
  const metadata = JSON.parse(await readFile(resolve(root, 'lib/law-documents.json'), 'utf8'));
  if (configs.length !== 8 || metadata.length !== 8 || new Set(configs.map(c => c.id)).size !== 8) throw new Error('Не все источники настроены.');
  const snapshots = [];
  const formats = new Map();
  const checkedAt = new Date().toISOString();
  for (const config of configs) {
    officialUrl(config.sourceUrl);
    if (!/^post-\d+$/.test(config.sourcePost)) throw new Error('Не задано официальное сообщение документа.');
    let response;
    try { response = await request(config.sourceUrl, { headers: { Cookie: cookie.trim(), 'User-Agent': agent }, redirect: 'error', signal: AbortSignal.timeout(30000) }); }
    catch { throw new Error(`Не удалось загрузить ${config.id}; предыдущие редакции сохранены.`); }
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error(`Источник ${config.id} недоступен (HTTP ${response.status}).`);
    const html = await response.text();
    if (html.length > 2000000) throw new Error('Ответ источника слишком большой.');
    const path = resolve(root, `public/laws/${config.id}.json`);
    const previousText = await readFile(path, 'utf8');
    formats.set(path, /\n\s+"/u.test(previousText) ? 2 : undefined);
    const previous = JSON.parse(previousText);
    snapshots.push({ ...parseLaw(html, config, previous), checkedAt });
  }
  const nextMeta = metadata.map(meta => {
    const doc = snapshots.find(snapshot => snapshot.id === meta.id);
    if (!doc) throw new Error('Не найден документ библиотеки.');
    return { ...meta, articleCount: doc.entries.filter(entry => entry.kind === 'article').length,
      sourceUrl: doc.sourceUrl, sourcePost: doc.sourcePost, sourceEditedAt: doc.sourceEditedAt, checkedAt, contentHash: doc.contentHash };
  });
  // No file is written until all eight official messages have passed validation.
  const files = [...snapshots.map(doc => [resolve(root, `public/laws/${doc.id}.json`), doc]),
    [resolve(root, 'lib/law-documents.json'), nextMeta], [resolve(root, 'public/laws/manifest.json'), { checkedAt, documents: nextMeta }]];
  for (const [path, data] of files) await writeFile(path + '.tmp', JSON.stringify(data, null, formats.has(path) ? formats.get(path) : 2) + '\n');
  for (const [path] of files) await rename(path + '.tmp', path);
  console.log(JSON.stringify({ checkedAt, documents: snapshots.length, articles: nextMeta.reduce((n, meta) => n + meta.articleCount, 0) }));
  return snapshots;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  syncLaws().catch(() => { console.error('Обновление законов не выполнено. Проверьте сессию и полноту официальных источников; предыдущие редакции сохранены.'); process.exitCode = 1; });
}

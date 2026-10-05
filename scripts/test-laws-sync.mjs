import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLawBody, parseLaw, syncLaws } from './sync-laws.mjs';

const config = { id: 'procedure', sourceUrl: 'https://forum.russia.online/threads/law.1/', sourcePost: 'post-1', titleMatch: 'Процессуальный кодекс', minimumArticles: 2, minimumTextLength: 20 };
const old = { id: 'procedure', title: 'Кодекс', entries: [
  { id: 'section-1', kind: 'section', title: 'Глава I. Первая', chapter: 'Глава I. Первая', page: 1, paragraphs: [] },
  { id: 'article-2', kind: 'article', title: 'Статья 1. Первое правило', chapter: 'Глава I. Первая', page: 1, paragraphs: ['Норма первой главы.'] },
  { id: 'section-3', kind: 'section', title: 'Глава II. Вторая', chapter: 'Глава II. Вторая', page: 2, paragraphs: [] },
  { id: 'article-4', kind: 'article', title: 'Статья 1. Второе правило', chapter: 'Глава II. Вторая', page: 2, paragraphs: ['Норма второй главы.'] },
] };
const html = '<div>Глава I. Первая</div><b>Статья 1. Первое правило</b><br>Обновлённая норма первой главы.<br>Примечание: исключение сохраняется.<br>Статья 1.1. Новая норма<br>Порядок её применения.<div>Глава II. Вторая</div>Статья 1. Второе правило<br>Норма второй главы.';

await test('article numbers that repeat by chapter retain distinct IDs and new articles do not shift existing links', () => {
  const next = parseLawBody(html, config, old);
  const articles = next.entries.filter(entry => entry.kind === 'article');
  assert.equal(articles.length, 3);
  assert.equal(articles[0].id, 'article-2'); assert.equal(articles[2].id, 'article-4');
  assert.equal(articles[1].id, 'article-5');
  assert(articles[0].paragraphs.includes('Примечание: исключение сохраняется.'));
  const again = parseLawBody(html.replace('Первое правило', 'Новый заголовок'), config, next);
  assert.deepEqual(again.entries.map(entry => entry.id), next.entries.map(entry => entry.id));
});

await test('duplicate numbers, missing chapters and truncated documents preserve the previous edition', () => {
  assert.throws(() => parseLawBody(html.replace('Статья 1.1.', 'Статья 1.'), config, old));
  assert.throws(() => parseLawBody('Статья 1. Норма<br>Статья 2. Норма', config, old));
  assert.throws(() => parseLawBody('<div>Глава I. Первая</div>Статья 1. Норма', config, old));
  assert.throws(() => parseLaw('<title>Вход | Форум</title><form>Войти</form>', config, old));
  assert.throws(() => parseLaw('<title>Процессуальный кодекс</title><article class="message" data-content="post-2"><div class="message-body"><div class="bbWrapper">' + html + '</div></div></article>', config, old));
});

await test('only the pinned official message contributes text; comments and page tokens are excluded', () => {
  const full = '<title>Процессуальный кодекс</title><input value="private-page-token"><article class="message" data-content="post-1"><div class="message-body"><div class="bbWrapper">' + html + '</div></div></article><article class="message" data-content="post-2"><div class="message-body"><div class="bbWrapper">Статья 99. Комментарий</div></div></article>';
  const next = parseLaw(full, config, old);
  assert.equal(next.entries.filter(entry => entry.kind === 'article').length, 3);
  assert(!JSON.stringify(next).includes('private-page-token'));
  assert(!JSON.stringify(next).includes('Комментарий'));
});

await test('PDD points and chapter numbers are separate and exact point references remain stable', () => {
  const roadConfig = { ...config, id: 'traffic-rules' };
  const roadOld = { id: 'traffic-rules', title: 'ПДД', entries: [{ id: 'section-1', kind: 'section', title: '8. Скорость', chapter: '8. Скорость', page: 1, paragraphs: [] }, { id: 'article-2', kind: 'article', title: 'Пункт 8.1. Скорость', chapter: '8. Скорость', page: 1, paragraphs: ['Учитывайте обстановку.'] }, { id: 'article-3', kind: 'article', title: 'Пункт 8.2. Ограничение', chapter: '8. Скорость', page: 1, paragraphs: [] }] };
  const next = parseLawBody('8. Скорость<br>Пункт 8.1. Скорость<br>Учитывайте обстановку.<br>8.2. Ограничение<br>Подписано<br>08.09.2026 Автор', roadConfig, roadOld);
  assert.deepEqual(next.entries.filter(entry => entry.kind === 'article').map(entry => entry.id), ['article-2', 'article-3']);
  assert(next.entries.at(-1).paragraphs.includes('08.09.2026 Автор'));
});

await test('a failed source leaves every document and metadata file unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'law-sync-'));
  try {
    await mkdir(join(root, 'lib')); await mkdir(join(root, 'public/laws'), { recursive: true });
    const ids = ['charter','criminal','labour','procedure','police','traffic-police','administrative','traffic-rules'];
    const configs = ids.map(id => ({ ...config, id }));
    const metadata = ids.map(id => ({ id, articleCount: 2 }));
    await writeFile(join(root, 'lib/law-sources.json'), JSON.stringify(configs));
    await writeFile(join(root, 'lib/law-documents.json'), JSON.stringify(metadata));
    for (const id of ids) await writeFile(join(root, `public/laws/${id}.json`), JSON.stringify({ ...old, id }));
    const before = await readFile(join(root, 'public/laws/charter.json'), 'utf8');
    let calls = 0;
    await assert.rejects(syncLaws(root, async (url, options) => {
      assert.equal(options.redirect, 'error'); assert.equal(options.headers.Cookie, 'xf_session=local-test');
      if (++calls === 2) return new Response('Denied', { status: 403 });
      return new Response('<title>Процессуальный кодекс</title><article class="message" data-content="post-1"><div class="message-body"><div class="bbWrapper">' + html + '</div></div></article>', { headers: { 'content-type': 'text/html' } });
    }, 'xf_session=local-test'));
    assert.equal(await readFile(join(root, 'public/laws/charter.json'), 'utf8'), before);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'lib/law-documents.json'), 'utf8')), metadata);
  } finally { await rm(root, { recursive: true, force: true }); }
});

import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseRules, checkChange, ruleCards, syncRules, sourceUrl } from './sync-project-rules.mjs';

function fixture() {
  const numbers = [...Array.from({ length: 90 }, (_, i) => `3.${i + 1}`), '7.4', '1.8', '1.21', '1.21.1', '1.21.2', '10.5', '2.7'];
  const text = 'Проверяйте основание и соблюдайте предусмотренный порядок. '.repeat(5);
  return `<article class="message" data-content="post-11"><div class="message-body"><div class="bbWrapper"><div style="text-align: center">Общее положение</div>${numbers.map(number => `<span>${number.slice(0, 2)}</span><span>${number.slice(2)} ${text}</span><br>Примечание: исходное примечание.<br>Исключение: исходное исключение.<br>`).join('')}</div></div><div class="message-lastEdit"><time datetime="2026-09-30T13:09:53+0300"></time></div></article>`;
}

await test('only the official post is imported; split numbers, notes and exceptions remain intact', () => {
  const snapshot = parseRules(fixture() + '<article class="message" data-content="post-123"><div class="message-body"><div class="bbWrapper">9.9 Комментарий пользователя.</div></div></article>');
  assert.equal(snapshot.points.length, 97);
  assert.equal(snapshot.sourceUrl, sourceUrl);
  assert.equal(snapshot.sourceEditedAt, '2026-09-30T13:09:53+0300');
  assert(snapshot.points.find(point => point.number === '1.21.1'));
  assert.deepEqual(snapshot.points.find(point => point.number === '7.4').paragraphs.slice(-2), ['Примечание: исходное примечание.', 'Исключение: исходное исключение.']);
  assert(!snapshot.lines.some(line => line.includes('Комментарий пользователя')));
  assert.equal(snapshot.contentHash.length, 64);
  const cards = ruleCards({ ...snapshot, checkedAt: '2026-10-05T00:00:00Z' });
  assert.equal(cards.cards.length, 4);
  assert(cards.cards[0].items.includes('Исключение: исходное исключение.'));
});

await test('login pages, truncation, missing referenced points and duplicate numbers cannot replace an edition', () => {
  assert.throws(() => parseRules('<form>Войдите в форум</form>'), /не найдено/);
  assert.throws(() => parseRules(fixture().replace(/<span>3\.[\s\S]*?<\/div><\/div>/, '</div></div>')), /неполный/);
  assert.throws(() => parseRules(fixture().replace('<span>7.</span><span>4 ', '<span>7.</span><span>9 ')), /не найден пункт 7.4/);
  assert.throws(() => parseRules(fixture().replace('<span>3.</span><span>2 ', '<span>3.</span><span>1 ')), /Повторяющиеся/);
  const original = parseRules(fixture());
  assert.throws(() => checkChange(original, { ...original, points: original.points.slice(0, 30) }), /резко сократился/);
  assert.throws(() => checkChange(original, { ...original, lines: ['обрыв'] }), /резко сократился/);
  assert.doesNotThrow(() => checkChange(original, original));
});

await test('a failed fetch or invalid page writes no files; a verified update writes matching full text and cards', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'usb-rules-test-'));
  const originalFetch = globalThis.fetch;
  try {
    await mkdir(join(directory, 'lib'));
    for (const response of [new Response('Forbidden', { status: 403 }), new Response('login', { headers: { 'content-type': 'text/html' } })]) {
      globalThis.fetch = async () => response;
      await assert.rejects(syncRules(directory));
      await assert.rejects(readFile(join(directory, 'public/rules/state-organizations.json')), { code: 'ENOENT' });
    }
    globalThis.fetch = async (url, options) => {
      assert.equal(url, sourceUrl); assert.equal(options.redirect, 'error');
      assert(options.signal); return new Response(fixture(), { headers: { 'content-type': 'text/html' } });
    };
    await syncRules(directory);
    const before = await readFile(join(directory, 'public/rules/state-organizations.json'), 'utf8');
    const data = JSON.parse(before), cards = JSON.parse(await readFile(join(directory, 'lib/project-rule-cards.json'), 'utf8'));
    assert.equal(data.contentHash, cards.contentHash);
    globalThis.fetch = async () => new Response('<form>Вход</form>', { headers: { 'content-type': 'text/html' } });
    await assert.rejects(syncRules(directory));
    assert.equal(await readFile(join(directory, 'public/rules/state-organizations.json'), 'utf8'), before);
  } finally { globalThis.fetch = originalFetch; await rm(directory, { recursive: true, force: true }); }
});

await test('the committed full edition and displayed cards agree, with all required points and exceptions', async () => {
  const snapshot = JSON.parse(await readFile(new URL('../public/rules/state-organizations.json', import.meta.url)));
  const cards = JSON.parse(await readFile(new URL('../lib/project-rule-cards.json', import.meta.url)));
  assert.deepEqual(cards, ruleCards(snapshot));
  assert(snapshot.points.length >= 80);
  assert(snapshot.lines.some(line => line.startsWith('Исключение:')));
});

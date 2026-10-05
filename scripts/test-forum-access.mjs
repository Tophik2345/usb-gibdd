import assert from 'node:assert/strict';
import test from 'node:test';
import { checkForumAccess } from './check-forum-access.mjs';

const cookie = 'xf_session=local-test-session; xf_user=local-test-user';
const response = html => new Response(html, { headers: { 'content-type': 'text/html' } });

await test('session is sent only to the two official HTTPS targets and redirects are refused', async () => {
  const calls = [];
  const result = await checkForumAccess(cookie, async (url, options) => {
    assert.equal(new URL(url).origin, 'https://forum.russia.online');
    assert.equal(options.headers.Cookie, cookie);
    assert.equal(options.redirect, 'error'); assert(options.signal);
    calls.push(url);
    return url.includes('/categories/')
      ? response('<title>Государственные организации | Россия Онлайн Форум</title><div class="p-body-pageContent"><div class="node">Государственные организации</div></div>')
      : response('<title>Процессуальный кодекс РО | Россия Онлайн Форум</title><article class="message"><div class="message-body"><div class="bbWrapper">' + 'Официальный текст нормы. '.repeat(80) + '</div></div></article>');
  });
  assert.equal(calls.length, 2);
  assert.equal(result.authorized, true);
  assert(!JSON.stringify(result).includes(cookie));
  assert(!JSON.stringify(result).includes('local-test-user'));
  assert(!JSON.stringify(result).includes('Официальный текст нормы'));
});

await test('a login widget does not hide readable source content and the browser user agent is retained', async () => {
  const agent = 'Mozilla/5.0 browser-session-test';
  const result = await checkForumAccess(cookie, async (url, options) => {
    assert.equal(options.headers['User-Agent'], agent);
    const form = '<form action="/login/login">Войти</form>';
    return url.includes('/categories/')
      ? response('<title>Государственные организации | Россия Онлайн Форум</title><div class="p-body-pageContent"><div class="node">Раздел</div></div>' + form)
      : response('<title>Процессуальный кодекс РО | Россия Онлайн Форум</title><article class="message"><div class="message-body"><div class="bbWrapper">' + 'Официальный текст нормы. '.repeat(80) + '</div></div></article>' + form);
  }, agent);
  assert.equal(result.authorized, true);
  assert(result.pages.every(page => page.diagnostics.loginFormPresent && page.diagnostics.expectedContentPresent));
  assert(!JSON.stringify(result).includes(cookie));
});

await test('missing or malformed session values cannot send any requests', async () => {
  let calls = 0;
  for (const value of [undefined, '', ' ', cookie + '\r\nInjected: true', 'a'.repeat(32001)]) {
    await assert.rejects(checkForumAccess(value, async () => { calls++; }));
  }
  assert.equal(calls, 0);
});

await test('a login form, 403 or unrelated page cannot count as authorized access', async () => {
  for (const make of [() => new Response('Denied', { status: 403 }), () => response('<title>Вход | Россия Онлайн Форум</title><form action="/login/login">Войти</form>'), () => response('<title>Главная</title>')]) {
    const result = await checkForumAccess(cookie, async () => make());
    assert.equal(result.authorized, false);
    assert(result.pages.every(page => !page.accessible));
    assert(!JSON.stringify(result).includes(cookie));
  }
});

await test('transport errors containing session data are not exposed in the report', async () => {
  const result = await checkForumAccess(cookie, async () => { throw new Error('Cookie: ' + cookie); });
  assert.equal(result.authorized, false);
  assert(!JSON.stringify(result).includes(cookie));
  assert(!JSON.stringify(result).includes('local-test-session'));
});

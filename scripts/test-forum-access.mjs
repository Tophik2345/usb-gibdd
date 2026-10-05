import assert from 'node:assert/strict';
import test from 'node:test';
import { checkForumAccess } from './check-forum-access.mjs';
import { officialUrl, extractSource, collectSources } from './collect-forum-sources.mjs';

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

await test('source collection refuses off-site destinations and account or action links before sending a session', async () => {
  for (const url of ['https://other.test/threads/law.1/', 'https://forum.russia.online/account/', 'https://forum.russia.online/threads/law.1/?token=secret', 'https://user@forum.russia.online/threads/law.1/']) {
    assert.throws(() => officialUrl(url));
    let called = false;
    await assert.rejects(collectSources([url], cookie, 'agent', async () => { called = true; }));
    assert.equal(called, false);
  }
  assert.equal(officialUrl('/threads/law.1/#post-1'), 'https://forum.russia.online/threads/law.1/');
});

await test('source artifacts contain only document bodies and official section links, with credential attributes removed', () => {
  const source = extractSource('<title>Официальный закон</title><input name="_xfToken" value="private-token"><a href="/account/">Private account</a><h3 class="node-title"><a href="/forums/laws.1/">Законы</a></h3><h3 class="node-title"><a href="https://other.test/">External</a></h3><article class="message" data-content="post-1"><span>Private username</span><div class="message-body"><div class="bbWrapper"><div style="text-align: center">Глава I</div><p data-user="private-user"><a href="/action?token=private-token">Статья 1. Норма</a></p><script>private-secret</script><form><input value="private-token"></form></div></div></article>', 'https://forum.russia.online/threads/law.1/');
  assert.equal(source.posts.length, 1);
  assert.equal(source.links.length, 1);
  assert.equal(source.links[0].url, 'https://forum.russia.online/forums/laws.1/');
  assert(source.posts[0].html.includes('Статья 1. Норма'));
  assert(source.posts[0].html.includes('text-align: center'));
  assert(!JSON.stringify(source).includes('private-'));
  assert(!JSON.stringify(source).includes('Private username'));
});

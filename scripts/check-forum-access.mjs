import { load } from 'cheerio';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const targets = [
  { kind: 'category', url: 'https://forum.russia.online/categories/gosudarstvennyye-organizatsii.1595/' },
  { kind: 'document', url: 'https://forum.russia.online/threads/protsessual-nyi-kodeks-ro.4910/' },
];

export async function checkForumAccess(cookie, request = fetch, userAgent = 'Mozilla/5.0') {
  if (typeof cookie !== 'string' || !cookie.trim()) throw new Error('Добавьте FORUM_COOKIE в защищённые секреты репозитория.');
  if (/[\x00-\x1f\x7f]/.test(cookie) || cookie.length > 32000 || /[\x00-\x1f\x7f]/.test(userAgent)) {
    throw new Error('Некорректный формат заголовка авторизации.');
  }
  const pages = [];
  for (const target of targets) {
    try {
      const response = await request(target.url, {
        headers: { Cookie: cookie.trim(), 'User-Agent': userAgent },
        redirect: 'error', signal: AbortSignal.timeout(25000),
      });
      const page = { ...target, status: response.status, accessible: false };
      if (response.status === 401 || response.status === 403) { pages.push({ ...page, reason: 'Требуется вход или право просмотра раздела.' }); continue; }
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) { pages.push({ ...page, reason: 'Источник вернул неожиданный ответ.' }); continue; }
      const html = await response.text();
      if (html.length > 2000000) { pages.push({ ...page, reason: 'Ответ источника слишком большой.' }); continue; }
      const $ = load(html);
      const body = $('article.message .message-body .bbWrapper').first();
      const title = $('title').first().text();
      const loginPage = /^Вход\s*\|/iu.test(title);
      const loginFormPresent = $('form[action*="login/login"]').length > 0;
      const valid = target.kind === 'document'
        ? /процессуальный\s+кодекс/iu.test(title) && body.text().trim().length > 1000
        : /государственные\s+организации/iu.test(title) && $('.p-body-pageContent .node').length > 0;
      // A login widget may coexist with a readable page. Report only booleans,
      // never titles, account details, request headers or response contents.
      const diagnostics = { loginPage, loginFormPresent, expectedContentPresent: valid };
      if (loginPage || (!valid && loginFormPresent)) {
        pages.push({ ...page, diagnostics, reason: 'Сессия не принята: форум показывает форму входа.' }); continue;
      }
      pages.push({ ...page, diagnostics, accessible: valid, reason: valid ? 'Доступ подтверждён.' : 'Ожидаемый раздел или документ не найден.' });
    } catch {
      // Never expose request headers, transport error details or page content.
      pages.push({ ...target, accessible: false, reason: 'Запрос не выполнен; проверьте сессию и доступность форума.' });
    }
  }
  return { checkedAt: new Date().toISOString(), authorized: pages.every(page => page.accessible), pages };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await checkForumAccess(process.env.FORUM_COOKIE, fetch, process.env.FORUM_USER_AGENT || 'Mozilla/5.0');
    await writeFile('/tmp/usb-forum-access.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    if (!result.authorized) process.exitCode = 1;
  } catch {
    console.error('Проверка не запущена. Добавьте корректный FORUM_COOKIE в секреты GitHub Actions.');
    process.exitCode = 1;
  }
}

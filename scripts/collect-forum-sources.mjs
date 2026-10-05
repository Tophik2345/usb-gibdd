import { load } from 'cheerio';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaults = [
  'https://forum.russia.online/categories/gosudarstvennyye-organizatsii.1595/',
  'https://forum.russia.online/threads/protsessual-nyi-kodeks-ro.4910/',
];

export function officialUrl(value) {
  const url = new URL(value, 'https://forum.russia.online');
  if (url.origin !== 'https://forum.russia.online' || url.username || url.password ||
      !/^\/(?:categories|forums|threads)\/[a-z0-9-]+\.\d+\/$/.test(url.pathname) || url.search) {
    throw new Error('Only official forum sections and documents are allowed.');
  }
  url.hash = '';
  return url.href;
}

export function extractSource(html, url) {
  const $ = load(html);
  const title = $('title').first().text().trim();
  if (/^Вход\s*\|/iu.test(title)) throw new Error('The source requires a valid forum session.');
  const links = [];
  $('.node-title a, .structItem-title a').each((_, el) => {
    try {
      const href = officialUrl($(el).attr('href'));
      if (!links.some(link => link.url === href)) links.push({ title: $(el).text().trim(), url: href });
    } catch { /* Never follow profile, external, query or action links. */ }
  });
  const posts = [];
  $('article.message').first().each((_, el) => {
    const post = $(el);
    const id = post.attr('data-content');
    if (!/^post-\d+$/.test(id || '')) return;
    const body = post.find('.message-body .bbWrapper').first().clone();
    if (!body.length) return;
    body.find('script, style, iframe, button, input, form').remove();
    // Preserve only the official message body and formatting needed to parse
    // chapters and paragraphs. Strip all links, tokens and account attributes.
    body.find('*').each((_, child) => {
      const node = $(child);
      for (const attr of Object.keys(child.attribs || {})) {
        if ((attr !== 'style' && attr !== 'alt') || (attr === 'style' && /url\s*\(/iu.test(node.attr(attr)))) node.removeAttr(attr);
      }
    });
    const edited = post.find('.message-lastEdit time').attr('datetime');
    posts.push({ id, editedAt: edited && Number.isFinite(Date.parse(edited)) ? edited : null, html: body.html() || '' });
  });
  return { url, title, links, posts };
}

export async function collectSources(values, cookie, userAgent = 'Mozilla/5.0', request = fetch) {
  const urls = [...new Set(values.map(officialUrl))];
  if (!urls.length || urls.length > 12 || !cookie || /[\x00-\x1f\x7f]/.test(cookie + userAgent)) throw new Error('Invalid source or session configuration.');
  const sources = [];
  for (const url of urls) {
    const response = await request(url, { headers: { Cookie: cookie, 'User-Agent': userAgent }, redirect: 'error', signal: AbortSignal.timeout(25000) });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('The official source is unavailable.');
    const html = await response.text();
    if (html.length > 2000000) throw new Error('Unexpected source size.');
    sources.push(extractSource(html, url));
  }
  return sources;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const configured = process.env.FORUM_SOURCE_URLS?.trim();
    const values = configured ? configured.split(/\s+/) : defaults;
    const sources = await collectSources(values, process.env.FORUM_COOKIE, process.env.FORUM_USER_AGENT || 'Mozilla/5.0');
    await mkdir('/tmp/usb-forum-sources', { recursive: true });
    await writeFile('/tmp/usb-forum-sources/sources.json', JSON.stringify(sources, null, 2));
    console.log(JSON.stringify({ sources: sources.length, officialBodies: sources.reduce((n, source) => n + source.posts.length, 0) }));
  } catch {
    console.error('Не удалось прочитать официальные источники; проверьте сессию и указанные страницы.');
    process.exitCode = 1;
  }
}

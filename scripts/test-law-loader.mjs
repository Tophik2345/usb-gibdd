import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';

const initial = JSON.parse(fs.readFileSync(new URL('../lib/law-documents.json', import.meta.url)));
const sources = JSON.parse(fs.readFileSync(new URL('../lib/law-sources.json', import.meta.url)));
const original = fs.readFileSync(new URL('../lib/law-loader.ts', import.meta.url), 'utf8');
let serial = 0;
async function loader() {
  const code = ts.transpileModule(original, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace(/import initial from ['"]\.\/law-documents\.json['"];?/, 'const initial=' + JSON.stringify(initial) + ';')
    .replace(/import sources from ['"]\.\/law-sources\.json['"];?/, 'const sources=' + JSON.stringify(sources) + ';')
    .replaceAll('import.meta.env.BASE_URL', '"https://site.test/usb-gibdd/"');
  return import('data:text/javascript;base64,' + Buffer.from(code + '\n// instance ' + ++serial).toString('base64'));
}

await test('law loaders share pending requests, refresh expired text and retain valid data on failure', async () => {
  const savedFetch = globalThis.fetch, savedNow = Date.now;
  const fixture = JSON.parse(fs.readFileSync(new URL('../public/laws/charter.json', import.meta.url)));
  let now = 1000, calls = 0, mode = 'first';
  Date.now = () => now;
  globalThis.fetch = async (url, options) => {
    calls++; assert.equal(url, 'https://site.test/usb-gibdd/laws/charter.json'); assert.equal(options.cache, 'no-cache');
    if (mode === 'offline') throw new Error('Offline');
    if (mode === 'incomplete') return Response.json({ id: 'charter', title: 'Устав', entries: fixture.entries.slice(0,2) });
    const data = structuredClone(fixture); data.entries.find(entry => entry.kind === 'article').paragraphs.push(mode === 'first' ? 'Первая редакция.' : 'Новая редакция.');
    return Response.json(data);
  };
  try {
    const api = await loader();
    const [one,two] = await Promise.all([api.loadDocument('charter'),api.loadDocument('charter')]);
    assert.equal(calls,1); assert.equal(one,two);
    now += api.lawRefreshInterval + 1; mode = 'second';
    const latest = await api.loadDocument('charter'); assert.notEqual(latest,one);
    assert(latest.entries.some(entry => entry.paragraphs.includes('Новая редакция.')));
    now += api.lawRefreshInterval + 1; mode = 'offline'; assert.equal(await api.loadDocument('charter'),latest);
    mode = 'incomplete'; assert.equal(await api.loadDocument('charter'),latest);
    await assert.rejects(api.loadDocument('../private'));
  } finally { globalThis.fetch = savedFetch; Date.now = savedNow; }
});

await test('manifest updates keep all eight pinned sources and reject incomplete or unrelated metadata', async () => {
  const savedFetch = globalThis.fetch, savedNow = Date.now;
  let now = 1000, mode = 'valid'; Date.now = () => now;
  globalThis.fetch = async () => {
    const documents = structuredClone(initial);
    if (mode === 'missing') documents.pop();
    if (mode === 'unrelated') documents[0].sourceUrl = 'https://other.test/';
    return Response.json({ documents });
  };
  try {
    const api = await loader(); assert.equal((await api.loadLawManifest()).length,8);
    now += api.lawRefreshInterval + 1; mode = 'missing'; await assert.rejects(api.loadLawManifest());
    mode = 'unrelated'; await assert.rejects(api.loadLawManifest());
    mode = 'valid'; assert.equal((await api.loadLawManifest()).length,8);
  } finally { globalThis.fetch = savedFetch; Date.now = savedNow; }
});

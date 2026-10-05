import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export function serviceWorkerSource(version, files) {
  if (!/^[a-zA-Z0-9-]+$/.test(version) || files.some(file => !/^[a-zA-Z0-9_./-]+$/.test(file) || !file.startsWith('./') || file.includes('..'))) throw new Error('Invalid public precache list');
  return `const ROOT=new URL('./',self.location.href),PREFIX='usb-gibdd-public-'+encodeURIComponent(ROOT.pathname)+'-',CACHE=PREFIX+${JSON.stringify(version)};
const URLS=${JSON.stringify(files)}.map(path=>new URL(path,ROOT).href),PUBLIC=new Set(URLS),RULES=new Set(URLS.filter(url=>/\\/(?:laws|rules)\\/[^/]+\\.json$/.test(new URL(url).pathname)));
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(URLS.map(url=>new Request(url,{cache:'reload',credentials:'omit'}))))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{if(event.data?.type==='APPLY_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{const request=event.request,url=new URL(request.url);if(request.method!=='GET'||url.origin!==ROOT.origin||request.headers.has('authorization'))return;
url.search='';url.hash='';if(!PUBLIC.has(url.href))return;
if(RULES.has(url.href)){event.respondWith(caches.open(CACHE).then(async cache=>{try{const response=await fetch(request);if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw new Error('Rules unavailable');const data=await response.clone().json(),law=url.pathname.includes('/laws/');if(law?data.id!==url.pathname.split('/').pop().slice(0,-5)||!Array.isArray(data.entries)||!data.entries.length:data.sourcePost!=='post-11'||!Array.isArray(data.points)||data.points.length<80||!Array.isArray(data.lines)||!data.lines.length)throw new Error('Incomplete rules');await cache.put(url.href,response.clone());return response;}catch(error){const cached=await cache.match(url.href);if(cached)return cached;throw error;}}));return;}
event.respondWith(caches.open(CACHE).then(cache=>cache.match(url.href)).then(cached=>cached||fetch(request)));});
`;
}
export async function buildPwa(directory) {
  const manifestPath=resolve(directory,'manifest.webmanifest');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  // Manifest IDs resolve against the origin, so retain the Pages subdirectory.
  manifest.id=new URL(process.env.BASE_PATH||'/', 'https://example.invalid/').pathname;
  await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  const assets=(await readdir(resolve(directory,'assets'))).filter(name=>/\.(?:js|css|woff2?|png|webp|svg)$/.test(name)).sort().map(name=>'./assets/'+name);
  const laws=(await readdir(resolve(directory,'laws'))).filter(name=>name.endsWith('.json')).sort().map(name=>'./laws/'+name);
  const rules=(await readdir(resolve(directory,'rules'))).filter(name=>name.endsWith('.json')).sort().map(name=>'./rules/'+name);
  const files=['./','./index.html','./favicon.svg','./manifest.webmanifest','./pwa/icon-192.png','./pwa/icon-512.png','./usb-gibdd-background.webp','./gibdd-emblem.svg',...assets,...laws,...rules];
  const hash=createHash('sha256');
  for(const file of files){hash.update(file);hash.update(await readFile(resolve(directory,file==='./'?'index.html':file)));}
  const version=hash.digest('hex').slice(0,16);
  await writeFile(resolve(directory,'sw.js'),serviceWorkerSource(version,files));
  console.log('Public PWA cache built: '+files.length+' static files, version '+version+'. No API or personal records are cached.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildPwa(resolve(import.meta.dirname,'../dist'));

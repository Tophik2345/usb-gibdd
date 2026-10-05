import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { serviceWorkerSource } from './build-pwa.mjs';

const root='https://example.test/usb-gibdd/',files=['./','./index.html','./assets/current.js','./laws/charter.json','./laws/manifest.json','./rules/state-organizations.json','./rule-history/index.json','./rule-history/charter-'+ 'a'.repeat(24)+'.json'];
const historyFixture=JSON.parse(fs.readFileSync(new URL('../public/rule-history/index.json',import.meta.url)));
const historyEntry={id:'article-1',kind:'article',title:'Статья 1.',chapter:'Глава 1.',paragraphs:['Новая норма.']};
const historyDetail={id:'charter-'+ 'a'.repeat(24),document:'charter',title:'Устав',sourceUrl:historyFixture.documents[0].sourceUrl,sourceEditedAt:null,detectedAt:'2026-10-05T11:00:00Z',beforeHash:'b'.repeat(64),afterHash:'c'.repeat(64),added:1,changed:0,removed:0,changes:[{id:'article-1',type:'added',before:null,after:historyEntry}]};
const lawFixture=JSON.parse(fs.readFileSync(new URL('../public/laws/charter.json',import.meta.url)));
const lawManifestFixture=JSON.parse(fs.readFileSync(new URL('../public/laws/manifest.json',import.meta.url)));
const handlers={},storage=new Map(),deleted=[];let network=0,skipped=0,claimed=0,networkMode='json';
const caches={
  async open(key){if(!storage.has(key))storage.set(key,new Map());const values=storage.get(key);return {
    async addAll(requests){for(const request of requests){assert.equal(request.credentials,'omit');assert.equal(request.cache,'reload');values.set(request.url,new Response('public:'+request.url));}},
    async match(url){return values.get(url)?.clone();},
    async put(url,response){values.set(url,response);}
  };},async keys(){return [...storage.keys()];},async delete(key){deleted.push(key);return storage.delete(key);}
};
const prefix='usb-gibdd-public-'+encodeURIComponent('/usb-gibdd/')+'-';
storage.set(prefix+'old',new Map());storage.set('another-app-private',new Map());storage.set('usb-gibdd-public-'+encodeURIComponent('/other/')+'-old',new Map());
const self={location:{href:root+'sw.js'},clients:{claim:async()=>{claimed++;}},skipWaiting:()=>{skipped++;},addEventListener:(name,fn)=>handlers[name]=fn};
vm.runInNewContext(serviceWorkerSource('new',files),{self,caches,URL,Request,Response,Date,Number,fetch:async request=>{network++;if(networkMode==='offline')throw new Error('Offline');const data=request.url.endsWith('/rule-history/index.json')?{...historyFixture,edition:'new'}:request.url.includes('/rule-history/')?{...historyDetail,edition:'new'}:request.url.endsWith('/laws/manifest.json')?{...lawManifestFixture,edition:'new'}:request.url.includes('/laws/')?{...lawFixture,edition:'new'}:{edition:'new',sourcePost:'post-11',points:Array.from({length:80},(_,i)=>({number:'1.'+i})),lines:['Полный текст']};return networkMode==='json'?new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}}):networkMode==='incomplete-json'?new Response('{}',{headers:{'content-type':'application/json'}}):networkMode==='malformed-json'?new Response('{broken',{headers:{'content-type':'application/json'}}):networkMode==='server-error'?new Response('failure',{status:503}):new Response('<form>login</form>',{headers:{'content-type':'text/html'}});},Set});
const invoke=async name=>{let pending;handlers[name]({waitUntil:promise=>pending=promise});await pending;};
await invoke('install');assert.equal(skipped,0);assert.equal(storage.get(prefix+'new').size,8);
await invoke('activate');assert.deepEqual(deleted,[prefix+'old']);assert.equal(claimed,1);assert(storage.has('another-app-private'));
const fetchEvent=async request=>{let pending;handlers.fetch({request,respondWith:promise=>pending=promise});return pending?await pending:null;};
for(const url of [root,root+'index.html?code=not-cached',root+'assets/current.js']){
  const response=await fetchEvent(new Request(url));assert.equal(response.status,200);assert((await response.text()).startsWith('public:'));
}
assert.equal(network,0);
for(const url of [root+'laws/charter.json',root+'laws/manifest.json',root+'rules/state-organizations.json',root+'rule-history/index.json',root+'rule-history/'+historyDetail.id+'.json']){
  networkMode='json';const response=await fetchEvent(new Request(url));assert.equal((await response.json()).edition,'new');
  for(const mode of ['offline','server-error','html','incomplete-json','malformed-json']){networkMode=mode;const fallback=await fetchEvent(new Request(url));assert.equal((await fallback.json()).edition,'new');}
}
const publicRuleRequests=network;
for(const request of [new Request('https://project.supabase.co/rest/v1/rpc/knowledge_results'),new Request('https://project.supabase.co/rest/v1/rpc/knowledge_support'),new Request(root+'api/profile'),new Request(root+'auth/v1/token'),new Request(root+'assets/unknown.js'),new Request(root,{method:'POST',body:'private'}),new Request(root+'laws/charter.json',{headers:{Authorization:'Bearer private'}})])assert.equal(await fetchEvent(request),null);
assert.equal(network,publicRuleRequests);assert.equal(storage.get(prefix+'new').size,8);
handlers.message({data:{type:'unknown'}});assert.equal(skipped,0);handlers.message({data:{type:'APPLY_UPDATE'}});assert.equal(skipped,1);
for(const bad of [['bad!',files],['good',['../private']],['good',['https://api.example.test/private']]])assert.throws(()=>serviceWorkerSource(...bad),/Invalid/);
const manifest=JSON.parse(fs.readFileSync(new URL('../public/manifest.webmanifest',import.meta.url)));assert.equal(manifest.scope,'./');assert.equal(manifest.start_url,'./#home');assert.equal(manifest.display,'standalone');
for(const icon of manifest.icons){const bytes=fs.readFileSync(new URL('../public/'+icon.src,import.meta.url));const [width,height]=icon.sizes.split('x').map(Number);assert.equal(bytes.readUInt32BE(16),width);assert.equal(bytes.readUInt32BE(20),height);assert.equal(icon.type,'image/png');}
console.log('PASS: rules fetch the latest edition and retain it offline or on server failure; scoped public caches, private/API bypass, explicit app updates, icons and manifest remain valid.');

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareSnapshots, historyFiles } from './rule-history.mjs';
import { validPublicHistory } from './public-history-schema.mjs';
import fs from 'node:fs';
import ts from 'typescript';
const sources=JSON.parse(fs.readFileSync(new URL('../lib/law-sources.json',import.meta.url)));
const baseline=JSON.parse(fs.readFileSync(new URL('../public/rule-history/index.json',import.meta.url)));
const before=JSON.parse(fs.readFileSync(new URL('../public/laws/charter.json',import.meta.url)));
await test('checks alone create no revisions; exact changed/added/removed text is archived and no revision is duplicated',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usb-history-'));
 try{
  await mkdir(join(root,'public/rule-history'),{recursive:true});await writeFile(join(root,'public/rule-history/index.json'),JSON.stringify(baseline));
  let files=await historyFiles(root,[{id:'charter',previous:before,next:{...before,checkedAt:'2026-10-05T11:00:00Z'}}]);assert.equal(files.length,1);assert.equal(files[0][1].revisions.length,baseline.revisions.length);
  const after=structuredClone(before);after.checkedAt='2026-10-05T11:00:00Z';after.entries[2].paragraphs.push('Новая редакция нормы.');const removed=after.entries.splice(3,1)[0];after.entries.push({...removed,id:'article-999',title:'Статья 999. Новая норма'});
  const delta=compareSnapshots(before,after);assert.deepEqual(delta.map(item=>item.type).sort(),['added','changed','removed']);
  files=await historyFiles(root,[{id:'charter',previous:before,next:after}]);const detail=files[0][1],index=files[1][1];
  assert.equal(detail.changes.find(item=>item.type==='removed').before.id,removed.id);assert(detail.changes.find(item=>item.type==='changed').after.paragraphs.includes('Новая редакция нормы.'));
  assert(validPublicHistory(index,'index.json',sources));assert(validPublicHistory(detail,detail.id+'.json',sources));assert(!validPublicHistory(detail,'criminal-'+detail.id.split('-').at(-1)+'.json',sources));
  for(const [path,data]of files)await writeFile(path,JSON.stringify(data));
  files=await historyFiles(root,[{id:'charter',previous:before,next:after}]);assert.equal(files.length,1);assert.equal(files[0][1].revisions.length,index.revisions.length);
  assert.equal(JSON.parse(await readFile(join(root,'public/rule-history/'+detail.id+'.json'))).changes.length,3);
 }finally{await rm(root,{recursive:true,force:true});}
});
await test('state rules preserve changed points and unnumbered headings; incomplete history cannot replace the public journal',()=>{
 const old={points:[{number:'1.1',paragraphs:['1.1 Старый текст.']}],lines:['Общие положения','1.1 Старый текст.']};
 const next={points:[{number:'1.1',paragraphs:['1.1 Новый текст.']}],lines:['Новый заголовок','1.1 Новый текст.']};
 assert.deepEqual(compareSnapshots(old,next).map(change=>change.id),['other-text','point-1.1']);
 assert(validPublicHistory(baseline,'index.json',sources));assert(!validPublicHistory({...baseline,documents:baseline.documents.slice(1)},'index.json',sources));
 assert(!validPublicHistory({...baseline,documents:baseline.documents.map(doc=>({...doc,sourceUrl:'https://wrong.test'}))},'index.json',sources));
 assert(!validPublicHistory({...baseline,revisions:[{id:'forged'}]},'index.json',sources));
});
await test('test explanation references round-trip; external or malformed links remain plain text',async()=>{
 const source=fs.readFileSync(new URL('../lib/question-reference.ts',import.meta.url),'utf8');const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText;
 const {splitExplanation,joinExplanation}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const text='Основание необходимо проверить.\nОткрыть статью: #laws?document=procedure&article=article-53';const parts=splitExplanation(text);assert.equal(parts.reference.article,'article-53');assert.equal(joinExplanation(parts.text,parts.reference),text);
 for(const link of ['https://wrong.test','#laws?document=../secret&article=article-1','#laws?document=procedure&article=article-0','javascript:alert(1)'])assert.equal(splitExplanation('Открыть статью: '+link).reference,null);
});

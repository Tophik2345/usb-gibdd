import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
class WorkspaceError extends Error{constructor(message,status=503){super(message);this.status=status;}}
const timers=new Map();let timerId=0;
function compile(file,require){const exports={};const context={exports,require,crypto,Date,Error,setTimeout:(f,delay)=>{const id=++timerId;timers.set(id,{f,delay});return id;},clearTimeout:id=>timers.delete(id)};Object.defineProperty(context,'localStorage',{get(){throw new Error('Storage blocked');}});vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);return exports;}
const helpers=compile('../lib/editor-drafts.ts',name=>name==='./workspace-api'?{WorkspaceError}:{accountRpc:async()=>{throw new Error('Unexpected real RPC');}});
const {DraftSaver}=compile('../lib/draft-saver.ts',name=>name==='./editor-drafts'?helpers:{WorkspaceError});
function storage(){const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),key:i=>[...values.keys()][i]||null,get length(){return values.size;}};}
const form=helpers.newTest(),uid='owner-one';
function response(payload){return {id:payload.id,testId:payload.form.id||null,baseVersion:payload.baseVersion,version:payload.version+1,form:payload.form,updatedAt:new Date().toISOString()};}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
await test('typing persists incomplete input before a network request and isolates account caches',async()=>{
 const store=storage(),prepared=helpers.freshDraft(form);let calls=0;const saver=new DraftSaver(uid,prepared,()=>{},store,async(a,p)=>{calls++;return response(p);});
 saver.update({...form,title:'Неполный вопрос'});assert.equal(calls,0);assert.equal(helpers.readDraft(uid,prepared.record.id,store).record.form.title,'Неполный вопрос');assert.equal(helpers.cachedDrafts('another-owner',store).length,0);
 await saver.flush();assert.equal(calls,1);assert.equal(saver.snapshot().status,'saved');assert.equal(saver.snapshot().record.form.published,false);saver.dispose();
});
await test('autosaves serialize and publication waits for the latest changes during an in-flight save',async()=>{
 const store=storage(),prepared=helpers.freshDraft(form),hold=deferred(),started=deferred();const calls=[];
 const saver=new DraftSaver(uid,prepared,()=>{},store,async(action,p)=>{calls.push({action,p});if(calls.length===1){started.resolve();await hold.promise;}return action==='save'?response(p):{...p,id:'published-test'};});
 saver.update({...form,title:'Первая правка'});const first=saver.flush();await started.promise;saver.update({...form,title:'Последняя правка'});const publication=saver.publish();hold.resolve();await first;await publication;
 assert.equal(calls.filter(c=>c.action==='save').length,2);assert.equal(calls[1].p.form.title,'Последняя правка');assert.equal(calls[1].p.version,1);assert.equal(calls[2].action,'publish');assert.equal(calls[2].p.version,2);assert.equal(store.length,0);
});
await test('network failures retain work, schedule retry and cannot publish an incomplete server draft',async()=>{
 const store=storage(),prepared=helpers.freshDraft(form);const saver=new DraftSaver(uid,prepared,()=>{},store,async()=>{throw new WorkspaceError('Нет связи');});
 saver.update({...form,title:'Офлайн правка'});await assert.rejects(saver.publish(),/Нет связи/);assert.equal(helpers.readDraft(uid,prepared.record.id,store).record.form.title,'Офлайн правка');assert.equal(saver.snapshot().status,'error');assert([...timers.values()].some(t=>t.delay===15000));saver.dispose();
});
await test('conflicts preserve local work and stop further autosaves instead of overwriting another editor',async()=>{
 const store=storage(),prepared=helpers.freshDraft(form);let calls=0;const saver=new DraftSaver(uid,prepared,()=>{},store,async()=>{calls++;throw new WorkspaceError('Другая вкладка',409);});
 saver.update({...form,title:'Моя правка'});await assert.rejects(saver.flush(),/Другая вкладка/);saver.update({...form,title:'Продолжаю свою правку'});await assert.rejects(saver.flush(),/Другая вкладка/);assert.equal(calls,1);assert.equal(saver.snapshot().status,'conflict');assert.equal(helpers.readDraft(uid,prepared.record.id,store).record.form.title,'Продолжаю свою правку');saver.dispose();
});
await test('closing during a save restores edits made after the submitted snapshot without false conflicts',async()=>{
 const store=storage(),prepared=helpers.freshDraft(form),hold=deferred(),entered=deferred();let submitted;
 const saver=new DraftSaver(uid,prepared,()=>{},store,async(a,p)=>{submitted=p;entered.resolve();await hold.promise;return response(p);});
 saver.update({...form,title:'Отправленная правка'});const pending=saver.flush();await entered.promise;saver.update({...form,title:'Правка перед закрытием'});saver.dispose();hold.resolve();await assert.rejects(pending,/закрыт/);
 const restored=helpers.prepareDraft(uid,prepared.record.id,{draft:response(submitted),test:null},undefined,store);assert.equal(restored.conflict,'');assert.equal(restored.record.form.title,'Правка перед закрытием');assert.equal(restored.record.version,1);
});
await test('restoration detects other-device edits and forks preserve questions with independent IDs',()=>{
 const store=storage(),prepared=helpers.freshDraft(form);prepared.record.version=1;prepared.synced=helpers.draftSignature(form);prepared.record.form={...form,title:'Моя версия'};helpers.cacheDraft(uid,prepared,store);
 const remote={...prepared.record,version:2,form:{...form,title:'Чужая новая версия'}};const restored=helpers.prepareDraft(uid,prepared.record.id,{draft:remote,test:null},undefined,store);assert(restored.conflict);assert.equal(restored.record.form.title,'Моя версия');
 const copy=helpers.forkDraft({...form,id:'existing',published:true,title:'Название'});assert.equal(copy.record.testId,null);assert.equal(copy.record.form.published,false);assert.notEqual(copy.record.form.questions[0].id,form.questions[0].id);assert.equal(copy.record.form.questions[0].text,form.questions[0].text);
});
await test('discard failure retains the local draft and closed controllers cannot send new updates',async()=>{
 const store=storage(),prepared=helpers.freshDraft(form);let calls=0;const saver=new DraftSaver(uid,prepared,()=>{},store,async()=>{calls++;throw new WorkspaceError('Недоступно');});saver.update({...form,title:'Сохранить локально'});await assert.rejects(saver.discard());assert.equal(store.length,1);saver.dispose();saver.update({...form,title:'Поздний ответ'});await assert.rejects(saver.flush(),/закрыт/);assert.equal(calls,1);assert.equal(helpers.readDraft(uid,prepared.record.id,store).record.form.title,'Сохранить локально');
});

await test('unavailable local storage is reported and a successful server save still protects work',async()=>{
 assert.equal(helpers.cachedDrafts(uid).length,0);assert.equal(helpers.readDraft(uid,'unavailable'),null);
 const store=storage();store.setItem=()=>{throw new Error('Quota exceeded');};
 const saver=new DraftSaver(uid,helpers.freshDraft(form),()=>{},store,async(a,p)=>response(p));saver.update({...form,title:'Сохранить на сервере'});assert.equal(saver.snapshot().localSaved,false);assert.equal(saver.snapshot().status,'local');await saver.flush();assert.equal(saver.snapshot().status,'saved');assert.equal(saver.snapshot().record.form.title,'Сохранить на сервере');saver.dispose();
});
await test('discard waits for all queued edits and uses the latest acknowledged version',async()=>{
 const store=storage(),prepared=helpers.freshDraft(form),hold=deferred(),started=deferred(),calls=[];
 const saver=new DraftSaver(uid,prepared,()=>{},store,async(a,p)=>{calls.push({a,p});if(calls.length===1){started.resolve();await hold.promise;}return a==='save'?response(p):{discarded:true};});
 saver.update({...form,title:'Первая'});const pending=saver.flush();await started.promise;saver.update({...form,title:'Следующая'});const discard=saver.discard();hold.resolve();await pending;await discard;assert.equal(calls.at(-1).a,'discard');assert.equal(calls.at(-1).p.version,2);assert.equal(store.length,0);
});

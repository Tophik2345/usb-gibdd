import { accountRpc } from './account-session';
import { WorkspaceError } from './workspace-api';
import type { Test } from './types';
export type EditorDraft = { id:string; testId:string|null; baseVersion:number|null; version:number; form:Test; updatedAt:string };
export type DraftSummary = Omit<EditorDraft,'form'> & {title:string};
export type DraftLoad = {draft:EditorDraft|null;test:Test|null};
export type CachedDraft = {schema:1;userId:string;record:EditorDraft;synced:string;pending?:string};
export type PreparedDraft = {record:EditorDraft;synced:string;conflict:string;pending?:string};
export type DraftStorage = Pick<Storage,'getItem'|'setItem'|'removeItem'|'key'|'length'>;
// Delay access until each operation so browsers that block storage can still save remotely.
export const browserDraftStorage:DraftStorage={
  getItem:key=>globalThis.localStorage.getItem(key),setItem:(key,value)=>globalThis.localStorage.setItem(key,value),
  removeItem:key=>globalThis.localStorage.removeItem(key),key:index=>globalThis.localStorage.key(index),
  get length(){return globalThis.localStorage.length;}
};
export async function editorApi<T>(action:string,payload:Record<string,unknown>={}):Promise<T> {
  const {data,error}=await accountRpc('knowledge_editor',{...payload,action},true);
  if(error){if(/^PT4\d\d$/.test(error.code))throw new WorkspaceError(error.message,Number(error.code.slice(2)));throw new WorkspaceError('Не удалось связаться с сервером. Проверьте соединение и повторите попытку.');}
  return data as T;
}
export function editableTest(test:Test):Test {
  return {id:test.id,title:test.title,description:test.description,category:test.category,passMark:test.passMark,published:test.published,
    shuffleQuestions:!!test.shuffleQuestions,shuffleAnswers:!!test.shuffleAnswers,timeLimitMinutes:test.timeLimitMinutes||null,
    questions:(test.questions||[]).map(q=>({id:q.id,text:q.text,options:[...q.options],correct:q.correct??0,explanation:q.explanation||''})),count:test.questions?.length||0};
}
export const draftSignature=(test:Test)=>JSON.stringify(editableTest(test));
export function newTest():Test {return {id:'',title:'',description:'',category:'Общие знания',passMark:80,count:1,published:false,shuffleQuestions:true,shuffleAnswers:true,timeLimitMinutes:null,questions:[{id:crypto.randomUUID(),text:'',options:['','','',''],correct:0,explanation:''}]};}
export function freshDraft(form:Test,id=form.id?'test:'+form.id:'new:'+crypto.randomUUID()):PreparedDraft {
  const record={id,testId:form.id||null,baseVersion:form.version??null,version:0,form:editableTest(form),updatedAt:new Date().toISOString()};
  return {record,synced:draftSignature(record.form),conflict:''};
}
const prefix=(userId:string)=>'usb-gibdd:editor:v1:'+userId+':';
const cacheKey=(userId:string,id:string)=>prefix(userId)+encodeURIComponent(id);
export function readDraft(userId:string,id:string,storage:DraftStorage=browserDraftStorage):CachedDraft|null {
  try{
    const value=JSON.parse(storage.getItem(cacheKey(userId,id))||'null') as CachedDraft|null;
    if(!value||value.schema!==1||value.userId!==userId||value.record.id!==id||!Number.isInteger(value.record.version)||value.record.version<0||typeof value.synced!=='string')return null;
    const f=value.record.form;
    if(!f||typeof f.title!=='string'||typeof f.id!=='string'||typeof f.description!=='string'||typeof f.category!=='string'||typeof f.passMark!=='number'||typeof f.published!=='boolean'||!Array.isArray(f.questions)||f.questions.length<1||f.questions.length>60||f.questions.some(q=>typeof q.id!=='string'||typeof q.text!=='string'||!Array.isArray(q.options)||q.options.length<2||q.options.length>6||q.options.some(o=>typeof o!=='string')))return null;
    value.record.form=editableTest(f);return value;
  }catch{return null;}
}
export function cacheDraft(userId:string,prepared:PreparedDraft,storage:DraftStorage=browserDraftStorage){
  const value:CachedDraft={schema:1,userId,record:prepared.record,synced:prepared.synced,pending:prepared.pending};
  storage.setItem(cacheKey(userId,prepared.record.id),JSON.stringify(value));
}
export function removeDraft(userId:string,id:string,storage:DraftStorage=browserDraftStorage){storage.removeItem(cacheKey(userId,id));}
export function cachedDrafts(userId:string,storage:DraftStorage=browserDraftStorage):CachedDraft[] {
  try{return Array.from({length:storage.length},(_,i)=>storage.key(i)).filter((k):k is string=>!!k&&k.startsWith(prefix(userId))).map(k=>readDraft(userId,decodeURIComponent(k.slice(prefix(userId).length)),storage)).filter((d):d is CachedDraft=>!!d);}catch{return [];}
}
export function prepareDraft(userId:string,id:string,remote:DraftLoad,baseline?:Test,storage:DraftStorage=browserDraftStorage):PreparedDraft {
  const local=readDraft(userId,id,storage),server=remote.draft?{...remote.draft,form:editableTest(remote.draft.form)}:null;
  let result:PreparedDraft;
  if(local && draftSignature(local.record.form)!==local.synced){
    const content=server?draftSignature(server.form):'';
    if(server && content===draftSignature(local.record.form))result={record:server,synced:content,conflict:''};
    else if(server && server.version===local.record.version+1 && content===local.pending)result={record:{...server,form:local.record.form},synced:content,conflict:''};
    else result={record:local.record,synced:local.synced,conflict:local.record.version!== (server?.version||0)?'Черновик изменён в другой вкладке или на другом устройстве. Ваши правки остались на этом устройстве.':''};
  }else if(server)result={record:server,synced:draftSignature(server.form),conflict:''};
  else if(remote.test||baseline)result=freshDraft((remote.test||baseline)!,id);
  else throw new WorkspaceError('Черновик больше не существует. Обновите список.',404);
  if(remote.test&&result.record.baseVersion!==remote.test.version)result.conflict='Тест уже изменён. Сохраните свои правки как новый черновик или загрузите текущую версию.';
  return result;
}
export async function loadDraft(userId:string,id:string,baseline?:Test):Promise<PreparedDraft>{
  try{return prepareDraft(userId,id,await editorApi<DraftLoad>('load',{id}),baseline);}
  catch(error){
    const local=readDraft(userId,id);
    if(error instanceof WorkspaceError&&error.status===503&&local)return {record:local.record,synced:local.synced,pending:local.pending,conflict:''};
    throw error;
  }
}
export function forkDraft(form:Test):PreparedDraft {
  const copy=editableTest({...form,id:'',title:form.title.slice(0,112)+' — копия',published:false,version:undefined,questions:form.questions?.map(q=>({...q,id:crypto.randomUUID()}))});
  const result=freshDraft(copy);result.synced='';return result;
}

export async function reloadDraft(userId:string,id:string):Promise<PreparedDraft>{
  const remote=await editorApi<DraftLoad>('load',{id});
  if(remote.test&&remote.draft&&remote.test.version!==remote.draft.baseVersion){
    await editorApi('discard',{id,version:remote.draft.version});remote.draft=null;
  }
  const next=remote.draft?{record:{...remote.draft,form:editableTest(remote.draft.form)},synced:draftSignature(remote.draft.form),conflict:''}:freshDraft(remote.test||newTest(),id);
  try{removeDraft(userId,id);}catch{}return next;
}

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function checkSearchHistory({ db, asUser, rpc, denied, checks }) {
  const employee=randomUUID(), target=randomUUID(), captain=randomUUID(), owner=randomUUID(), deputy=randomUUID(), unconfirmed=randomUUID();
  const admin=async()=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims','{}',false)");};
  const call=async(name,payload={})=>(await db.query('select public.'+name+'($1::jsonb) data',[JSON.stringify(payload)])).rows[0].data;
  const search=payload=>call('knowledge_search',payload), history=payload=>call('knowledge_history',payload);
  await admin();
  for(const uid of [employee,target,captain,owner,deputy,unconfirmed]) await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[uid,uid+'@example.test',JSON.stringify({login:'История '+uid})]);
  for(const uid of [employee,target,captain,owner,deputy,unconfirmed]){await asUser(uid);await rpc({});}
  await admin();await db.query("update knowledge_private.department_members set rank='Капитан' where user_id=$1",[captain]);
  await db.query("insert into knowledge_private.test_creators(user_id,role) values($1,'owner'),($2,'deputy')",[owner,deputy]);
  await db.query('update auth.users set email_confirmed_at=null where id=$1',[unconfirmed]);
  for(const [uid,role,code] of [[null,'anon','42501'],[null,'authenticated','PT401'],[unconfirmed,'authenticated','PT401']]){
    await asUser(uid,role);await denied(()=>search({query:'устав'}),code);await denied(()=>history({}),code);
  }
  await asUser(employee);await denied(()=>db.query('select * from knowledge_private.person_history($1,true,true,true)',[target]),'42501');
  await denied(()=>history({userId:target,role:'owner',rankLevel:16}),'PT403');
  await denied(()=>history({userId:randomUUID()}),'PT403');
  checks.push('Search/history deny anonymous, missing/unconfirmed identities, direct helper execution and forged other-person permissions');

  await admin();const question=[{id:'hidden-q',text:'СЕКРЕТВОПРОС',options:['СЕКРЕТОТВЕТ','Нет'],correct:0,explanation:'СЕКРЕТПОЯСНЕНИЕ'}];
  const testIds=[];
  for(let i=0;i<23;i++){const id=randomUUID();testIds.push(id);await db.query('insert into knowledge_private.tests(id,owner_id,title,description,category,pass_mark,questions,published) values($1,$2,$3,$4,$5,80,$6,true)',[id,owner,'Поиск Ёлка',i===0?'Детальное описание %_':i===1?'Порядок задержания':'Поиск по метаданным','История поиска',JSON.stringify(question)]);}
  const draft=randomUUID();await db.query("insert into knowledge_private.tests(id,owner_id,title,category,pass_mark,questions,published) values($1,$2,'СЕКРЕТЧЕРНОВИК','Поиск',80,$3,false)",[draft,owner,JSON.stringify(question)]);
  await asUser(employee);let page=await search({query:'  ЕЛКА   поиск '});assert.equal(page.total,23);assert.equal(page.items.length,20);assert(page.nextCursor);
  const next=await search({query:'елка поиск',cursor:page.nextCursor});assert.equal(next.total,23);assert.equal(next.items.length,3);assert.equal(next.nextCursor,null);
  assert.equal(new Set([...page.items,...next.items].map(x=>x.id)).size,23);
  assert(page.items.every(x=>x.kind==='test'&&!x.questions&&!x.answers));
  assert.equal((await search({query:'задержание'})).total,1);assert.equal((await search({query:'%_'})).total,1);assert.equal((await search({query:'несуществующийнорматив'})).total,0);
  for(const uid of [employee,owner]){await asUser(uid);for(const query of ['СЕКРЕТВОПРОС','СЕКРЕТОТВЕТ','СЕКРЕТПОЯСНЕНИЕ','СЕКРЕТЧЕРНОВИК'])assert.equal((await search({query})).total,0);}
  const meta=await search({action:'test',id:testIds[0]});assert.equal(meta.id,testIds[0]);assert(!meta.questions&&!meta.answers);
  await denied(()=>search({action:'test',id:draft}),'PT404');
  await admin();await db.query('update knowledge_private.tests set published=false where id=$1',[testIds[0]]);
  await asUser(employee);await denied(()=>search({action:'test',id:testIds[0]}),'PT404');
  const materials=await search({query:'устав',kind:'material'});assert(materials.total>=1);assert(materials.items.every(x=>x.kind==='material'&&x.href&&!x.readAt));
  for(const payload of [{query:'x'},{query:'a'.repeat(101)},{query:null},{query:'поиск',kind:'all'},{query:'поиск',cursor:{id:1,title:'x'}},{action:'unknown'},[]])await denied(()=>search(payload),'PT400');
  checks.push('Search uses literal all-word metadata matching with е/ё, returns 20-row stable pages and training links, excludes drafts/questions/answers even for their author and rechecks publication before opening');

  await admin();const finished=new Date(Date.now()-86400000).toISOString();const ids=[];
  const addAttempt=async(mode='exam',done=true,testId=testIds[1])=>{const id=randomUUID();ids.push(id);await db.query('insert into knowledge_private.attempts(id,test_id,author_id,user_id,employee_name,test_title,pass_mark,questions,answers,total,score,started_at,finished_at,mode) values($1,$2,$3,$4,$5,$6,80,$7,$8,10,$9,$10,$11,$12)',[id,testId,owner,target,'Имя из снимка','Историческая проверка',JSON.stringify(question),JSON.stringify({'hidden-q':0}),done?8:null,new Date(Date.now()-2*86400000).toISOString(),done?finished:null,mode]);return id;};
  for(let i=0;i<23;i++)await addAttempt();await addAttempt('practice');await addAttempt('exam',false);
  const demo=(await db.query('select id from knowledge_private.tests where demo limit 1')).rows[0].id;await addAttempt('exam',true,demo);
  await db.query("insert into knowledge_private.management_events(actor_id,actor_login,area,operation,target_id,title,details,created_at) values($1,'Руководитель','department_members','promote',$2,'Повышение',$3,$4),($1,'Руководитель','service_clearances','update',$2,'Допуск',$5,$4),($1,'Руководитель','service_clearances','update',$2,'Допуск',$6,$4)",[captain,target,JSON.stringify({previousRank:'Рядовой',rank:'Сержант'}),finished,JSON.stringify({status:'approved',note:'ЛИЧНАЯЗАМЕТКА'}),JSON.stringify({status:'revoked',note:'Допуск отозван после проверки'})]);
  await asUser(target);page=await history({});assert.equal(page.total,26);assert.equal(page.items.length,20);assert(page.own);assert.deepEqual(page.permissions,{results:true,ranks:true,clearances:true,others:false});
  const rest=await history({snapshot:page.snapshot,cursor:page.nextCursor});assert.equal(rest.items.length,6);assert.equal(rest.nextCursor,null);
  assert.equal(new Set([...page.items,...rest.items].map(x=>x.id)).size,26);
  assert(!JSON.stringify(page).includes('СЕКРЕТ')&&!JSON.stringify(rest).includes('СЕКРЕТ'));
  const results=await history({kind:'result'});assert.equal(results.total,23);assert(results.items.every(x=>x.summary==='Зачёт · 8 из 10 · 80.0%'));
  assert.equal((await history({kind:'rank'})).total,1);assert.equal((await history({kind:'clearance'})).total,2);
  assert((await history({kind:'clearance'})).items.some(x=>x.title==='Допуск отозван'));
  checks.push('Own history preserves saved results and clearance decisions, excludes practice/demo/unfinished attempts, uses the saved pass threshold and paginates equal timestamps without lost events or answer leakage');

  await asUser(captain);page=await history({userId:target,canManageClearances:true});assert.equal(page.total,24);assert.deepEqual(page.permissions,{results:true,ranks:true,clearances:false,others:true});assert(!JSON.stringify(page).includes('ЛИЧНАЯЗАМЕТКА'));
  await denied(()=>history({userId:target,kind:'clearance'}),'PT403');
  for(const uid of [owner,deputy]){await asUser(uid);page=await history({userId:target,rankLevel:16});assert.equal(page.total,2);assert.deepEqual(page.permissions,{results:false,ranks:false,clearances:true,others:true});await denied(()=>history({userId:target,kind:'result'}),'PT403');await denied(()=>history({userId:target,kind:'rank'}),'PT403');}
  await admin();await db.query("update knowledge_private.department_members set active=false where user_id=$1",[target]);
  await asUser(captain);assert.equal((await history({userId:target})).total,24);
  await admin();await db.query("update knowledge_private.department_members set active=false where user_id=$1",[captain]);
  await asUser(captain);await denied(()=>history({userId:target}),'PT403');
  await admin();await db.query("update knowledge_private.department_members set active=true,rank='Рядовой' where user_id=$1",[captain]);
  await asUser(captain);await denied(()=>history({userId:target}),'PT403');
  await admin();await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[target]);
  await asUser(target);await denied(()=>history({}),'PT403');await denied(()=>search({query:'поиск'}),'PT403');
  checks.push('Other-person history separates captain results/promotions from owner/deputy clearance notes, preserves archived history and immediately rejects callers whose rank, active status or account access was removed');

  await asUser(owner);for(const payload of [{userId:'wrong'},{kind:'unknown'},{snapshot:'infinity'},{snapshot:'bad date'},{cursor:{at:'-infinity',id:'x'}},{cursor:{at:'bad',id:'x'}},null])await denied(()=>history(payload),'PT400');
  const initial=await history({userId:target,kind:'clearance'});
  await admin();await db.query("insert into knowledge_private.management_events(actor_login,area,operation,target_id,title,details,created_at) values('Руководитель','service_clearances','update',$1,'Новая заявка','{\"status\":\"pending\"}',now()+interval '1 second')",[target]);
  await asUser(owner);assert.equal((await history({userId:target,kind:'clearance',snapshot:initial.snapshot})).total,2);
  await admin();const fingerprint=async()=>(await db.query("select md5(string_agg(to_jsonb(t)::text,'|' order by id)) value from knowledge_private.management_events t")).rows[0].value;const before=await fingerprint();
  await asUser(owner);await search({query:'поиск'});await history({userId:target});await history({});await admin();assert.equal(await fingerprint(),before);
  checks.push('History validates filters, UUIDs and finite cursors, holds a snapshot across pages and both new RPCs read data without adding management events');
}

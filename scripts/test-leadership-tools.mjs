import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
export async function checkLeadershipTools({db,asUser,rpc,denied,checks}) {
  const captain=randomUUID(),employee=randomUUID(),owner=randomUUID(),other=randomUUID(),inactive=randomUUID(),unconfirmed=randomUUID(),banned=randomUUID();
  const admin=async()=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims','{}',false)");};
  const call=async(name,payload={})=>(await db.query('select public.'+name+'($1::jsonb) data',[JSON.stringify(payload)])).rows[0].data;
  const bulk=payload=>call('knowledge_bulk_assign',payload),analysis=payload=>call('knowledge_analysis',payload),card=payload=>call('knowledge_attestation',payload);
  await admin();for(const uid of [captain,employee,owner,other,inactive,unconfirmed,banned])await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[uid,uid+'@example.test',JSON.stringify({login:'Группа '+uid})]);
  for(const uid of [captain,employee,owner,other,inactive,unconfirmed,banned]){await asUser(uid);await rpc({});}
  await admin();await db.query("update knowledge_private.department_members set rank='Капитан' where user_id=$1",[captain]);await db.query("insert into knowledge_private.test_creators(user_id,role) values($1,'owner')",[owner]);
  await db.query('update knowledge_private.department_members set active=false where user_id=$1',[inactive]);await db.query('update auth.users set email_confirmed_at=null where id=$1',[unconfirmed]);await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[banned]);
  for(const [uid,role,code] of [[null,'anon','42501'],[null,'authenticated','PT401'],[unconfirmed,'authenticated','PT401'],[banned,'authenticated','PT403']]){await asUser(uid,role);for(const name of ['knowledge_bulk_assign','knowledge_analysis','knowledge_attestation'])await denied(()=>call(name,{}),code);}
  for(const uid of [employee,owner]){await asUser(uid);await denied(()=>bulk({rankLevel:16,role:'owner'}),'PT403');await denied(()=>analysis({rankLevel:16}),'PT403');}
  await asUser(employee);await denied(()=>card({userId:other,rankLevel:16}),'PT403');await denied(()=>db.query('select * from knowledge_private.bulk_assignment_requests'),'42501');
  checks.push('Bulk/analysis require a live confirmed captain; owner title and forged fields cannot elevate test permissions, anonymous/blocked/unconfirmed calls and private request-ledger reads are denied');

  await admin();const test=randomUUID(),questions=[{id:'q1',text:'Первый исторический вопрос',options:['PRIVATE_CORRECT','PRIVATE_WRONG'],correct:0},{id:'q2',text:'Второй исторический вопрос',options:['Да','Нет'],correct:1}];
  await db.query("insert into knowledge_private.tests(id,owner_id,title,category,pass_mark,questions,published,shuffle_questions,shuffle_answers,time_limit_minutes) values($1,$2,'Групповая проверка','Работа с документами',80,$3,true,true,true,15)",[test,owner,JSON.stringify(questions)]);
  await asUser(captain);const payload={testId:test,testVersion:1,userIds:[employee,other],dueAt:new Date(Date.now()+86400000).toISOString()};let preview=await bulk({action:'preview',...payload});assert.equal(preview.createCount,2);assert.equal(preview.skipCount,0);assert(!preview.test.questions);
  await admin();assert.equal((await db.query('select count(*) n from knowledge_private.assignments where test_id=$1',[test])).rows[0].n,0);assert.equal((await db.query('select count(*) n from knowledge_private.bulk_assignment_requests')).rows[0].n,0);
  await asUser(captain);await rpc({action:'assignTest',testId:test,login:preview.recipients.find(x=>x.userId===other).login,dueAt:payload.dueAt});
  preview=await bulk({action:'preview',...payload});assert.equal(preview.createCount,1);assert.equal(preview.skipCount,1);
  const requestId=randomUUID();let result=await bulk({action:'create',requestId,...payload});assert.equal(result.createdCount,1);assert.equal(result.skipCount,1);assert.equal(result.replayed,false);
  const repeated=await bulk({action:'create',requestId,...payload,userIds:[other,employee]});assert.equal(repeated.replayed,true);assert.deepEqual({...repeated,replayed:false},result);
  await denied(()=>bulk({action:'create',requestId,...payload,dueAt:new Date(Date.now()+172800000).toISOString()}),'PT409');
  await admin();const rows=(await db.query('select * from knowledge_private.assignments where test_id=$1',[test])).rows;assert.equal(rows.length,2);assert(rows.every(x=>x.time_limit_minutes===15&&x.shuffle_questions&&x.shuffle_answers&&x.test_version===1));for(const row of rows)assert.deepEqual(row.questions,questions);
  checks.push('Bulk preview writes nothing, commit skips live duplicates and creates snapshots atomically, retry with the same request and reordered IDs creates no extra rows and preserves timer/shuffle/version settings');

  await asUser(captain);for(const userId of [inactive,unconfirmed,banned,randomUUID()])await denied(()=>bulk({action:'create',requestId:randomUUID(),...payload,userIds:[employee,userId]}),'PT409');
  await denied(()=>bulk({action:'preview',...payload,testVersion:2}),'PT409');for(const bad of [{...payload,userIds:[]},{...payload,userIds:[employee,employee]},{...payload,userIds:['bad']},{...payload,dueAt:'infinity'},{...payload,dueAt:'2020-01-01T00:00:00Z'},{...payload,testVersion:1.5},{...payload,userIds:Array(101).fill(employee)}])await denied(()=>bulk({action:'preview',...bad}),'PT400');
  await admin();assert.equal((await db.query('select count(*) n from knowledge_private.bulk_assignment_requests')).rows[0].n,1);
  await db.query('update knowledge_private.tests set published=false where id=$1',[test]);await asUser(captain);await denied(()=>bulk({action:'preview',...payload}),'PT409');assert.equal((await bulk({action:'create',requestId,...payload})).replayed,true);
  await admin();await db.query('update knowledge_private.assignments set cancelled_at=now() where test_id=$1',[test]);await db.query('update knowledge_private.tests set published=true where id=$1',[test]);const version=(await db.query('select version from knowledge_private.tests where id=$1',[test])).rows[0].version;
  await asUser(captain);result=await bulk({action:'create',requestId:randomUUID(),...payload,testVersion:version});assert.equal(result.createdCount,2);
  await admin();assert.equal((await db.query('select count(*) n from knowledge_private.assignments where test_id=$1',[test])).rows[0].n,4);
  checks.push('Invalid or newly unavailable recipients roll the complete batch and ledger back; stale/unpublished tests are rejected, completed/cancelled history is preserved and an already committed retry stays idempotent after publication changes');

  await admin();const pageUsers=[];
  for(let i=0;i<103;i++){const uid=randomUUID();pageUsers.push(uid);await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[uid,uid+'@example.test',JSON.stringify({login:'Пагинация группы '+i})]);await asUser(uid);await rpc({});await admin();}
  await asUser(captain);const directory=await bulk({query:'Пагинация группы'});assert.equal(directory.total,103);assert.equal(directory.items.length,100);const next=await bulk({query:'Пагинация группы',cursor:directory.nextCursor});assert.equal(next.items.length,3);assert.equal(new Set([...directory.items,...next.items].map(x=>x.userId)).size,103);
  const all=await bulk({query:'Группа '});assert(!all.items.some(x=>[inactive,unconfirmed,banned].includes(x.userId)));assert(all.items.every(x=>!x.email));
  checks.push('Recipient directory only lists confirmed active unblocked members; literal search and 100-row keyset pages cover the full matching roster without exposing email');

  await admin();const historyTest=randomUUID();await db.query("insert into knowledge_private.tests(id,owner_id,title,category,pass_mark,questions,published) values($1,$2,'Анализ сохранённых вопросов','Документы',80,$3,true)",[historyTest,owner,JSON.stringify(questions)]);
  const exam=async(qs,answers={},score=0,extra={})=>{const id=randomUUID();await db.query("insert into knowledge_private.attempts(id,test_id,author_id,user_id,employee_name,test_title,pass_mark,questions,answers,total,score,started_at,finished_at,mode) values($1,$2,$3,$4,'Сохранённое имя','Анализ сохранённых вопросов',80,$5,$6,$7,$8,now()-interval '2 hours',$9,$10)",[id,extra.testId||historyTest,owner,employee,JSON.stringify(qs),JSON.stringify(answers),qs.length,extra.unfinished?null:score,extra.unfinished?null:new Date(Date.now()-(extra.old?100:0)*86400000-3600000).toISOString(),extra.mode||'exam']);return id;};
  const qa=[{id:'shared',text:'Общий вопрос',options:['PRIVATE_CORRECT','PRIVATE_WRONG'],correct:0}];await exam(qa,{shared:0},1);
  await exam([{...qa[0],options:['PRIVATE_WRONG','PRIVATE_CORRECT'],correct:1}],{shared:0},0);
  await db.query("update knowledge_private.tests set questions=$2 where id=$1",[historyTest,JSON.stringify([{...qa[0],text:'Изменённый вопрос'}])]);await exam([{...qa[0],text:'Изменённый вопрос'}],{},0);
  await exam(qa,{shared:0},1,{mode:'practice'});await exam(qa,{},0,{unfinished:true});await exam(qa,{},0,{old:true});
  const demo=(await db.query('select id from knowledge_private.tests where demo limit 1')).rows[0].id;await exam(qa,{},0,{testId:demo});
  await asUser(captain);let data=await analysis({testId:historyTest,days:7});assert.deepEqual(data.summary,{exams:3,seen:3,wrong:2,unanswered:1,errorRate:66.7});assert.equal(data.totalQuestions,2);assert.equal(data.questions.find(x=>x.text==='Общий вопрос').seen,2);assert.equal(data.questions.find(x=>x.text==='Общий вопрос').errorRate,50);assert.equal(data.questions.find(x=>x.text==='Изменённый вопрос').unanswered,1);
  assert(!JSON.stringify(data).includes('PRIVATE_CORRECT')&&!JSON.stringify(data).includes('PRIVATE_WRONG'));assert(data.questions.every(x=>!x.options&&!x.correct&&!x.answers));assert.equal(data.topics[0].name,'Документы');assert.equal(data.topics[0].exams,3);
  await admin();const pagesTest=randomUUID();const many=Array.from({length:23},(_,i)=>({id:'many-'+i,text:'Вопрос страницы '+i,options:['Да','Нет'],correct:0}));await db.query("insert into knowledge_private.tests(id,owner_id,title,category,pass_mark,questions,published) values($1,$2,'Страницы анализа','Документы',80,$3,true)",[pagesTest,owner,JSON.stringify(many)]);await exam(many,{},0,{testId:pagesTest});
  await asUser(captain);data=await analysis({testId:pagesTest});const more=await analysis({testId:pagesTest,snapshot:data.snapshot,offset:data.nextOffset});assert.equal(data.questions.length,20);assert.equal(more.questions.length,3);assert.equal(more.nextOffset,null);assert.equal(new Set([...data.questions,...more.questions].map(x=>x.id)).size,23);
  for(const payload of [{days:1},{testId:1},{offset:-1},{snapshot:'infinity'},{snapshot:null},{snapshot:'bad'},[]])await denied(()=>analysis(payload),'PT400');
  checks.push('Error analysis grades saved shuffled answers correctly, splits changed revisions, counts unanswered questions, excludes unfinished/practice/demo/old records and returns only aggregate question text with snapshot paging');

  await asUser(employee);data=await card({});assert(data.own&&data.permissions.results&&data.permissions.clearance);assert.equal(data.results.filter(x=>x.testId===historyTest).length,1);assert.equal(data.results.find(x=>x.testId===historyTest).score,0);assert(!JSON.stringify(data).includes('PRIVATE_CORRECT'));assert(!JSON.stringify(data).includes('questions')&&!JSON.stringify(data).includes('answers')&&!JSON.stringify(data).includes('@example.test'));
  await asUser(captain);data=await card({userId:employee,canManageClearances:true});assert(data.results);assert.equal(data.clearance,null);
  await asUser(owner);data=await card({userId:employee,rankLevel:16});assert.equal(data.results,null);assert(data.clearance);assert(!data.clearance.tests);
  await admin();await db.query('update knowledge_private.department_members set active=false where user_id=$1',[employee]);await asUser(captain);data=await card({userId:employee});assert.equal(data.person.active,false);assert(data.results.length>0);
  await admin();const before=(await db.query('select count(*) n from knowledge_private.management_events')).rows[0].n;await asUser(captain);await analysis({});await card({});await bulk({});await admin();assert.equal((await db.query('select count(*) n from knowledge_private.management_events')).rows[0].n,before);
  await db.query("update knowledge_private.department_members set rank='Рядовой' where user_id=$1",[captain]);await asUser(captain);await denied(()=>bulk({}),'PT403');await denied(()=>analysis({}),'PT403');await denied(()=>card({userId:employee}),'PT403');
  await asUser(owner);await denied(()=>card({userId:'bad'}),'PT400');await denied(()=>card({userId:randomUUID()}),'PT404');
  checks.push('Attestation reads one latest saved exam per test, preserves archived results, separates captain result rights from owner/deputy clearance rights and all reports/directory reads create no audit records; demotion takes effect immediately');
}

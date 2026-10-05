import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

export async function checkSupport({ db, asUser, denied, checks }) {
  const A=randomUUID(), B=randomUUID(), C=randomUUID(), unconfirmed=randomUUID(), test=randomUUID(), attempt=randomUUID(), report=randomUUID();
  const admin=async()=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims','{}',false)");};
  const call=async payload=>(await db.query('select public.knowledge_support($1::jsonb) data',[JSON.stringify(payload)])).rows[0].data;
  const train=async payload=>(await db.query('select public.knowledge_training($1::jsonb) data',[JSON.stringify(payload)])).rows[0].data;
  await admin();
  for(const id of [A,B,C,unconfirmed])await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,id+'@example.test',JSON.stringify({login:'Обратная связь '+id})]);
  await db.query('update auth.users set email_confirmed_at=null where id=$1',[unconfirmed]);
  await db.query("insert into knowledge_private.test_creators(user_id,role) values ($1,'owner')",[A]);
  const questions=[{id:'q1',text:'Проверяем контекст вопроса',options:['Секретный ответ','Другой'],correct:0,explanation:'СЕКРЕТНОЕ ОБОСНОВАНИЕ'}];
  await db.query("insert into knowledge_private.tests(id,owner_id,title,category,pass_mark,questions,published) values($1,$2,'Проверка сообщений','Тест',80,$3,true)",[test,A,JSON.stringify(questions)]);
  await db.query("insert into knowledge_private.attempts(id,test_id,author_id,user_id,employee_name,test_title,pass_mark,questions,total) values($1,$2,$3,$4,'Сотрудник','Проверка сообщений',80,$5,1)",[attempt,test,A,B,JSON.stringify(questions)]);
  await asUser(null,'anon');await denied(()=>call({}),'42501');
  await asUser(null);await denied(()=>call({}),'PT401');
  await asUser(unconfirmed);await denied(()=>call({}),'PT401');
  await asUser(B);await denied(()=>db.query('select * from knowledge_private.content_reports'),'42501');await denied(()=>db.query('select * from knowledge_private.rule_update_reads'),'42501');
  const create={action:'create',id:report,kind:'question',attemptId:attempt,questionId:'q1',description:'Непонятна формулировка задания.',authorId:A,context:{text:'Поддельный текст',correct:0}};
  assert.equal((await call(create)).id,report);assert.equal((await call(create)).id,report);
  let page=await call({userId:A});assert.equal(page.total,1);assert.equal(page.items[0].context.text,questions[0].text);assert.equal(page.items[0].context.testId,test);
  assert(!JSON.stringify(page).includes('СЕКРЕТНОЕ'));assert(!JSON.stringify(page).includes('Секретный ответ'));assert(!JSON.stringify(page).includes('correct'));assert(!JSON.stringify(page).includes('Поддельный'));
  await denied(()=>call({...create,id:randomUUID(),questionId:'q2'}),'PT404');await denied(()=>call({scope:'team',role:'owner'}),'PT403');await denied(()=>call({action:'review',id:report,status:'resolved',version:1,response:'Исправлено описание.'}),'PT403');
  await asUser(C);assert.equal((await call({})).total,0);await denied(()=>call(create),'PT404');await denied(()=>call({...create,id:randomUUID()}),'PT404');
  checks.push('Feedback derives the question from the caller’s attempt, ignores forged context/identity, reveals no answer keys and cannot be read/reviewed by other employees');
  await asUser(A);page=await call({scope:'team'});assert.equal(page.items[0].id,report);
  await call({action:'review',id:report,version:1,status:'in_review',response:''});
  await denied(()=>call({action:'review',id:report,version:1,status:'resolved',response:'Исправлено описание.'}),'PT409');
  await denied(()=>call({action:'review',id:report,version:2,status:'resolved',response:'ok'}),'PT400');
  await call({action:'review',id:report,version:2,status:'resolved',response:'Исправлено описание задания.'});
  await asUser(B);page=await call({status:'resolved'});assert.equal(page.items[0].status,'resolved');assert.equal(page.items[0].version,3);assert.equal(page.items[0].response,'Исправлено описание задания.');
  await call({action:'create',id:randomUUID(),kind:'law',document:'procedure',article:'article-53',description:'Проверка сообщения об актуальной норме.'});
  await denied(()=>call({action:'create',id:randomUUID(),kind:'law',document:'procedure',article:'article-99999999',description:'Проверка несуществующей нормы.'}),'PT404');
  await call({action:'create',id:randomUUID(),kind:'law',document:'state-organizations',article:'point-1.8',description:'Проверка сообщения о пункте правил.'});
  await denied(()=>call({action:'create',id:randomUUID(),kind:'law',document:'state-organizations',article:'https://bad.test',description:'Проверка неверного номера правил.'}),'PT400');
  checks.push('Managers review with optimistic versions and a required closing answer; submitters track decisions; unknown/retired law references cannot be reported');
  for(let i=0;i<7;i++)await call({...create,id:randomUUID()});
  await denied(()=>call({...create,id:randomUUID()}),'PT429');assert.equal((await call(create)).id,report);
  const revision='procedure-'+'a'.repeat(24);
  await call({action:'markRules',ids:[revision,revision],userId:C});assert.deepEqual((await call({action:'ruleReads'})).ids,[revision]);
  await asUser(C);assert.deepEqual((await call({action:'ruleReads'})).ids,[]);
  await denied(()=>call({action:'markRules',ids:['../../account']}),'PT400');await denied(()=>call({action:'markRules',ids:[]}),'PT400');await denied(()=>call({action:'markRules',ids:[7]}),'PT400');
  await admin();await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[B]);
  await asUser(B);await denied(()=>call({}),'PT403');await denied(()=>call({action:'markRules',ids:[revision]}),'PT403');
  checks.push('Report retries are idempotent, hourly submissions are bounded, rule read states persist independently per account, malformed read keys and blocked users are denied');
  await admin();
  const scenarios=JSON.parse(fs.readFileSync(new URL('../lib/practical-scenarios.json',import.meta.url)));
  for(const scenario of scenarios){
    assert.deepEqual((await db.query('select graph from knowledge_private.rp_scenarios where id=$1',[scenario.id])).rows[0].graph,scenario.graph);
    for(const node of Object.values(scenario.graph.nodes))for(const choice of node.choices){
      const link=new URLSearchParams(choice.reference.href.split('?')[1]);
      const doc=JSON.parse(fs.readFileSync(new URL('../public/laws/'+link.get('document')+'.json',import.meta.url)));
      assert(doc.entries.some(entry=>entry.id===link.get('article')&&entry.kind==='article'));
      assert(choice.next===null||scenario.graph.nodes[choice.next]);
    }
    await asUser(C);let run=await train({action:'startScenario',scenarioId:scenario.id});assert(!JSON.stringify(run.node).includes('correct'));assert(!JSON.stringify(run.node).includes('feedback'));
    for(let step=0;run.node&&step<10;step++){const node=scenario.graph.nodes[run.node.id];const choice=node.choices.find(item=>item.correct);run=await train({action:'chooseScenario',id:run.id,nodeId:run.node.id,choiceId:choice.id});}
    assert(run.finishedAt);assert(run.history.every(item=>item.correct));
    const fresh=await train({action:'startScenario',scenarioId:scenario.id});assert.notEqual(fresh.id,run.id);
    await asUser(A);await denied(()=>train({op:'scenarioRun',id:run.id}),'PT404');await admin();
  }
  checks.push('Both new practice scenarios contain valid current article links, hide decisions until chosen, finish via real RPC and keep saved runs private');
}

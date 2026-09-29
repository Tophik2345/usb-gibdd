import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const root=resolve(import.meta.dirname,'..');
const db=new PGlite();
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const C='33333333-3333-4333-8333-333333333333';
const checks=[];
await db.exec(`create role anon; create role authenticated; create schema auth;
create table auth.users(id uuid primary key);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
grant usage on schema auth to authenticated, anon;
insert into auth.users values ('${A}'),('${B}'),('${C}');`);
for(const file of fs.readdirSync(resolve(root,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()) await db.exec(fs.readFileSync(resolve(root,'supabase/migrations',file),'utf8'));
async function asUser(uid,role='authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(uid?{sub:uid,email:uid+'@example.test',user_metadata:{full_name:'Сотрудник'}}:{})]);
  await db.exec('set role '+role);
}
async function rpc(payload) { return (await db.query('select public.knowledge_workspace($1::jsonb) as data',[JSON.stringify(payload)])).rows[0].data; }
async function denied(action,code){await assert.rejects(action,e=>{assert.equal(e.code,code,e.message);return true;});}
const base={action:'saveTest',title:'Рабочий тест',description:'Описание',category:'Знания',passMark:70,published:true,questions:[{text:'Первый вопрос',options:['Верно','Неверно'],correct:0,explanation:'Обоснование'},{text:'Второй вопрос',options:['Да','Нет'],correct:1,explanation:''}]};
try {
  await asUser(null,'anon'); await denied(()=>rpc({}),'42501');
  await asUser(null); await denied(()=>rpc({}),'PT401'); checks.push('Anonymous and missing-identity calls denied');
  await asUser(A); await denied(()=>db.query('select * from knowledge_private.tests'),'42501'); await denied(()=>db.query('select * from knowledge_private.attempts'),'42501');
  await denied(()=>db.query("select knowledge_private.questions_checked('[]'::jsonb)"),'42501'); checks.push('Private tables and helper functions cannot be called directly');
  const {id}=await rpc(base);
  const {id:draft}=await rpc({...base,title:'Черновик',published:false});
  const catalog=await rpc({});assert.equal(catalog.managed.length,2);assert.equal(catalog.tests.length,2);assert(catalog.tests.every(x=>!('questions' in x)));
  const authorTest=await rpc({op:'test',id});assert.equal(authorTest.questions[0].correct,0);checks.push('Author can edit own tests; catalog never discloses answer keys');
  await asUser(B);const employee=await rpc({});assert.equal(employee.managed.length,0);assert(!employee.tests.some(t=>t.id===draft));
  await denied(()=>rpc({op:'test',id}),'PT404');await denied(()=>rpc({...base,id,ownerId:A}),'PT403');await denied(()=>rpc({action:'start',testId:draft,employeeName:'Сотрудник'}),'PT404');checks.push('Draft privacy and ownership checks enforced inside database');
  const attempt=await rpc({action:'start',testId:id,employeeName:'Сотрудник',userId:A});
  assert(attempt.questions.every(q=>!('correct' in q)&&!('explanation' in q)));
  const again=await rpc({action:'start',testId:id,employeeName:'Сотрудник'});assert.equal(again.id,attempt.id);checks.push('Only one active attempt; answer keys withheld until completion');
  await denied(()=>rpc({action:'submit',id:attempt.id,score:2}),'PT400');
  await denied(()=>rpc({action:'answer',id:attempt.id,questionId:attempt.questions[0].id,choice:99}),'PT400');
  await rpc({action:'answer',id:attempt.id,questionId:attempt.questions[0].id,choice:0});
  assert.equal((await rpc({op:'attempt',id:attempt.id})).answers[attempt.questions[0].id],0);checks.push('Each answer persists; invalid and incomplete submissions are rejected');
  await asUser(A);await rpc({...base,id,passMark:100,questions:[{text:'Изменённый вопрос',options:['Один','Два'],correct:1,explanation:''}]});
  await asUser(B);await rpc({action:'answer',id:attempt.id,questionId:attempt.questions[1].id,choice:0});
  const result=await rpc({action:'submit',id:attempt.id,score:2,total:2,passMark:1});assert.equal(result.score,1);assert.equal(result.passMark,70);assert.equal(result.total,2);assert(result.finishedAt);assert.equal(result.questions[0].correct,0);
  assert.equal((await rpc({action:'submit',id:attempt.id})).finishedAt,result.finishedAt);
  await denied(()=>rpc({action:'answer',id:attempt.id,questionId:attempt.questions[1].id,choice:1}),'PT409');checks.push('Server computes grade from immutable snapshot and ignores supplied scores');
  await asUser(C);await denied(()=>rpc({op:'attempt',id:attempt.id}),'PT404');await denied(()=>rpc({action:'answer',id:attempt.id,questionId:attempt.questions[0].id,choice:1}),'PT404');assert.equal((await rpc({})).team.length,0);checks.push('Unrelated users cannot see or change attempts');
  await asUser(A);const team=await rpc({});assert.equal(team.team.length,1);assert.equal(team.team[0].score,1);assert.equal(team.attempts.length,0);checks.push('Completed team results visible to test author only');
  await denied(()=>rpc({...base,questions:[{text:'Дубликаты вариантов',options:['Да','да'],correct:0}]}),'PT400');
  await denied(()=>rpc({...base,passMark:-1}),'PT400');await denied(()=>rpc({...base,questions:[]}),'PT400');await denied(()=>rpc({...base,questions:[{text:'Нет правильного',options:['Да','Нет'],correct:2}]}),'PT400');checks.push('Test validation enforced in SQL');
  await db.exec('reset role');const rls=(await db.query("select relrowsecurity from pg_class where oid in ('knowledge_private.tests'::regclass,'knowledge_private.attempts'::regclass)")).rows;assert(rls.every(x=>x.relrowsecurity));checks.push('RLS enabled on every application table');
  console.log(JSON.stringify({passed:checks.length,checks,scope:'Actual PostgreSQL engine (PGlite), migrations, database roles and RPC; Auth JWT claims mocked locally'},null,2));
} finally {await db.close();}

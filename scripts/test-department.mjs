import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';

export async function checkDepartment({db,asUser,denied,A,B,C,checks}) {
  const api=async payload=>(await db.query('select public.knowledge_department($1::jsonb) as data',[JSON.stringify(payload)])).rows[0].data;
  const D='44444444-4444-4444-8444-444444444444';
  const member={action:'saveMember',login:'Другой сотрудник',displayName:'Игровое Имя',staticId:'77611',rank:'',position:'Сотрудник УСБ',bio:'Служебная информация',active:true,sortOrder:100};
  const complaint={action:'createAppeal',id:randomUUID(),kind:'complaint',subject:'Проверка служебной ситуации',body:'Описание событий для локальной проверки прав и работы обращений.',evidence:['https://example.com/proof']};
  await db.exec('reset role');
  await db.query("insert into knowledge_private.test_creators(user_id,role) values($1,'owner'),($2,'author'),($3,'deputy') on conflict(user_id) do update set role=excluded.role",[A,B,C]);
  await asUser(null,'anon'); await denied(()=>api({op:'staff'}),'42501');
  await asUser(null); await denied(()=>api({op:'staff'}),'PT401');
  await asUser(B);
  for(const table of ['department_members','department_appeals','department_appeal_events']) {
    await denied(()=>db.query(`select * from knowledge_private.${table}`),'42501');
    await denied(()=>db.query(`delete from knowledge_private.${table}`),'42501');
  }
  await denied(()=>api(member),'PT403'); await denied(()=>api({op:'manageStaff'}),'PT403');
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:B,user_metadata:{role:'owner'},app_metadata:{role:'owner'}})]);
  await denied(()=>api({...member,role:'owner'}),'PT403');
  checks.push('Department requires confirmed identity; private tables and staff management reject guests, authors and forged role metadata');

  await asUser(A);
  await denied(()=>api({...member,login:'Не существует'}),'PT404');
  const added=await api(member); assert.equal(added.userId,B); assert.equal(added.version,1);
  await denied(()=>api(member),'PT409');
  await api({...member,login:'Новый Логин 123',displayName:'Новый сотрудник',staticId:'80000'});
  const first=(await api({op:'staff'})).members;
  assert.equal(first.length,2); assert(first.every(x=>!('email' in x)&&!('attempts' in x)&&!('login_key' in x)));
  await db.exec('reset role');
  assert.equal((await db.query('select role from knowledge_private.test_creators where user_id=$1',[B])).rows[0].role,'author');
  assert.equal((await db.query('select * from knowledge_private.test_creators where user_id=$1',[D])).rows.length,0);
  await asUser(C);
  await api({...member,userId:B,version:1,active:false});
  assert.equal((await api({op:'staff'})).members.length,1);
  assert.equal((await api({op:'manageStaff'})).members.length,2);
  await denied(()=>api({...member,userId:B,version:1}),'PT409');
  await asUser(B); assert(!(await api({op:'staff'})).members.some(x=>x.userId===B));
  await asUser(A); await api({...member,userId:B,version:2,active:true,position:'Начальник (игровая должность)'});
  await denied(()=>api({...member,userId:B,version:3,staticId:'abc'}),'PT400');
  await denied(()=>api({...member,userId:B,version:3,sortOrder:1001}),'PT400');
  await asUser(B); await denied(()=>api({...member,userId:B,version:3}),'PT403');
  checks.push('Owner/deputy manage confirmed roster, archive/restore and edit conflicts; profiles omit private data and positions never grant access');

  await asUser(B);
  for(const payload of [{...complaint,evidence:[]},{...complaint,evidence:'https://example.com'},{...complaint,evidence:Array(6).fill('https://example.com')},{...complaint,kind:'admin'},{...complaint,body:'Коротко'},{...complaint,subject:'x'.repeat(161)},{...complaint,body:'x'.repeat(12001)},[],null]) await denied(()=>api(payload),'PT400');
  for(const url of ['javascript:alert(1)','data:text/html,hello','http://example.com','https://user:pass@example.com','https://example.com:99999/','https://example.com/\nattack','https://example.com/\\attack']) await denied(()=>api({...complaint,evidence:[url]}),'PT400');
  const created=await api({...complaint,userId:A,authorId:A,status:'resolved',role:'owner'});
  assert.equal(created.id,complaint.id); assert.equal((await api(complaint)).id,created.id);
  const own=await api({op:'appeal',id:created.id}); assert.equal(own.authorLogin,'другой сотрудник'); assert.equal(own.status,'new'); assert.equal(own.history.length,1);
  assert.equal((await api({op:'appeals',scope:'mine',userId:A})).total,1);
  await denied(()=>api({op:'appeals',scope:'team'}),'PT403');
  await denied(()=>api({action:'reviewAppeal',id:created.id,status:'resolved',version:1,response:'Чужой ответ заявителя'}),'PT403');
  await asUser(D); assert.equal((await api({op:'appeals'})).total,0);
  await denied(()=>api({op:'appeal',id:created.id}),'PT404'); await denied(()=>api(complaint),'PT404');
  await api({...complaint,id:randomUUID(),kind:'question',evidence:[]});
  checks.push('Appeals validate evidence and text; retry is idempotent; author/status spoofing and cross-account reads or reviews fail');

  await asUser(C); assert.equal((await api({op:'appeals',scope:'team'})).total,2);
  const inReview=await api({action:'reviewAppeal',id:created.id,status:'in_review',version:1,response:'Проверка начата.'}); assert.equal(inReview.version,2);
  await asUser(A); await denied(()=>api({action:'reviewAppeal',id:created.id,status:'resolved',version:1,response:'Устаревшее решение'}),'PT409');
  await denied(()=>api({action:'reviewAppeal',id:created.id,status:'resolved',version:2,response:''}),'PT400');
  await denied(()=>api({action:'reviewAppeal',id:created.id,status:'admin',version:2,response:''}),'PT400');
  const closed=await api({action:'reviewAppeal',id:created.id,status:'resolved',version:2,response:'Проверка завершена, обстоятельства выяснены.'});
  assert.equal(closed.status,'resolved'); assert.equal(closed.history.length,3);
  await denied(()=>api({action:'reviewAppeal',id:created.id,status:'rejected',version:3,response:'Попытка переписать закрытое решение'}),'PT400');
  await asUser(B); assert.equal((await api({op:'appeal',id:created.id})).response,closed.response);
  await asUser(C); const reopened=await api({action:'reviewAppeal',id:created.id,status:'in_review',version:3,response:'Получены новые сведения.'});
  assert.equal(reopened.history[2].response,closed.response); assert.equal(reopened.history[3].actorLogin,'третий сотрудник');
  assert.equal((await api({op:'appeals',scope:'team',status:'in_review'})).total,1);
  for(const payload of [{op:'appeals',scope:'everyone'},{op:'appeals',status:'invalid'},{op:'appeals',offset:-1},{op:'appeal',id:'bad'}])await denied(()=>api(payload),'PT400');
  checks.push('Leadership reviews enforce versions and responses; status filters, closure/reopening and immutable history are visible to the author');

  await asUser(B);
  for(let i=0;i<9;i++)await api({...complaint,id:randomUUID()});
  await denied(()=>api({...complaint,id:randomUUID()}),'PT429');
  assert.equal((await api(complaint)).id,created.id);
  await db.exec('reset role');
  // Local fixture only: exercise pagination without bypassing production submission limits.
  await db.query("insert into knowledge_private.department_appeals(id,author_id,author_login,kind,subject,body) select gen_random_uuid(),$1,'fixture','question','Тест страницы','Достаточное описание для проверки пагинации.' from generate_series(1,21)",[C]);
  await asUser(A);const page1=await api({op:'appeals',scope:'team'}),page2=await api({op:'appeals',scope:'team',offset:20});
  assert.equal(page1.appeals.length,20); assert.equal(page2.appeals.length,12); assert.equal(page1.total,32);
  assert(page2.appeals.every(item=>!page1.appeals.some(first=>first.id===item.id)));
  await db.exec('reset role'); await db.query('delete from knowledge_private.test_creators where user_id=$1',[C]);
  await asUser(C);await denied(()=>api({op:'appeals',scope:'team'}),'PT403');await denied(()=>api({op:'manageStaff'}),'PT403');
  await denied(()=>api({op:'appeal',id:created.id}),'PT404');
  await db.exec('reset role'); await db.query('update auth.users set email_confirmed_at=null where id=$1',[B]);
  await asUser(B);for(const op of ['staff','appeals','createAppeal'])await denied(()=>api({op}),'PT401');
  await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=now() where id=$1',[B]);
  const tables=(await db.query("select relrowsecurity from pg_class where relname in ('department_members','department_appeals','department_appeal_events') and relnamespace='knowledge_private'::regnamespace")).rows;
  assert.equal(tables.length,3);assert(tables.every(table=>table.relrowsecurity));
  const privilege=(await db.query("select has_function_privilege('anon','knowledge_private.department(jsonb)','execute') as anon,prosecdef,proconfig from pg_proc where oid='public.knowledge_department(jsonb)'::regprocedure")).rows[0];
  assert.equal(privilege.anon,false);assert.equal(privilege.prosecdef,false);assert(privilege.proconfig.includes('search_path=""'));
  checks.push('Submission throttling, stable pagination, immediate role revocation, email confirmation and RLS/function boundaries hold');

  const source=fs.readFileSync(new URL('../lib/report-templates.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  const {buildReport,reportKinds}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
  const draft={author:'Имя Фамилия 123',recipient:'Руководитель',date:'2026-09-30',period:'18:00–20:00',place:'Тестовое место',basis:'Поручение',participants:'Участник 456',actions:'Действие 1\nДействие 2',findings:'Подтверждённый факт',evidence:'https://example.com/video',conclusion:'Вывод по материалам'};
  for(const kind of Object.keys(reportKinds)){const result=buildReport(kind,draft);assert(result.includes(reportKinds[kind].title));for(const [key,value] of Object.entries(draft))if(key!=='date')assert(result.includes(value));assert(result.includes('30.09.2026'));assert(result.includes('(МСК)'));}
  const empty=Object.fromEntries(Object.keys(draft).map(key=>[key,'']));assert(buildReport('check',empty).includes('[изложите подтверждённые факты]'));
  checks.push('All report templates preserve entered facts, evidence and multiline text, format dates, label Moscow time and mark unfilled fields');
}

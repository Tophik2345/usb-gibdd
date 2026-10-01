import assert from 'node:assert/strict';
export async function checkResults({db,asUser,rpc,denied,A,B,base,checks}){
 const F='f7777777-7777-4777-8777-777777777777';
 const results=async payload=>(await db.query('select public.knowledge_results($1::jsonb) data',[JSON.stringify(payload)])).rows[0].data;
 await db.exec('reset role');await db.query("insert into auth.users(id,email,raw_user_meta_data) values ($1,'export-fixture@example.test','{\"login\":\"Экспорт сотрудник\"}')",[F]);
 await asUser(A);const saved=await rpc({...base,title:'Экспорт тестов'});
 await asUser(F);let attempt=await rpc({action:'start',testId:saved.id,employeeName:'Сотрудник Экспорт'});
 for(const [i,q] of attempt.questions.entries())await rpc({action:'answer',id:attempt.id,questionId:q.id,choice:i});
 attempt=await rpc({action:'submit',id:attempt.id});
 await db.exec('reset role');
 await db.query("update knowledge_private.attempts set finished_at='2026-09-30T21:00:00Z',score=1 where id=$1",[attempt.id]);
 await db.query(`insert into knowledge_private.attempts(id,test_id,author_id,user_id,employee_name,test_title,pass_mark,questions,answers,started_at,finished_at,score,total)
 select 'export-fixture-'||n,test_id,author_id,user_id,employee_name,test_title,pass_mark,questions,answers,started_at,'2026-09-30T21:00:00Z',score,total from knowledge_private.attempts cross join generate_series(1,504) n where id=$1`,[attempt.id]);
 await asUser(null,'anon');await denied(()=>results({}),'42501');
 await asUser(B);assert.equal((await results({testId:saved.id})).total,0);
 assert.equal((await results({scope:'team',testId:saved.id,userId:A,authorId:A,role:'owner'})).total,0);
 await asUser(F);let first=await results({from:'2026-10-01',to:'2026-10-01',minScore:50,maxScore:50,employee:'СОТРУДНИК   ЭКСПОРТ'});
 assert.equal(first.total,505);assert.equal(first.rows.length,100);assert(first.rows.every(r=>!('questions' in r)&&!('answers' in r)));
 const ids=new Set();let current=first;
 while(true){for(const row of current.rows){assert(!ids.has(row.id));ids.add(row.id);}if(!current.nextCursor)break;current=await results({snapshot:first.snapshot,cursor:current.nextCursor});}
 assert.equal(ids.size,505);assert.equal((await results({from:'2026-09-30',to:'2026-09-30'})).total,0);
 assert.equal((await results({status:'passed'})).total,0);assert.equal((await results({status:'failed'})).total,505);assert.equal((await results({scope:'practice'})).total,0);
 for(const filter of [{scope:'all'},{from:'2026-02-29'},{from:'2026-10-02',to:'2026-10-01'},{minScore:101},{minScore:60,maxScore:50},{snapshot:'infinity'},{cursor:{id:'x'}}])await denied(()=>results(filter),'PT400');
 await asUser(A);assert.equal((await results({scope:'team',testId:saved.id})).total,505);
 await db.exec('reset role');await db.query('update auth.users set banned_until=now()+interval \'1 day\' where id=$1',[F]);
 await asUser(F);await denied(()=>results({}),'PT403');await db.exec('reset role');await db.query('update auth.users set banned_until=null,email_confirmed_at=null where id=$1',[F]);
 await asUser(F);await denied(()=>results({}),'PT401');
 checks.push('Results export is private to participant/author, omits answers, rejects forged identities and blocked/unconfirmed sessions');
 checks.push('Result filters use Moscow day boundaries, exact score/status and validated ranges; stable cursor pagination exports all 505 rows with identical timestamps');
}

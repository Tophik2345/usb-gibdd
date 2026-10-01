import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function checkRankTestPermissions({db,asUser,rpc,denied,base,checks}) {
  const colonel=randomUUID(),other=randomUUID(),captain=randomUUID(),low=randomUUID(),employee=randomUUID();
  const logins=new Map([[colonel,'Полковник Контроля'],[other,'Автор Исходный'],[captain,'Капитан Контроля'],[low,'Старший Лейтенант Контроля'],[employee,'Сотрудник Контроля']]);
  const editor=async p=>(await db.query('select public.knowledge_editor($1::jsonb) data',[JSON.stringify(p)])).rows[0].data;
  const results=async p=>(await db.query('select public.knowledge_results($1::jsonb) data',[JSON.stringify(p)])).rows[0].data;
  const deadline=()=>new Date(Date.now()+86400_000).toISOString();
  const rank=async(uid,title)=>{await db.exec('reset role');await db.query('update knowledge_private.department_members set rank=$2,version=version+1 where user_id=$1',[uid,title]);await asUser(uid);};
  const row=async(table,id)=>{await db.exec('reset role');return (await db.query(`select to_jsonb(t) data from knowledge_private.${table} t where id=$1`,[id])).rows[0].data;};
  const finish=async attempt=>{
    for(const q of attempt.questions)await rpc({action:'answer',id:attempt.id,questionId:q.id,choice:q.text==='Первый вопрос'?0:1});
    return rpc({action:'submit',id:attempt.id});
  };
  await db.exec('reset role');
  for(const [uid,login] of logins)await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[uid,uid+'@example.test',JSON.stringify({login,rank:'Генерал',role:'owner'})]);
  for(const [uid] of logins){await asUser(uid);await rpc({});}
  await rank(colonel,'Полковник');await rank(other,'Полковник');await rank(captain,'Капитан');await rank(low,'Старший лейтенант');
  await db.exec('reset role');await db.query("insert into knowledge_private.test_creators(user_id,role) values($1,'owner')",[low]);
  await asUser(low);let permissions=(await rpc({})).permissions;
  assert.equal(permissions.canManageCreators,true);assert.equal(permissions.canCreateTests,false);assert.equal(permissions.canAssignTests,false);
  await denied(()=>rpc({...base,role:'owner',rank:'Генерал',rankLevel:16}),'PT403');
  await denied(()=>editor({action:'list',role:'owner'}),'PT403');
  await denied(()=>rpc({action:'assignTest',testId:'anything',login:logins.get(employee),dueAt:deadline()}),'PT403');
  await denied(()=>results({scope:'all',rankLevel:16}),'PT403');await denied(()=>results({scope:'team'}),'PT403');
  for(const operation of ['resetAssignment','cancelAssignment','rescheduleAssignment'])await denied(()=>rpc({action:operation,id:'anything',version:1,dueAt:deadline()}),'PT403');
  assert.deepEqual((await rpc({})).assignedTeam,[]);assert.deepEqual((await rpc({})).team,[]);assert.deepEqual((await rpc({})).managed,[]);
  checks.push('Rank 8 cannot manage assignments, view other results or edit tests, even with owner grants or forged metadata; unrelated owner permissions remain intact');

  await asUser(other);const source=await rpc({...base,title:'Чужой тест для контроля',shuffleQuestions:false,shuffleAnswers:false,timeLimitMinutes:null});
  const hidden=await rpc({...base,title:'Закрытый тест для контроля',published:false});
  await asUser(colonel);permissions=(await rpc({})).permissions;
  assert.equal(permissions.canCreateTests,true);assert.equal(permissions.canManageCreators,false);
  assert((await rpc({})).managed.some(t=>t.id===source.id));assert((await rpc({})).managed.some(t=>t.id===hidden.id));
  assert.equal((await rpc({op:'test',id:source.id})).mine,false);
  const key='test:'+source.id;
  let draft=await editor({action:'save',id:key,version:0,baseVersion:source.version,form:{...source,title:'Правка полковником'}});
  const edited=await editor({action:'publish',id:key,version:draft.version});assert.equal(edited.title,'Правка полковником');assert(edited.version>source.version);
  assert.equal((await row('tests',source.id)).owner_id,other);await asUser(colonel);
  const copy=await editor({action:'copy',testId:source.id});assert.equal(copy.mine,true);assert.equal(copy.published,false);
  await denied(()=>rpc({action:'grantCreator',login:logins.get(employee)}),'PT403');
  await asUser(other);assert.deepEqual((await editor({action:'list'})).drafts,[]);
  await denied(()=>rpc({...source,action:'saveTest',title:'Устаревшая правка'}),'PT409');
  checks.push('Colonel edits and copies tests from other authors without creator grants, preserves original authorship, cannot delegate site access, and stale edits fail');

  await asUser(colonel);const current=await rpc({op:'test',id:source.id});
  draft=await editor({action:'save',id:key,version:0,baseVersion:current.version,form:{...current,title:'Несохранённый черновик'}});
  await asUser(other);await rpc({...current,action:'saveTest',title:'Правка второго полковника'});
  await asUser(colonel);await denied(()=>editor({action:'publish',id:key,version:draft.version}),'PT409');
  await rank(colonel,'Подполковник');await denied(()=>editor({action:'list'}),'PT403');await denied(()=>rpc({op:'test',id:source.id}),'PT403');
  await rank(colonel,'Полковник');assert.equal((await editor({action:'load',id:key})).draft.version,draft.version);
  checks.push('Separate colonels have private drafts; concurrent source edits conflict; demotion immediately blocks editor access without deleting drafts');

  await asUser(other);const assigned=await rpc({action:'assignTest',testId:source.id,login:logins.get(employee),dueAt:deadline()});
  await asUser(employee);const completed=await finish(await rpc({action:'startAssignment',assignmentId:assigned.id}));
  await asUser(captain);permissions=(await rpc({})).permissions;
  assert.equal(permissions.canAssignTests,true);assert.equal(permissions.canViewAllResults,true);assert.equal(permissions.canCreateTests,false);
  assert((await rpc({})).assignedTeam.some(s=>s.id===assigned.id));assert((await rpc({})).assignmentTests.some(t=>t.id===source.id));
  assert(!(await rpc({})).assignmentTests.some(t=>t.id===hidden.id));
  const all=await results({scope:'all',testId:source.id});assert.equal(all.total,1);assert.equal(all.rows[0].id,completed.id);
  const reviewed=await rpc({op:'attempt',id:completed.id});assert.equal(reviewed.readOnly,true);assert.equal(reviewed.questions[0].correct,0);
  await denied(()=>rpc({action:'answer',id:completed.id,questionId:completed.questions[0].id,choice:1}),'PT404');
  await denied(()=>rpc({...base,id:source.id,version:1}),'PT403');await denied(()=>editor({action:'copy',testId:source.id}),'PT403');
  await denied(()=>rpc({action:'assignTest',testId:hidden.id,login:logins.get(employee),dueAt:deadline()}),'PT404');
  checks.push('Captain sees all employee results and all assignments, assigns any published author test, reads attempts without changing them, and cannot access editing or unpublished tests');

  const originalAttempt=await row('attempts',completed.id);const originalAssignment=await row('assignments',assigned.id);
  await asUser(captain);const reset=await rpc({action:'resetAssignment',id:assigned.id,version:originalAssignment.version,dueAt:deadline(),userId:low});
  assert.notEqual(reset.id,assigned.id);assert.equal(reset.resetFromId,assigned.id);assert.equal(reset.completedAt,null);assert.equal(reset.lastScore,null);
  assert.deepEqual(await row('attempts',completed.id),originalAttempt);
  const oldAssignment=await row('assignments',assigned.id);assert.equal(oldAssignment.completed_at,originalAssignment.completed_at);assert.equal(oldAssignment.completed_attempt_id,completed.id);assert.equal(oldAssignment.reset_to_id,reset.id);
  assert.equal((await row('assignments',reset.id)).user_id,employee);await asUser(captain);
  await denied(()=>rpc({action:'resetAssignment',id:assigned.id,version:originalAssignment.version,dueAt:deadline()}),'PT409');
  assert.equal((await results({scope:'all',testId:source.id})).total,1);
  await asUser(employee);assert.equal((await rpc({op:'attempt',id:completed.id})).assignmentReset,true);
  assert((await rpc({})).assignments.some(s=>s.id===assigned.id&&s.status==='reset'));
  const repeat=await rpc({action:'startAssignment',assignmentId:reset.id});assert.notEqual(repeat.id,completed.id);
  const second=await finish(repeat);assert.equal(second.score,second.total);
  await asUser(captain);assert.equal((await results({scope:'all',testId:source.id})).total,2);
  checks.push('Reset creates a fresh assignment and preserves every field of completed attempts and historical completion; duplicate reset fails and a new attempt adds to the result history');

  await asUser(captain);const pending=await rpc({action:'assignTest',testId:source.id,login:logins.get(low),dueAt:deadline()});
  await asUser(low);const inProgress=await rpc({action:'startAssignment',assignmentId:pending.id});await rpc({action:'answer',id:inProgress.id,questionId:inProgress.questions[0].id,choice:0});
  await db.exec('reset role');await db.query("update knowledge_private.attempts set deadline_at=now()-interval '1 second' where id=$1",[inProgress.id]);
  const beforeReset=await row('attempts',inProgress.id);await asUser(captain);
  const next=await rpc({action:'resetAssignment',id:pending.id,version:pending.version,dueAt:deadline()});
  assert.deepEqual(await row('attempts',inProgress.id),beforeReset);
  await asUser(low);const historic=await rpc({op:'attempt',id:inProgress.id});assert.equal(historic.readOnly,true);assert.equal(historic.answers[inProgress.questions[0].id],0);assert(historic.questions.every(q=>!('correct' in q)));
  await denied(()=>rpc({action:'answer',id:inProgress.id,questionId:inProgress.questions[1].id,choice:1}),'PT409');await denied(()=>rpc({action:'submit',id:inProgress.id}),'PT409');
  await denied(()=>rpc({action:'startAssignment',assignmentId:pending.id}),'PT409');
  const resumed=await rpc({action:'startAssignment',assignmentId:next.id});assert.notEqual(resumed.id,inProgress.id);assert.deepEqual(resumed.answers,{});
  assert.deepEqual(await row('attempts',inProgress.id),beforeReset);
  checks.push('Reset of an unfinished assignment keeps saved answers and timestamps intact, freezes its old attempt, and starts a separate blank attempt without leaking answer keys');

  await asUser(captain);const candidate=(await rpc({})).assignedTeam.find(s=>s.id===next.id);
  const rescheduled=await rpc({action:'rescheduleAssignment',id:next.id,version:candidate.version,dueAt:deadline()});assert(rescheduled.version>candidate.version);
  await denied(()=>rpc({action:'cancelAssignment',id:next.id,version:candidate.version}),'PT409');
  const simultaneous={action:'resetAssignment',id:next.id,version:rescheduled.version,dueAt:deadline()};
  const concurrent=await Promise.allSettled([rpc(simultaneous),rpc(simultaneous)]);assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal(concurrent.filter(r=>r.status==='rejected'&&r.reason.code==='PT409').length,1);
  checks.push('Any Captain can reschedule another manager’s assignments; versions serialize reset/cancel/reschedule and duplicate reset requests create only one replacement');

  // An existing pending assignment must not be silently replaced by resetting a different historical one.
  const stableOld=await row('assignments',reset.id);const stableAttempt=await row('attempts',second.id);await asUser(captain);
  const occupied=await rpc({action:'assignTest',testId:source.id,login:logins.get(employee),dueAt:deadline()});
  await denied(()=>rpc({action:'resetAssignment',id:reset.id,version:stableOld.version,dueAt:deadline()}),'PT409');
  for(const invalid of [{version:null},{version:'1'},{dueAt:'yesterday'},{dueAt:new Date(Date.now()-1000).toISOString()}])
    await denied(()=>rpc({action:'resetAssignment',id:reset.id,version:stableOld.version,dueAt:deadline(),...invalid}),'PT400');
  assert.deepEqual(await row('assignments',reset.id),stableOld);assert.deepEqual(await row('attempts',second.id),stableAttempt);
  await asUser(captain);await rpc({action:'cancelAssignment',id:occupied.id,version:occupied.version});
  await db.exec('reset role');await db.query('update knowledge_private.department_members set active=false where user_id=$1',[employee]);await asUser(captain);
  await denied(()=>rpc({action:'resetAssignment',id:reset.id,version:stableOld.version,dueAt:deadline()}),'PT404');
  await db.exec('reset role');await db.query('update knowledge_private.department_members set active=true where user_id=$1',[employee]);
  checks.push('Conflicting active assignments, malformed versions/deadlines and inactive recipients cannot reset history or leave a partial replacement');

  const catalog=(await db.query('select name,level from knowledge_private.staff_ranks order by level')).rows;
  for(const entry of catalog){
    await rank(colonel,entry.name);const flags=(await rpc({})).permissions;
    assert.equal(flags.canCreateTests,entry.level>=12);assert.equal(flags.canEditAllTests,entry.level>=12);
    assert.equal(flags.canAssignTests,entry.level>=9);assert.equal(flags.canViewAllResults,entry.level>=9);assert.equal(flags.canManageCreators,false);
  }
  checks.push('All 16 ranks obey the exact Captain (9) and Colonel (12) boundaries without granting owner privileges');

  await db.exec('reset role');await db.query('update knowledge_private.department_members set active=false where user_id=$1',[captain]);await asUser(captain);
  await denied(()=>results({scope:'all'}),'PT403');await denied(()=>rpc({action:'assignTest',testId:source.id,login:logins.get(employee),dueAt:deadline()}),'PT403');
  await db.exec('reset role');await db.query('update knowledge_private.department_members set active=true where user_id=$1',[captain]);await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[captain]);await asUser(captain);await denied(()=>results({scope:'all'}),'PT403');
  await db.exec('reset role');await db.query('update auth.users set banned_until=null,email_confirmed_at=null where id=$1',[captain]);await asUser(captain);await denied(()=>rpc({}),'PT401');
  await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=now() where id=$1',[captain]);await rank(captain,'Старший лейтенант');await denied(()=>results({scope:'all'}),'PT403');
  await asUser(employee);assert((await results({scope:'mine'})).rows.some(a=>a.id===completed.id));await denied(()=>rpc({op:'attempt',id:inProgress.id}),'PT404');
  for(const fn of ['test_rank_level()','rank_save_test($1::jsonb)','workspace_before_rank_tests($1::jsonb)'])await denied(()=>db.query('select knowledge_private.'+fn,fn.includes('$1')?[JSON.stringify(base)]:[]),'42501');
  for(const table of ['attempts','assignments','tests','test_drafts'])await denied(()=>db.query('select * from knowledge_private.'+table),'42501');
  await asUser(null,'anon');await denied(()=>rpc({}),'42501');await denied(()=>results({scope:'all'}),'42501');
  checks.push('Archival, blocking, unconfirmed email and demotion revoke managerial access; regular employees retain only their own history and direct table/helper/legacy routes stay closed');

  await db.exec('reset role');const event=(await db.query("select actor_id,details from knowledge_private.management_events where area='assignments' and operation='reset' and target_id=$1",[assigned.id])).rows;
  assert.equal(event.length,1);assert.equal(event[0].actor_id,captain);assert.equal(event[0].details.preservedAttempts,1);assert.equal(event[0].details.newAssignment,reset.id);
  assert.deepEqual((await db.query('select to_jsonb(a) data from knowledge_private.attempts a where id=$1',[completed.id])).rows[0].data,originalAttempt);
  assert.equal((await db.query('select owner_id from knowledge_private.tests where id=$1',[source.id])).rows[0].owner_id,other);
  checks.push('Audit identifies the actual reset actor and retained attempt count; original authorship and historical attempt snapshots survive the entire workflow');
}

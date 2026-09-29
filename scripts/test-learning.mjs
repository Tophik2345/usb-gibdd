import assert from 'node:assert/strict';

export async function checkLearning({db,asUser,rpc,denied,A,B,C,base,checks,failedAttempt}){
  const future=()=>new Date(Date.now()+86_400_000).toISOString();
  const finish=async(attempt,answers)=>{
    for(let i=0;i<answers.length;i++)await rpc({action:'answer',id:attempt.id,questionId:attempt.questions[i].id,choice:answers[i]});
    return rpc({action:'submit',id:attempt.id,score:999,passMark:1});
  };
  await asUser(A);await rpc({action:'revokeCreator',userId:B});
  await asUser(B);
  await denied(()=>db.query('select * from knowledge_private.assignments'),'42501');
  await denied(()=>db.query("select knowledge_private.workspace_roles('{}'::jsonb)"),'42501');
  await denied(()=>rpc({action:'assignTest',testId:'unknown',login:'Третий сотрудник',dueAt:future()}),'PT403');
  await denied(()=>rpc({action:'practice',sourceAttemptId:'unknown'}),'PT404');
  const practice=await rpc({action:'practice',sourceAttemptId:failedAttempt.id,questions:base.questions,score:100});
  assert.equal(practice.mode,'practice');assert.equal(practice.total,1);assert.equal(practice.passMark,100);
  assert.equal(practice.questions[0].text,'Второй вопрос');assert(!('correct' in practice.questions[0]));assert(!('explanation' in practice.questions[0]));
  assert.equal((await rpc({action:'practice',sourceAttemptId:failedAttempt.id})).id,practice.id);
  await denied(()=>rpc({action:'practice',sourceAttemptId:practice.id}),'PT409');
  const regular=await rpc({action:'start',testId:practice.testId,employeeName:'Сотрудник'});
  assert.equal(regular.mode,'exam');assert.notEqual(regular.id,practice.id);
  await finish(practice,[1]);
  assert.equal((await rpc({op:'attempt',id:failedAttempt.id})).score,failedAttempt.score);
  await denied(()=>rpc({action:'practice',sourceAttemptId:practice.id}),'PT400');
  await asUser(A);await denied(()=>rpc({action:'practice',sourceAttemptId:failedAttempt.id}),'PT404');
  assert(!(await rpc({})).team.some(item=>item.id===practice.id));
  checks.push('Practice derives only own mistakes from immutable completed snapshot; resumes separately, hides answer keys, never changes original grade or author reports');

  const {id:testId}=await rpc({...base,title:'Назначенная аттестация'});
  const {id:draft}=await rpc({...base,title:'Черновик назначения',published:false});
  for(const dueAt of ['bad','2026-01-01T00:00:00Z','infinity','2030-01-01T12:00:00','2030-99-01T12:00:00Z']){
    await denied(()=>rpc({action:'assignTest',testId,login:'Другой сотрудник',dueAt}),'PT400');
  }
  await denied(()=>rpc({action:'assignTest',testId:draft,login:'Другой сотрудник',dueAt:future()}),'PT404');
  await denied(()=>rpc({action:'assignTest',testId:'demo-information',login:'Другой сотрудник',dueAt:future()}),'PT404');
  await denied(()=>rpc({action:'assignTest',testId,login:'Несуществующий сотрудник',dueAt:future()}),'PT404');
  await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=null where id=$1',[C]);
  await asUser(A);await denied(()=>rpc({action:'assignTest',testId,login:'Третий сотрудник',dueAt:future()}),'PT404');
  await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=now() where id=$1',[C]);
  await asUser(A);
  const assignment=await rpc({action:'assignTest',testId,login:'  ДРУГОЙ   СОТРУДНИК ',dueAt:future(),userId:C,authorId:C});
  assert.equal(assignment.status,'assigned');assert.equal(assignment.employeeLogin,'другой сотрудник');assert.equal(assignment.count,2);
  assert(!('questions' in assignment));assert(!('email' in assignment));
  await denied(()=>rpc({action:'assignTest',testId,login:'Другой сотрудник',dueAt:future()}),'PT409');
  assert((await rpc({})).assignedTeam.some(item=>item.id===assignment.id));
  await rpc({action:'grantCreator',login:'Третий сотрудник'});
  await asUser(C);
  await denied(()=>rpc({action:'assignTest',testId,login:'Другой сотрудник',dueAt:future()}),'PT404');
  await denied(()=>rpc({action:'rescheduleAssignment',id:assignment.id,dueAt:future()}),'PT404');
  await denied(()=>rpc({action:'cancelAssignment',id:assignment.id}),'PT404');
  await denied(()=>rpc({action:'startAssignment',assignmentId:assignment.id,employeeName:'Другой сотрудник'}),'PT404');
  assert.equal((await rpc({})).assignments.length,0);assert.equal((await rpc({})).assignedTeam.length,0);
  checks.push('Assignments require current author grant, own published test, confirmed immutable login, valid future zoned deadline; duplicates and unrelated access denied');

  await asUser(B);
  assert((await rpc({})).assignments.some(item=>item.id===assignment.id));
  assert.equal((await rpc({})).assignedTeam.length,0);
  await denied(()=>rpc({action:'rescheduleAssignment',id:assignment.id,dueAt:future()}),'PT403');
  const ordinary=await rpc({action:'start',testId,employeeName:'Сотрудник'});
  const ordinaryResult=await finish(ordinary,[0,1]);assert.equal(ordinaryResult.score,2);
  assert.equal((await rpc({})).assignments.find(item=>item.id===assignment.id).status,'assigned');
  await asUser(A);
  await rpc({...base,id:testId,title:'Изменённая версия',passMark:100,published:false,questions:[{text:'Другие вопросы после назначения',options:['Один','Два'],correct:0}]});
  await asUser(B);
  const assigned=await rpc({action:'startAssignment',assignmentId:assignment.id,employeeName:'Чужое имя',userId:C});
  assert.equal(assigned.employeeName,'другой сотрудник');
  assert.equal(assigned.total,2);assert.equal(assigned.passMark,70);assert.equal(assigned.testTitle,'Назначенная аттестация');assert.equal(assigned.assignmentId,assignment.id);
  assert(assigned.questions.every(q=>!('correct' in q)&&!('explanation' in q)));
  assert.equal((await rpc({action:'startAssignment',assignmentId:assignment.id,employeeName:'Сотрудник'})).id,assigned.id);
  const failed=await finish(assigned,[0,0]);assert.equal(failed.score,1);
  let view=(await rpc({})).assignments.find(item=>item.id===assignment.id);assert.equal(view.status,'assigned');assert.equal(view.lastScore,1);
  const training=await rpc({action:'practice',sourceAttemptId:failed.id});
  assert.equal(training.assignmentId,null);await finish(training,[1]);
  assert.equal((await rpc({})).assignments.find(item=>item.id===assignment.id).status,'assigned');
  assert.equal((await rpc({op:'attempt',id:failed.id})).score,1);
  checks.push('Assigned exam freezes questions and threshold even after edits/unpublishing; ordinary exams, failed attempts and practice cannot fulfil assignment');

  await db.exec('reset role');await db.query("update knowledge_private.assignments set due_at=now()-interval '1 hour' where id=$1",[assignment.id]);
  await asUser(B);
  assert.equal((await rpc({})).assignments.find(item=>item.id===assignment.id).status,'overdue');
  const retry=await rpc({action:'startAssignment',assignmentId:assignment.id,employeeName:'Сотрудник'});assert.notEqual(retry.id,failed.id);
  const passed=await finish(retry,[0,1]);assert.equal(passed.score,2);
  view=(await rpc({})).assignments.find(item=>item.id===assignment.id);
  assert.equal(view.status,'passed');assert.equal(view.completedAttemptId,retry.id);assert(Date.parse(view.completedAt)>Date.parse(view.dueAt));
  await rpc({action:'submit',id:retry.id});assert.equal((await rpc({})).assignments.find(item=>item.id===assignment.id).completedAt,view.completedAt);
  await denied(()=>rpc({action:'startAssignment',assignmentId:assignment.id,employeeName:'Сотрудник'}),'PT409');
  await asUser(A);
  await denied(()=>rpc({action:'rescheduleAssignment',id:assignment.id,dueAt:future()}),'PT409');
  await denied(()=>rpc({action:'cancelAssignment',id:assignment.id}),'PT409');
  assert((await rpc({})).assignedTeam.find(item=>item.id===assignment.id).status==='passed');
  checks.push('Overdue status comes from database clock; failed assigned exams can be retried, late passing exams fulfil once, completed assignment cannot be rewritten');

  await rpc({...base,id:testId});
  const cancellation=await rpc({action:'assignTest',testId,login:'Другой сотрудник',dueAt:future()});
  const later=new Date(Date.now()+172_800_000).toISOString();
  const moved=await rpc({action:'rescheduleAssignment',id:cancellation.id,dueAt:later});assert.equal(Date.parse(moved.dueAt),Date.parse(later));
  await asUser(B);
  const active=await rpc({action:'startAssignment',assignmentId:cancellation.id,employeeName:'Сотрудник'});
  await asUser(A);assert.equal((await rpc({action:'cancelAssignment',id:cancellation.id})).status,'cancelled');
  await asUser(B);
  await denied(()=>rpc({action:'startAssignment',assignmentId:cancellation.id,employeeName:'Сотрудник'}),'PT409');
  assert((await rpc({})).attempts.find(item=>item.id===active.id).assignmentCancelled);
  await finish(active,[0,1]);
  view=(await rpc({})).assignments.find(item=>item.id===cancellation.id);assert.equal(view.status,'cancelled');assert.equal(view.completedAt,null);
  await asUser(A);const replacement=await rpc({action:'assignTest',testId,login:'Другой сотрудник',dueAt:future()});assert.notEqual(replacement.id,cancellation.id);
  checks.push('Only assigning author can change deadlines/cancel; cancellation preserves results, prevents fulfilment and permits a fresh assignment');

  await asUser(C);const {id:other}=await rpc({...base,title:'Тест другого автора'});
  await rpc({action:'assignTest',testId:other,login:'Другой сотрудник',dueAt:future()});
  await asUser(A);await rpc({action:'revokeCreator',userId:C});
  await asUser(C);await denied(()=>rpc({action:'assignTest',testId:other,login:'Другой сотрудник',dueAt:future()}),'PT403');
  assert.equal((await rpc({})).assignedTeam.length,0);
  await db.exec('reset role');assert((await db.query("select relrowsecurity from pg_class where oid='knowledge_private.assignments'::regclass")).rows[0].relrowsecurity);
  checks.push('Author revocation immediately blocks new assignment writes; new table has RLS and no direct client access');
}

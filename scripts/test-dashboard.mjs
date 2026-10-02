import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function checkDashboard({ db, asUser, rpc, denied, checks }) {
  const captain = randomUUID(), owner = randomUUID(), deputy = randomUUID(), low = randomUUID(), unconfirmed = randomUUID();
  const pending = randomUUID(), outdated = randomUUID(), banned = randomUUID(), archived = randomUUID(), noProfile = randomUUID();
  const test = randomUUID();
  const ids = [captain, owner, deputy, low, unconfirmed, pending, outdated, banned, archived, noProfile];
  const call = async payload => (await db.query('select public.knowledge_dashboard($1::jsonb) data', [JSON.stringify(payload)])).rows[0].data;
  const admin = async () => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','{}',false)"); };
  const questions = [{ id: 'private-q', text: 'НЕ ПОКАЗЫВАТЬ В СВОДКЕ', options: ['Да', 'Нет'], correct: 0 }];
  await admin();
  for (const uid of ids) await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [uid, uid + '@example.test', JSON.stringify({ login: 'Сводка ' + uid, rank: 'Генерал', role: 'owner' })]);
  for (const uid of ids.filter(uid => uid !== noProfile)) { await asUser(uid); await rpc({}); }
  await admin();
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [unconfirmed]);
  await db.query("update knowledge_private.department_members set rank='Капитан' where user_id=any($1::uuid[])", [[captain, deputy]]);
  await db.query("insert into knowledge_private.test_creators(user_id,role) values($1,'owner'),($2,'deputy')", [owner, deputy]);
  await asUser(null, 'anon'); await denied(() => call({}), '42501');
  await asUser(null); await denied(() => call({}), 'PT401');
  await asUser(unconfirmed); await denied(() => call({}), 'PT401');
  await asUser(low); await denied(() => call({ role: 'owner', rankLevel: 16 }), 'PT403');
  await asUser(noProfile); await denied(() => call({}), 'PT403');
  await admin(); assert.equal((await db.query('select count(*) n from knowledge_private.department_members where user_id=$1', [noProfile])).rows[0].n, 0);
  await asUser(low);
  await denied(() => call({ action: 'assignment', id: 'any' }), 'PT403');
  await denied(() => call({ action: 'clearance', userId: pending }), 'PT403');
  await asUser(owner); let page = await call({});
  assert.equal(page.tests, null); assert.equal(page.permissions.canViewTests, false); assert(page.clearances);
  await denied(() => call({ action: 'assignment', id: 'any' }), 'PT403');
  await asUser(captain); page = await call({ role: 'owner', canManageClearances: true });
  assert(page.tests); assert.equal(page.clearances, null); assert.equal(page.permissions.canManageClearances, false);
  await denied(() => call({ action: 'clearance', userId: pending }), 'PT403');
  checks.push('Dashboard requires a confirmed live identity; captain test access and owner/deputy clearance access stay separate and forged roles do not elevate rights');

  await admin();
  // Isolate the summary window and current queue from earlier offline test fixtures.
  await db.exec("update knowledge_private.attempts set started_at=now()-interval '201 days',finished_at=now()-interval '200 days' where finished_at is not null");
  await db.exec("update knowledge_private.assignments set cancelled_at=now() where completed_at is null and cancelled_at is null");
  await db.exec("update knowledge_private.service_clearances set status='rejected' where status='pending'");
  await db.query('insert into knowledge_private.tests(id,owner_id,title,category,pass_mark,questions,published) values($1,$2,$3,$4,80,$5,true)', [test, deputy, 'Контроль сводки', 'Проверка', JSON.stringify(questions)]);
  const assignment = async (due, extra = {}) => {
    const id = randomUUID(), testId = randomUUID();
    await db.query('insert into knowledge_private.tests(id,owner_id,title,category,pass_mark,questions,published) values($1,$2,$3,$4,80,$5,true)', [testId, deputy, 'Тест очереди', 'Проверка', JSON.stringify(questions)]);
    await db.query('insert into knowledge_private.assignments(id,test_id,author_id,user_id,employee_login,test_title,pass_mark,questions,due_at,completed_at,cancelled_at,reset_to_id) values($1,$2,$3,$4,$5,$6,80,$7,$8,$9,$10,$11)', [id, testId, deputy, pending, 'Сводка сотрудник', 'Тест очереди', JSON.stringify(questions), due, extra.completed || null, extra.cancelled || null, extra.reset || null]);
    return id;
  };
  const past = new Date(Date.now() - 3600_000).toISOString(), soon = new Date(Date.now() + 2 * 3600_000).toISOString(), future = new Date(Date.now() + 3 * 86400_000).toISOString();
  const oldest = await assignment(new Date(Date.now() - 5 * 86400_000).toISOString());
  for (let index = 0; index < 10; index++) await assignment(past);
  await assignment(soon); await assignment(future);
  await assignment(past, { completed: past }); await assignment(past, { cancelled: past }); await assignment(past, { reset: oldest });
  const exam = async (score, finished, extra = {}) => {
    const id = randomUUID();
    await db.query('insert into knowledge_private.attempts(id,test_id,author_id,user_id,employee_name,test_title,pass_mark,questions,total,score,started_at,finished_at,mode) values($1,$2,$3,$4,$5,$6,80,$7,10,$8,$9,$10,$11)', [id, extra.testId || test, deputy, pending, 'Сотрудник сводки', 'Контроль сводки', JSON.stringify(questions), score, new Date(Date.now() - 100 * 86400_000).toISOString(), finished, extra.mode || 'exam']);
    return id;
  };
  const passed = await exam(8, past), failed = await exam(3, past);
  await exam(10, new Date(Date.now() - 20 * 86400_000).toISOString());
  await exam(10, new Date(Date.now() - 60 * 86400_000).toISOString());
  await exam(10, past, { mode: 'practice' });
  const demo = (await db.query('select id from knowledge_private.tests where demo limit 1')).rows[0].id;
  await exam(10, past, { testId: demo });
  await asUser(captain); page = await call({ days: 7 });
  assert.equal(page.tests.activeAssignments, 13); assert.equal(page.tests.overdueAssignments, 11); assert.equal(page.tests.dueSoonAssignments, 1);
  assert.equal(page.tests.overdue.length, 8); assert.equal(page.tests.overdue[0].id, oldest);
  assert.equal(page.tests.finishedExams, 2); assert.equal(page.tests.passedExams, 1); assert.equal(page.tests.failedExams, 1);
  assert.equal(page.tests.averageScore, 55); assert.equal(page.tests.passRate, 50);
  assert.deepEqual(new Set(page.tests.recentResults.map(row => row.id)), new Set([passed, failed]));
  assert(!JSON.stringify(page).includes('НЕ ПОКАЗЫВАТЬ В СВОДКЕ'));
  assert(!JSON.stringify(page).includes('questions')); assert(!JSON.stringify(page).includes('answers'));
  const detail = await call({ action: 'assignment', id: oldest });
  assert.equal(detail.id, oldest); assert.equal(detail.version, 1); assert(!detail.questions);
  assert.equal((await call({ days: 30 })).tests.finishedExams, 3);
  assert.equal((await call({ days: 90 })).tests.finishedExams, 4);
  checks.push('Exact totals cover more than the eight displayed rows; overdue excludes completed/cancelled/reset records and result windows exclude practice/demo with correct pass threshold and average');

  await admin();
  await db.query('update knowledge_private.training_program set required_tests=array[$1]::text[],version=version+1 where singleton', [test]);
  const program = (await db.query('select version from knowledge_private.training_program where singleton')).rows[0].version;
  for (const uid of [pending, outdated, banned, archived, noProfile]) {
    await db.query('insert into knowledge_private.material_reads(user_id,material_id,program_version) select $1,id,$2 from knowledge_private.training_materials on conflict do nothing', [uid, program]);
    if (uid !== pending) await db.query("insert into knowledge_private.attempts(id,test_id,author_id,user_id,employee_name,test_title,pass_mark,questions,total,score,started_at,finished_at) values($1,$2,$3,$4,'Сотрудник','Зачёт',80,$5,1,1,now()-interval '1 hour',now())", [randomUUID(), test, deputy, uid, JSON.stringify(questions)]);
    // The passing exam above used the current test edition for pending as well.
    await db.query('update knowledge_private.attempts set test_version=(select version from knowledge_private.tests where id=$2) where user_id=$1 and test_id=$2', [uid, test]);
    const state = (await db.query('select knowledge_private.clearance_state($1) data', [uid])).rows[0].data;
    await db.query("insert into knowledge_private.service_clearances(user_id,status,program_version,test_versions,requested_at) values($1,'pending',$2,$3,now()-interval '1 day')", [uid, uid === outdated ? program - 1 : program, JSON.stringify(state.fingerprint)]);
  }
  await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1", [banned]);
  await db.query('update knowledge_private.department_members set active=false where user_id=$1', [archived]);
  await asUser(deputy); page = await call({});
  assert(page.tests && page.clearances); assert.equal(page.clearances.pendingCount, 1);
  assert.equal(page.clearances.pending[0].userId, pending);
  assert.equal((await call({ action: 'clearance', userId: pending })).state.status, 'pending');
  await denied(() => call({ action: 'clearance', userId: banned }), 'PT404');
  await denied(() => call({ action: 'clearance', userId: archived }), 'PT404');
  await denied(() => call({ action: 'clearance', userId: noProfile }), 'PT404');
  checks.push('Admission queue includes only current pending clearances of confirmed active unblocked employees; outdated/blocked/archived requests are excluded and decisions remain in existing training RPC');

  await admin();
  const before = (await db.query('select count(*) n from knowledge_private.management_events')).rows[0].n;
  await db.exec("set timezone='UTC'"); await asUser(captain); const utc = await call({});
  await admin(); await db.exec("set timezone='America/Los_Angeles'"); await asUser(captain); const pacific = await call({});
  assert.deepEqual(pacific.period, utc.period);
  const normalizeTimes = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value).toISOString()
    : Array.isArray(value) ? value.map(normalizeTimes)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'serverNow').map(([key, child]) => [key, normalizeTimes(child)])) : value;
  assert.deepEqual(normalizeTimes(pacific.tests), normalizeTimes(utc.tests));
  await admin(); await db.exec("set timezone='UTC'");
  await db.query("update knowledge_private.department_members set rank='Старший лейтенант' where user_id=$1", [captain]);
  await asUser(captain); await denied(() => call({}), 'PT403');
  await admin(); await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1", [deputy]);
  await asUser(deputy); await denied(() => call({}), 'PT403');
  await asUser(owner);
  for (const days of [null, 0, 8, '30', 30.5]) await denied(() => call({ days }), 'PT400');
  await denied(() => call({ action: 'save' }), 'PT400');
  await denied(() => call({ action: 'clearance', userId: 'bad' }), 'PT400');
  await admin();
  // Direct fixture edits do not use the promotion RPC; all calls above are reads.
  const after = (await db.query('select count(*) n from knowledge_private.management_events')).rows[0].n;
  assert.equal(after, before);
  checks.push('Dashboard dates use Moscow across database timezones; reads create no audit entries, and demotion, blocking and malformed requests are rechecked on every call');
}

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function checkStaffRanks({db,asUser,rpc,denied,checks}) {
  const api=async payload=>(await db.query('select public.knowledge_department($1::jsonb) as data',[JSON.stringify(payload)])).rows[0].data;
  const actor=randomUUID(),junior=randomUUID(),peer=randomUUID(),newcomer=randomUUID(),edge=randomUUID();
  const accounts=[[actor,'Старший сотрудник 91001'],[junior,'Младший сотрудник 91002'],[peer,'Равный сотрудник 91003'],[newcomer,'Первый вход 91004'],[edge,'Я '+'9'.repeat(21)]];
  const setRank=async(uid,rank)=>{
    await db.exec('reset role');
    await db.query('update knowledge_private.department_members set rank=$2,version=version+1,updated_at=now() where user_id=$1',[uid,rank]);
  };
  const payload=async(uid,rank)=>({action:'promoteMember',userId:uid,rank,version:(await api({op:'staff'})).members.find(m=>m.userId===uid).version,actorVersion:(await api({op:'myRank'})).version});
  await db.exec('reset role');
  for(const [id,login] of accounts)await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,id+'@example.test',JSON.stringify({login,rank:'Генерал',rankLevel:16,role:'owner'})]);
  assert.equal((await db.query('select * from knowledge_private.department_members where user_id=$1',[newcomer])).rows.length,0);
  await asUser(newcomer);const first=await rpc({});assert.deepEqual(first.permissions,{canCreateTests:false,canManageCreators:false});
  const rank=await api({op:'myRank',userId:actor});assert.equal(rank.rank,'Рядовой');assert.equal(rank.rankLevel,1);assert.equal(rank.userId,newcomer);assert.equal(rank.version,1);
  const directory=await api({op:'staff'}),member=directory.members.find(m=>m.userId===newcomer);
  assert.equal(member.staticId,'91004');assert.equal(member.displayName,'Первый Вход');assert.deepEqual(member.promotionRanks,[]);
  await rpc({});assert.deepEqual(await api({op:'myRank'}),rank);
  await setRank(newcomer,'Младший сержант');await asUser(newcomer);await rpc({});assert.equal((await api({op:'myRank'})).rank,'Младший сержант');
  checks.push('First website login creates a Private profile once; forged Auth metadata and payload user IDs cannot assign ranks; repeat login preserves promotions');

  await db.exec('reset role');
  const catalog=(await db.query('select name,level from knowledge_private.staff_ranks order by level')).rows;
  assert.deepEqual(catalog.map(row=>row.name),['Рядовой','Младший сержант','Сержант','Старший сержант','Старшина','Младший лейтенант','Лейтенант','Старший лейтенант','Капитан','Майор','Подполковник','Полковник','Генерал-майор','Генерал-лейтенант','Генерал-полковник','Генерал']);
  assert.deepEqual(catalog.map(row=>row.level),Array.from({length:16},(_,i)=>i+1));
  await denied(()=>db.query("update knowledge_private.department_members set rank='Неизвестное звание' where user_id=$1",[newcomer]),'23503');
  await asUser(newcomer);
  for(const table of ['staff_ranks','department_members','management_events'])await denied(()=>db.query(`select * from knowledge_private.${table}`),'42501');
  for(const call of ['knowledge_private.ensure_staff_member($1::uuid)','knowledge_private.staff_rank($1::uuid)'])await denied(()=>db.query('select '+call,[actor]),'42501');
  for(const fn of ['department_before_ranks','department_before_accounts','workspace_before_ranks'])await denied(()=>db.query(`select knowledge_private.${fn}('{}'::jsonb)`),'42501');
  await asUser(null,'anon');await denied(async()=>api({op:'myRank'}),'42501');
  checks.push('All 16 ranks have a fixed order; unknown ranks, direct table access, private rank helpers and legacy mutation routes are closed');

  for(const [id] of accounts){await asUser(id);await rpc({});}
  await asUser(edge);const unusual=(await api({op:'staff'})).members.find(m=>m.userId===edge);assert.equal(unusual.rank,'Рядовой');assert.equal(unusual.staticId,'');assert.equal(unusual.displayName,'Я '+'9'.repeat(21));
  await setRank(actor,'Капитан');await setRank(peer,'Капитан');await asUser(actor);
  const mine=await api({op:'myRank'});const staff=await api({op:'staff'});
  assert.deepEqual(staff.members.find(m=>m.userId===junior).promotionRanks.map(r=>r.level),[2,3,4,5,6,7,8]);
  assert.deepEqual(staff.members.find(m=>m.userId===actor).promotionRanks,[]);assert.deepEqual(staff.members.find(m=>m.userId===peer).promotionRanks,[]);
  await denied(async()=>api({action:'promoteMember',userId:actor,rank:'Майор',version:mine.version,actorVersion:mine.version}),'PT403');
  await denied(async()=>api(await payload(peer,'Младший лейтенант')),'PT403');
  for(const proposed of ['Капитан','Генерал'])await denied(async()=>api(await payload(junior,proposed)),'PT403');
  const promotion=await payload(junior,'Лейтенант');const promoted=await api({...promotion,actorId:peer,rankLevel:16,role:'owner'});
  assert.equal(promoted.rank,'Лейтенант');assert.equal(promoted.rankLevel,7);assert.equal(promoted.version,promotion.version+1);
  await denied(async()=>api(promotion),'PT409');
  for(const proposed of ['Рядовой','Лейтенант'])await denied(async()=>api(await payload(junior,proposed)),'PT400');
  await denied(async()=>api(await payload(junior,'Генералиссимус')),'PT400');
  assert.deepEqual((await rpc({})).permissions,{canCreateTests:false,canManageCreators:false});await denied(async()=>api({op:'manageStaff'}),'PT403');
  await db.exec('reset role');const events=(await db.query("select actor_id,details from knowledge_private.management_events where area='department_members' and target_id=$1",[junior])).rows;
  assert.equal(events.length,1);assert.equal(events[0].actor_id,actor);assert.equal(events[0].details.previousRank,'Рядовой');assert.equal(events[0].details.rank,'Лейтенант');assert.equal(events[0].details.actorRank,'Капитан');
  checks.push('A senior employee can promote without editorial privileges; self, peer, equal/superior destination and demotion fail; successful promotions increment versions and produce one audit event');

  await asUser(actor);const staleActor=await payload(newcomer,'Сержант');await setRank(actor,'Майор');await asUser(actor);
  await denied(async()=>api(staleActor),'PT409');
  const staleTarget=await payload(newcomer,'Сержант');await db.exec('reset role');await db.query('update knowledge_private.department_members set bio=$2,version=version+1 where user_id=$1',[newcomer,'Concurrent profile edit']);await asUser(actor);
  await denied(async()=>api(staleTarget),'PT409');
  const simultaneous=await payload(newcomer,'Сержант');
  const outcomes=await Promise.allSettled([api(simultaneous),api(simultaneous)]);
  assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);assert.equal(outcomes.filter(result=>result.status==='rejected'&&result.reason.code==='PT409').length,1);
  checks.push('Both actor and recipient versions are required; changed ranks/profile edits and competing requests cannot apply a stale promotion twice');

  await asUser(junior);const juniorRank=await api({op:'myRank'});
  await denied(async()=>api({action:'promoteMember',userId:peer,rank:'Генерал',version:(await api({op:'staff'})).members.find(m=>m.userId===peer).version,actorVersion:juniorRank.version,actorId:actor,role:'owner',actorRank:'Генерал'}),'PT403');
  await asUser(actor);
  const valid=await payload(junior,'Капитан');
  for(const invalid of [{...valid,version:null},{...valid,actorVersion:null},{...valid,version:'NaN'},{...valid,actorVersion:9999999999},{...valid,userId:'bad'},{...valid,rank:16},[],null,{...valid,padding:'x'.repeat(81000)}])await denied(async()=>api(invalid),'PT400');
  await db.exec('reset role');await db.query("update auth.users set banned_until=now()+interval '1 hour' where id=$1",[actor]);await asUser(actor);await denied(async()=>api(valid),'PT403');
  await db.exec('reset role');await db.query('update auth.users set banned_until=null where id=$1',[actor]);
  await db.query('update knowledge_private.department_members set active=false where user_id=$1',[actor]);await asUser(actor);await denied(async()=>api(valid),'PT403');
  await db.exec('reset role');await db.query('update knowledge_private.department_members set active=true where user_id=$1',[actor]);
  await db.query('update knowledge_private.department_members set active=false where user_id=$1',[junior]);await asUser(actor);await denied(async()=>api(valid),'PT403');
  await db.exec('reset role');await db.query('update knowledge_private.department_members set active=true where user_id=$1',[junior]);
  for(const unavailable of ['banned','unconfirmed']){
    await db.exec('reset role');
    await db.query(unavailable==='banned'?"update auth.users set banned_until=now()+interval '1 hour' where id=$1":'update auth.users set email_confirmed_at=null where id=$1',[junior]);
    await asUser(actor);assert.deepEqual((await api({op:'staff'})).members.find(m=>m.userId===junior).promotionRanks,[]);await denied(async()=>api(valid),'PT404');
    await db.exec('reset role');await db.query('update auth.users set banned_until=null,email_confirmed_at=now() where id=$1',[junior]);
  }
  checks.push('Forged actor identities, malformed requests, blocked actors, archived staff and blocked/unconfirmed recipients cannot change ranks');

  await db.exec('reset role');await db.query("insert into knowledge_private.test_creators(user_id,role) values($1,'owner')",[actor]);await asUser(actor);
  const target=(await api({op:'manageStaff'})).members.find(m=>m.userId===junior);
  const card={action:'saveMember',...target};
  await denied(async()=>api({...card,rank:'Генерал'}),'PT403');
  const {rank:ignored,...withoutRank}=card;await api({...withoutRank,position:'Генерал (текст должности)'});
  assert.equal((await api({op:'staff'})).members.find(m=>m.userId===junior).rank,'Лейтенант');
  await denied(async()=>api({...card,rank:'Генерал'}),'PT409');
  await setRank(actor,'Генерал');await setRank(peer,'Генерал');await asUser(actor);
  const generalStaff=await api({op:'staff'});assert.equal(generalStaff.members.find(m=>m.userId===junior).promotionRanks.at(-1).name,'Генерал-полковник');assert.deepEqual(generalStaff.members.find(m=>m.userId===peer).promotionRanks,[]);
  await denied(async()=>api(await payload(junior,'Генерал')),'PT403');
  const highest=await api(await payload(junior,'Генерал-полковник'));assert.equal(highest.rankLevel,15);
  await rpc({});assert.equal((await api({op:'myRank'})).rank,'Генерал');await asUser(junior);await rpc({});assert.equal((await api({op:'myRank'})).rank,'Генерал-полковник');assert.deepEqual((await rpc({})).permissions,{canCreateTests:false,canManageCreators:false});
  await denied(()=>db.query("update knowledge_private.management_events set details='{}' where target_id=$1",[junior]),'42501');
  checks.push('Owners cannot bypass hierarchy through card edits; position text never grants rank, General stops at Colonel General, repeat login preserves ranks and promoted employees gain no editorial permissions');
  await db.exec('reset role');for(const [id] of accounts)await db.query('delete from auth.users where id=$1',[id]);
}

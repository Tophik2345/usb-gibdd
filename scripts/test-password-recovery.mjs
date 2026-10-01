import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
function compile(file, require, globals={}) {
  const exports={}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,require,...globals}); return exports;
}
function fixture() {
  const calls=[], saved=new Map();let callback;
  const user={id:'local-user',email:'user@example.test'};
  const state={session:{user,access_token:'verified-session-A'},error:null,changeDuringUpdate:false};
  const client={auth:{onAuthStateChange(fn){callback=fn;},async resetPasswordForEmail(email,options){calls.push({method:'request',email,options:JSON.parse(JSON.stringify(options))});return {error:state.error};},async verifyOtp(payload){calls.push({method:'verify',payload:JSON.parse(JSON.stringify(payload))});return {data:{session:state.session},error:state.error};},async getSession(){return {data:{session:state.session},error:null};},async updateUser(payload){calls.push({method:'update',payload:JSON.parse(JSON.stringify(payload))});return {error:state.error};}}};
  const api=compile('../lib/password-recovery.ts',()=>({supabase:()=>client,siteReturnUrl:()=> 'https://tophik2345.github.io/usb-gibdd/',updatePasswordForSession:async(session,password)=>{calls.push({method:'update',payload:{password},userId:session.user.id});if(state.changeDuringUpdate){state.session={user:{id:'another-user'},access_token:'session-B'};callback?.('SIGNED_IN',state.session);}if(state.error)throw state.error;}}),{sessionStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)}});
  return {api,state,calls,saved,event:(event,session=state.session)=>callback(event,session)};
}
await test('recovery requests normalize email and preserve the deployed repository redirect',async()=>{const f=fixture();await f.api.requestRecoveryCode(' User@Example.Test ');assert.deepEqual(f.calls[0],{method:'request',email:'user@example.test',options:{redirectTo:'https://tophik2345.github.io/usb-gibdd/'}});f.state.error={status:500};await assert.rejects(f.api.requestRecoveryCode('user@example.test'));});
await test('wrong formats and missing sessions cannot enable password changes',async()=>{const f=fixture();for(const code of ['','12345','12ab56'])await assert.rejects(f.api.verifyRecoveryCode('user@example.test',code));assert.equal(f.calls.length,0);f.state.session=null;await assert.rejects(f.api.verifyRecoveryCode('user@example.test','012345'),e=>e.code==='recovery_session_missing');assert.equal(f.api.recoverySnapshot(),null);});
await test('an expired recovery code is preserved as an error without entering password mode',async()=>{const f=fixture();f.state.error={code:'otp_expired',status:403};await assert.rejects(f.api.verifyRecoveryCode('user@example.test','012345'));assert.equal(f.api.recoverySnapshot(),null);});
await test('verified code saves only the matching account password and preserves leading zeroes',async()=>{const f=fixture();await f.api.verifyRecoveryCode(' User@Example.Test ',' 012345 ');assert.deepEqual(f.calls[0],{method:'verify',payload:{type:'recovery',email:'user@example.test',token:'012345'}});await f.api.saveRecoveredPassword('new-local-password','new-local-password','local-user');assert.deepEqual(f.calls[1],{method:'update',payload:{password:'new-local-password'},userId:'local-user'});assert.doesNotMatch([...f.saved.values()].join(),/012345|new-local-password/);});
await test('mismatched/short passwords and a changed account cannot update a password',async()=>{const f=fixture();await f.api.verifyRecoveryCode('user@example.test','012345');for(const [p,r] of [['short','short'],['new-local-password','different-password']])await assert.rejects(f.api.saveRecoveredPassword(p,r,'local-user'));f.state.session={user:{id:'another-user'}};await assert.rejects(f.api.saveRecoveredPassword('new-local-password','new-local-password','local-user'));assert(!f.calls.some(c=>c.method==='update'));});
await test('recovery link events enter password mode and sign-out removes the stored marker',()=>{const f=fixture();f.api.trackPasswordRecovery();f.api.trackPasswordRecovery();f.event('PASSWORD_RECOVERY');assert.equal(f.api.recoverySnapshot().userId,'local-user');f.event('SIGNED_OUT',null);assert.equal(f.api.recoverySnapshot(),null);assert.equal(f.saved.size,0);});
await test('cooldown expires at the deadline and does not become negative',()=>{const {cooldownRemaining}=compile('../lib/code-cooldown.ts',()=>({}));assert.equal(cooldownRemaining(60000,1),60);assert.equal(cooldownRemaining(60000,59001),1);assert.equal(cooldownRemaining(60000,60000),0);assert.equal(cooldownRemaining(60000,70000),0);});
await test('safe registration/recovery messages distinguish duplicate login, email, SMTP, database and password errors',()=>{const {authErrorMessage:m}=compile('../lib/auth-errors.ts');assert.match(m({code:'username_exists'},'register'),/логин уже занят/);assert.match(m({code:'email_exists'},'register'),/почтой уже существует/);assert.match(m({status:500,message:'Error sending confirmation email: PRIVATE'},'register'),/Почтовая служба/);assert.match(m({status:500,message:'Database error saving new user: PRIVATE'},'register'),/сохранить аккаунт/);assert.doesNotMatch(m({status:500,message:'PRIVATE'},'register'),/PRIVATE|логин.*занят/);assert.match(m({code:'same_password'},'password'),/отличаться/);assert.match(m({code:'otp_expired'},'verifyRecovery'),/новый код/);});
await test('signup check denies occupied names and never creates an account',async()=>{let response={data:{available:false},error:null};const {checkSignupLogin}=compile('../lib/signup-validation.ts',()=>({supabase:()=>({rpc:async(name,args)=>{assert.equal(name,'knowledge_signup_check');assert.equal(args.payload.login,'Имя Фамилия');return response;}})}));await assert.rejects(checkSignupLogin(' Имя   Фамилия '),e=>e.code==='username_exists');response={data:{limited:true},error:null};await assert.rejects(checkSignupLogin('Имя Фамилия'),e=>e.status===429);response={data:null,error:{code:'PGRST202'}};await checkSignupLogin('Имя Фамилия');response={data:{available:true},error:null};await checkSignupLogin('Имя Фамилия');});

await test('password write stays bound to the verified account during a concurrent session change',async()=>{
 const f=fixture();f.api.trackPasswordRecovery();await f.api.verifyRecoveryCode('user@example.test','012345');f.state.changeDuringUpdate=true;
 await assert.rejects(f.api.saveRecoveredPassword('new-local-password','new-local-password','local-user'),e=>e.code==='recovery_session_missing');
 assert.equal(f.calls.find(c=>c.method==='update').userId,'local-user');assert.equal(f.state.session.user.id,'another-user');
});
await test('password transport sends the captured JWT and validates the response identity',async()=>{
 const exports={}, calls=[];let response={ok:true,status:200,json:async()=>({id:'verified-user'})};
 const source=fs.readFileSync(new URL('../lib/supabase.ts',import.meta.url),'utf8').replaceAll('import.meta.env','settings');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  exports,URL,AbortSignal,settings:{VITE_SUPABASE_URL:'https://local-project.example.test',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_local_fixture'},require:()=>({createClient:()=>{throw Error('Password write must not read another session');}}),fetch:async(url,options)=>{calls.push({url,options});return response;}
 });
 await exports.updatePasswordForSession({access_token:'captured-session-A',user:{id:'verified-user'}},'local-test-password');
 assert.equal(calls[0].options.headers.Authorization,'Bearer captured-session-A');assert.equal(calls[0].options.method,'PUT');
 response={ok:true,status:200,json:async()=>({id:'other-user'})};await assert.rejects(exports.updatePasswordForSession({access_token:'captured-session-A',user:{id:'verified-user'}},'local-test-password'));
 response={ok:false,status:422,json:async()=>({code:'same_password'})};await assert.rejects(exports.updatePasswordForSession({access_token:'captured-session-A',user:{id:'verified-user'}},'local-test-password'),e=>e.code==='same_password');
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../supabase/functions/username-login/index.ts',import.meta.url),'utf8');
let handler, calls=[],lookup={allowed:true,email:'fixture@example.test'},authStatus=200,authBody={access_token:'access-fixture',refresh_token:'refresh-fixture',user:{email:'fixture@example.test'}};
const env={SUPABASE_URL:'https://project.example.test',SUPABASE_SECRET_KEYS:JSON.stringify({default:'sb_secret_test'}),SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:'sb_publishable_test'})};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{
 Deno:{env:{get:k=>env[k]},serve:f=>handler=f},Response,Request,Uint8Array,TextDecoder,AbortSignal,crypto,
 fetch:async(url,options)=>{calls.push({url,options});return url.includes('/rpc/')?Response.json(lookup):Response.json(authBody,{status:authStatus});}
});
const call=body=>handler(new Request('https://function.example.test',{method:'POST',body:JSON.stringify(body)}));
const credentials={login:'Test Login',password:'Only-a-test-password'};
let response=await call(credentials);assert.equal(response.status,200);assert.deepEqual(await response.json(),{access_token:'access-fixture',refresh_token:'refresh-fixture'});
assert.equal(calls[0].options.headers.apikey,'sb_secret_test');assert.equal(calls[1].options.headers.apikey,'sb_publishable_test');assert.equal(JSON.parse(calls[1].options.body).email,'fixture@example.test');
assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('access-control-allow-origin'),'https://tophik2345.github.io');
lookup={allowed:false};calls=[];assert.equal((await call(credentials)).status,429);assert.equal(calls.length,1);
lookup={allowed:true,email:null};calls=[];response=await call(credentials);assert.equal(response.status,401);assert.deepEqual(await response.json(),{code:'invalid_credentials'});assert.equal(calls.length,2);assert(JSON.parse(calls[1].options.body).email.endsWith('@invalid.invalid'));
lookup={allowed:true,email:'fixture@example.test'};authStatus=400;authBody={error_code:'invalid_credentials'};assert.deepEqual(await (await call(credentials)).json(),{code:'invalid_credentials'});
authBody={error_code:'email_not_confirmed'};assert.deepEqual(await (await call(credentials)).json(),{code:'email_not_confirmed'});
calls=[];assert.equal((await call({login:'Test'})).status,400);assert.equal(calls.length,0);
assert.equal((await call({...credentials,password:'x'.repeat(5000)})).status,413);
assert.equal((await handler(new Request('https://function.example.test',{method:'GET'}))).status,405);
console.log('PASS: session-only response, credential separation, CORS, rate limit, unknown/wrong/unconfirmed accounts, input and method validation. Auth upstream mocked.');

// Supabase's fetch layer may return a 500 without code for a rejected SMTP login.
const errorExports = {};
const errorSource = fs.readFileSync(new URL('../lib/auth-errors.ts', import.meta.url), 'utf8');
vm.runInNewContext(ts.transpileModule(errorSource, {
 compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: errorExports });
const message = errorExports.authErrorMessage;
for (const error of [{ status: 500 }, { code: 'unexpected_failure', status: 500 }, { status: 503 }]) {
 const text = message(error, 'register');
 assert.match(text, /регистрацию.*сервера.*письма/u);
 assert.doesNotMatch(text, /логин уже занят|Проверьте соединение|выполнить вход/u);
}
assert.match(message({ status: 500 }, 'login'), /Сервис входа временно недоступен/u);
assert.match(message({ code: 'email_address_not_authorized' }, 'register'), /Отправка писем/u);
assert.match(message({ code: 'email_not_confirmed' }, 'login'), /Подтвердите почту/u);
assert.match(message({ code: 'invalid_credentials' }, 'login'), /Неверный логин или пароль/u);
assert.match(message({ status: 429 }, 'register'), /Слишком много попыток/u);
assert.match(message(new TypeError('Failed to fetch'), 'register'), /сервером регистрации.*соединение/u);
assert.doesNotThrow(() => message(null, 'register'));
assert.doesNotMatch(message({ status: 500, message: 'private SMTP detail' }, 'register'), /private/u);
console.log('PASS: registration SMTP/server failure, network failure, login, confirmation and rate-limit messages; server details are not exposed.');

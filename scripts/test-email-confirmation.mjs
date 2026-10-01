import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function compile(path, require) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require });
  return exports;
}

function fixture() {
  const calls = [];
  const state = { resendError: null, verifyError: null, session: { access_token: 'local-test-session' } };
  const client = { auth: {
    async resend(payload) {
      calls.push({ method: 'resend', payload: JSON.parse(JSON.stringify(payload)) });
      return { error: state.resendError };
    },
    async verifyOtp(payload) {
      calls.push({ method: 'verifyOtp', payload: JSON.parse(JSON.stringify(payload)) });
      return { data: { session: state.session }, error: state.verifyError };
    },
    signUp() { throw new Error('Resending or verifying must not create an account'); },
  } };
  const api = compile('../lib/email-confirmation.ts', name => {
    assert.equal(name, './supabase');
    return { supabase: () => client, siteReturnUrl: () => 'https://tophik2345.github.io/usb-gibdd/' };
  });
  return { ...api, calls, state };
}

await test('the same registration email can request another code without creating an account', async () => {
  const f = fixture();
  await f.resendSignupCode(' Prior@Example.Test ');
  await f.resendSignupCode('prior@example.test');
  assert.deepEqual(f.calls, Array.from({ length: 2 }, () => ({ method: 'resend', payload: {
    type: 'signup', email: 'prior@example.test', options: { emailRedirectTo: 'https://tophik2345.github.io/usb-gibdd/' },
  } })));
});

await test('rate limits and mail errors reach the caller; a later retry remains possible', async () => {
  const f = fixture();
  for (const error of [{ code: 'over_email_send_rate_limit', status: 429 }, { status: 500 }]) {
    f.state.resendError = error;
    await assert.rejects(f.resendSignupCode('prior@example.test'), value => value === error);
  }
  f.state.resendError = null;
  await f.resendSignupCode('prior@example.test');
  assert.equal(f.calls.length, 3);
});

await test('verification preserves leading zeroes and returns only a confirmed session', async () => {
  const f = fixture();
  const session = await f.verifySignupCode(' Prior@Example.Test ', ' 012345 ');
  assert.equal(session, f.state.session);
  assert.deepEqual(f.calls, [{ method: 'verifyOtp', payload: { type: 'signup', email: 'prior@example.test', token: '012345' } }]);
});

await test('an expired or wrong code does not create an account or hide the server error', async () => {
  const f = fixture();
  const error = { code: 'otp_expired', status: 403 };
  f.state.verifyError = error;
  await assert.rejects(f.verifySignupCode('prior@example.test', '012345'), value => value === error);
  assert.deepEqual(f.calls.map(call => call.method), ['verifyOtp']);
});

await test('malformed codes are rejected without sending verification requests', async () => {
  const f = fixture();
  for (const code of ['', '12345', '12ab56', '12345678901']) {
    await assert.rejects(f.verifySignupCode('prior@example.test', code), error => error.code === 'otp_invalid');
  }
  assert.equal(f.calls.length, 0);
});

await test('blank email is rejected before resending or verification', async () => {
  const f = fixture();
  await assert.rejects(f.resendSignupCode(' '), error => error.code === 'email_address_invalid');
  await assert.rejects(f.verifySignupCode(' ', '012345'), error => error.code === 'email_address_invalid');
  assert.equal(f.calls.length, 0);
});

await test('a response without a session cannot be treated as successful confirmation', async () => {
  const f = fixture();
  f.state.session = null;
  await assert.rejects(f.verifySignupCode('prior@example.test', '012345'), error => error.code === 'confirmation_session_missing');
});

await test('confirmation messages distinguish bad codes, throttling, mail failures and network failures', () => {
  const { authErrorMessage: message } = compile('../lib/auth-errors.ts');
  assert.match(message({ code: 'otp_expired' }, 'verify'), /недействителен.*новый код/u);
  assert.match(message({ code: 'validation_failed' }, 'verify'), /цифровой код/u);
  assert.match(message({ code: 'confirmation_session_missing' }, 'verify'), /Не удалось завершить подтверждение/u);
  assert.match(message({ status: 429 }, 'resend'), /ограничена.*Подождите/u);
  assert.match(message({ code: 'over_email_send_rate_limit' }, 'resend'), /ограничена/u);
  assert.match(message({ status: 500 }, 'resend'), /отправить код.*почтовой службы/u);
  assert.match(message({ status: 503 }, 'verify'), /Сервис подтверждения/u);
  assert.match(message({ status: 403 }, 'verify'), /Проверьте адрес и код/u);
  assert.doesNotMatch(message({ status: 403 }, 'verify'), /соединение/u);
  assert.match(message({ status: 422 }, 'resend'), /Проверьте адрес электронной почты/u);
  assert.match(message(new TypeError('Failed to fetch'), 'resend'), /Проверьте соединение/u);
  assert.doesNotMatch(message({ status: 500, message: 'private SMTP details' }, 'resend'), /private/u);
});

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
    async signInWithOtp(payload) {
      calls.push({ method: 'signInWithOtp', payload: JSON.parse(JSON.stringify(payload)) });
      return { error: state.resendError };
    },
    async verifyOtp(payload) {
      calls.push({ method: 'verifyOtp', payload: JSON.parse(JSON.stringify(payload)) });
      return { data: { session: state.session }, error: state.verifyError };
    },
    resend() { throw new Error('Signup resend silently skips confirmed users'); },
    signUp() { throw new Error('Resending or verifying must not create an account'); },
  } };
  const api = compile('../lib/email-confirmation.ts', name => {
    assert.equal(name, './supabase');
    return { supabase: () => client, siteReturnUrl: () => 'https://tophik2345.github.io/usb-gibdd/' };
  });
  return { ...api, calls, state };
}

await test('email code requests use OTP with account creation disabled instead of signup resend', async () => {
  const f = fixture();
  await f.sendEmailCode(' Prior@Example.Test ');
  await f.sendEmailCode('prior@example.test');
  assert.deepEqual(f.calls, Array.from({ length: 2 }, () => ({ method: 'signInWithOtp', payload: {
    email: 'prior@example.test', options: { shouldCreateUser: false, emailRedirectTo: 'https://tophik2345.github.io/usb-gibdd/' },
  } })));
});

await test('rate limits and mail errors reach the caller; a later retry remains possible', async () => {
  const f = fixture();
  for (const error of [{ code: 'over_email_send_rate_limit', status: 429 }, { status: 500 }]) {
    f.state.resendError = error;
    await assert.rejects(f.sendEmailCode('prior@example.test'), value => value === error);
  }
  f.state.resendError = null;
  await f.sendEmailCode('prior@example.test');
  assert.equal(f.calls.length, 3);
});

await test('an unknown address cannot fall back to signup or a second send', async () => {
  const f = fixture();
  const error = { code: 'otp_disabled', status: 422 };
  f.state.resendError = error;
  await assert.rejects(f.sendEmailCode('unknown@example.test'), value => value === error);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].payload.options.shouldCreateUser, false);
  const { authErrorMessage } = compile('../lib/auth-errors.ts');
  assert.match(authErrorMessage(error, 'resend'), /сначала зарегистрируйтесь/u);
});

await test('both signup and existing-account email templates contain a numeric code and a return link', () => {
  for (const name of ['confirmation', 'magic-link']) {
    const body = fs.readFileSync(new URL('../supabase/templates/' + name + '.html', import.meta.url), 'utf8');
    assert.match(body, /{{\s*\.Token\s*}}/);
    assert.match(body, /{{\s*\.ConfirmationURL\s*}}/);
  }
});

await test('verification uses the unified email type, preserves leading zeroes and requires a session', async () => {
  const f = fixture();
  const session = await f.verifyEmailCode(' Prior@Example.Test ', ' 012345 ');
  assert.equal(session, f.state.session);
  assert.deepEqual(f.calls, [{ method: 'verifyOtp', payload: { type: 'email', email: 'prior@example.test', token: '012345' } }]);
});

await test('an expired or wrong code does not create an account or hide the server error', async () => {
  const f = fixture();
  const error = { code: 'otp_expired', status: 403 };
  f.state.verifyError = error;
  await assert.rejects(f.verifyEmailCode('prior@example.test', '012345'), value => value === error);
  assert.deepEqual(f.calls.map(call => call.method), ['verifyOtp']);
});

await test('malformed codes are rejected without sending verification requests', async () => {
  const f = fixture();
  for (const code of ['', '12345', '12ab56', '12345678901']) {
    await assert.rejects(f.verifyEmailCode('prior@example.test', code), error => error.code === 'otp_invalid');
  }
  assert.equal(f.calls.length, 0);
});

await test('blank email is rejected before resending or verification', async () => {
  const f = fixture();
  await assert.rejects(f.sendEmailCode(' '), error => error.code === 'email_address_invalid');
  await assert.rejects(f.verifyEmailCode(' ', '012345'), error => error.code === 'email_address_invalid');
  assert.equal(f.calls.length, 0);
});

await test('a response without a session cannot be treated as successful confirmation', async () => {
  const f = fixture();
  f.state.session = null;
  await assert.rejects(f.verifyEmailCode('prior@example.test', '012345'), error => error.code === 'confirmation_session_missing');
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

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../lib/account-session.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const changed = /Аккаунт изменился/;
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(userId = 'A') {
  let session = userId ? { user: { id: userId } } : null;
  const callbacks = new Set();
  const calls = [];
  let sessionWait = null;
  const client = {
    auth: {
      onAuthStateChange(callback) {
        callbacks.add(callback);
        queueMicrotask(() => callback('INITIAL_SESSION', session));
        return { data: { subscription: { unsubscribe: () => callbacks.delete(callback) } } };
      },
      getSession: () => sessionWait?.promise ?? Promise.resolve({ data: { session }, error: null }),
    },
    rpc(name, args) {
      const pending = deferred();
      const call = { name, args, pending, signal: null };
      calls.push(call);
      // Deliberately do not settle on abort: even a provider that delivers a late
      // response must not allow old-account data to escape the request boundary.
      return { abortSignal(signal) { call.signal = signal; return pending.promise; } };
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, AbortController,
    require(name) {
      assert.equal(name, './supabase');
      return { authConfigured: true, supabase: () => client };
    },
  });
  const accounts = [];
  const unsubscribe = exports.subscribeToAccount(account => accounts.push(account));
  await tick();
  return {
    ...exports, calls, accounts, unsubscribe,
    change(id, event = 'SIGNED_IN') {
      session = id ? { user: { id } } : null;
      for (const callback of callbacks) callback(event, session);
    },
    delaySession() { sessionWait = deferred(); return sessionWait; },
  };
}

await test('old-account response is rejected even if the transport ignores abort', async () => {
  const f = await fixture();
  const pending = f.accountRpc('knowledge_workspace', { op: 'test', id: 'private-A' });
  await tick();
  f.change('B');
  assert.equal(f.calls[0].signal.aborted, true);
  f.calls[0].pending.resolve({ data: { secret: 'A-only' }, error: null });
  await assert.rejects(pending, changed);
  const current = f.accountRpc('knowledge_workspace', { op: 'workspace' });
  await tick();
  assert.equal(f.calls[1].signal.aborted, false);
  f.calls[1].pending.resolve({ data: { account: 'B' }, error: null });
  assert.equal((await current).data.account, 'B');
});

await test('logout and login to the same account invalidates the previous generation', async () => {
  const f = await fixture();
  const pending = f.accountRpc('knowledge_workspace', { op: 'attempt', id: 'old-result' });
  await tick();
  const before = f.accounts.at(-1).generation;
  f.change(null, 'SIGNED_OUT');
  f.change('A');
  assert(f.accounts.at(-1).generation > before);
  f.calls[0].pending.resolve({ data: { account: 'A', old: true }, error: null });
  await assert.rejects(pending, changed);
});

await test('token refresh and repeated sign-in for the same identity preserve pending requests', async () => {
  const f = await fixture();
  const pending = f.accountRpc('knowledge_workspace', { action: 'answer', id: 'attempt-A' });
  await tick();
  const before = f.accounts.at(-1);
  f.change('A', 'TOKEN_REFRESHED');
  f.change('A', 'SIGNED_IN');
  assert.equal(f.accounts.at(-1), before);
  assert.equal(f.calls[0].signal.aborted, false);
  f.calls[0].pending.resolve({ data: { saved: true }, error: null });
  assert.equal((await pending).data.saved, true);
});

await test('account switch while getSession is pending prevents RPC dispatch', async () => {
  const f = await fixture();
  const session = f.delaySession();
  const pending = f.accountRpc('knowledge_workspace', { action: 'start', testId: 'test-A' });
  await tick();
  f.change('B');
  session.resolve({ data: { session: { user: { id: 'B' } } }, error: null });
  await assert.rejects(pending, changed);
  assert.equal(f.calls.length, 0);
});

await test('account switch before the first async continuation prevents RPC dispatch', async () => {
  const f = await fixture();
  const pending = f.accountRpc('knowledge_workspace', { action: 'saveTest', title: 'A-only' });
  f.change('B');
  await assert.rejects(pending, changed);
  assert.equal(f.calls.length, 0);
});

await test('storage identity mismatch invalidates state before cross-tab notification arrives', async () => {
  const f = await fixture();
  const session = f.delaySession();
  const pending = f.accountRpc('knowledge_workspace', { action: 'submit', id: 'attempt-A' });
  await tick();
  session.resolve({ data: { session: { user: { id: 'B' } } }, error: null });
  await assert.rejects(pending, changed);
  assert.equal(f.calls.length, 0);
  assert.equal(f.accounts.at(-1).userId, 'B');
  assert.equal(f.accounts[0].signal.aborted, true);
});

await test('authenticated workspace rejects a guest, while public portal remains available', async () => {
  const f = await fixture(null);
  await assert.rejects(f.accountRpc('knowledge_workspace', {}, true), error => error.status === 401);
  assert.equal(f.calls.length, 0);
  const pending = f.accountRpc('knowledge_portal', { op: 'announcements' });
  await tick();
  f.calls[0].pending.resolve({ data: { announcements: [] }, error: null });
  assert.equal((await pending).data.announcements.length, 0);
});

await test('storage responses cannot cross an account switch and same-account refresh preserves them', async () => {
  const f=await fixture();const late=deferred();
  const old=f.accountStorage(()=>late.promise);await tick();f.change('B');late.resolve({url:'private-A'});
  await assert.rejects(old,changed);
  const next=deferred();const current=f.accountStorage(()=>next.promise);await tick();f.change('B','TOKEN_REFRESHED');
  next.resolve({url:'private-B'});assert.equal((await current).url,'private-B');
});

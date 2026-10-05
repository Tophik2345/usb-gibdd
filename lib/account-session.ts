import { authConfigured, supabase } from './supabase';

export type AccountScope = Readonly<{
  userId: string | null;
  generation: number;
  signal: AbortSignal;
}>;

class AccountChangedError extends Error {
  constructor() { super('Аккаунт изменился. Повторите действие.'); }
}

class SessionRequiredError extends Error {
  readonly status = 401;
  constructor() { super('Войдите в аккаунт, чтобы продолжить.'); }
}

let controller = new AbortController();
let scope: AccountScope = { userId: null, generation: 0, signal: controller.signal };
let tracking = false;
let initialized = false;
const listeners = new Set<(account: AccountScope) => void>();
let resolveReady: () => void;
const ready = new Promise<void>(resolve => { resolveReady = resolve; });

function updateAccount(userId: string | null, signedOut = false) {
  if (userId !== scope.userId || signedOut) {
    controller.abort();
    controller = new AbortController();
    scope = { userId, generation: scope.generation + 1, signal: controller.signal };
  } else if (initialized) {
    // Refreshing a token for the same account must not cancel its requests.
    return;
  }
  initialized = true;
  resolveReady();
  for (const listener of listeners) listener(scope);
}

function trackAccount() {
  const client = supabase();
  if (!tracking) {
    tracking = true;
    // This callback stays synchronous: calling Auth methods here can deadlock.
    client.auth.onAuthStateChange((event, session) => {
      updateAccount(session?.user.id ?? null, event === 'SIGNED_OUT');
    });
  }
  return client;
}

export function subscribeToAccount(listener: (account: AccountScope) => void) {
  if (!authConfigured) {
    listener(scope);
    return () => {};
  }
  listeners.add(listener);
  trackAccount();
  if (initialized) listener(scope);
  return () => { listeners.delete(listener); };
}

function assertCurrent(account: AccountScope) {
  if (account.signal.aborted || account !== scope) throw new AccountChangedError();
}

async function accountOperation<T>(operation: (client: ReturnType<typeof supabase>, account: AccountScope) => PromiseLike<T>, requireSession: boolean) {
  const client = trackAccount();
  const initiatingAccount = initialized ? scope : null;
  await ready;
  const account = initiatingAccount ?? scope;
  assertCurrent(account);
  const { data: { session }, error } = await client.auth.getSession();
  assertCurrent(account);
  const userId = session?.user.id ?? null;
  if (userId !== account.userId) {
    // A storage change may be observed before its cross-tab Auth notification.
    updateAccount(userId);
    throw new AccountChangedError();
  }
  if (requireSession && (error || !session)) throw new SessionRequiredError();
  const result = await operation(client, account);
  assertCurrent(account);
  return result;
}

export function accountRpc(name: string, payload: unknown, requireSession = false) {
  return accountOperation((client, account) => client.rpc(name, { payload }).abortSignal(account.signal), requireSession);
}

/** Storage requests retain the same account boundary as database requests. */
export function accountStorage<T>(operation: (client: ReturnType<typeof supabase>) => PromiseLike<T>, requireSession = true) {
  return accountOperation(operation, requireSession);
}

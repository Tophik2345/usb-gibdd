import { supabase, authConfigured } from './supabase';

export class WorkspaceError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}
export async function workspaceApi<T>(path = '', body?: unknown): Promise<T> {
  if (!authConfigured) throw new WorkspaceError('Вход временно недоступен.', 401);
  const client = supabase();
  const { data: { session }, error: sessionError } = await client.auth.getSession();
  if (sessionError || !session) throw new WorkspaceError('Войдите в аккаунт, чтобы продолжить.', 401);
  const params = new URLSearchParams(path.replace(/^\?/, ''));
  const payload = body === undefined ? { op: params.get('op') || 'workspace', id: params.get('id') } : body;
  const { data, error } = await client.rpc('knowledge_workspace', { payload });
  if (error) {
    if (error.code === 'PT401' || /^PGRST30[123]$/.test(error.code)) throw new WorkspaceError('Войдите в аккаунт, чтобы продолжить.', 401);
    if (/^PT4\d\d$/.test(error.code)) throw new WorkspaceError(error.message, Number(error.code.slice(2)));
    throw new WorkspaceError('Не удалось загрузить данные. Проверьте соединение и повторите попытку.');
  }
  return data as T;
}

import { authConfigured, supabase } from './supabase';
import { WorkspaceError } from './workspace-api';

export type Bookmark = { document: string; article: string };
export type Announcement = { id: string; title: string; body: string; kind: 'news'|'rules'|'attestation'; eventAt: string|null; pinned: boolean; published: boolean; publishedAt: string|null; updatedAt: string; version: number };
export type UsefulLink = { id: string; title: string; description: string; url: string; category: 'forum'|'appeals'|'reports'|'contact'; position: number; published: boolean; version: number };
export async function portalApi<T>(payload: Record<string, unknown>): Promise<T> {
  if (!authConfigured) throw new WorkspaceError('Сервис временно недоступен.');
  const { data, error } = await supabase().rpc('knowledge_portal', { payload });
  if (error) {
    if (/^PT4\d\d$/.test(error.code)) throw new WorkspaceError(error.message, Number(error.code.slice(2)));
    if (/^PGRST30[123]$/.test(error.code)) throw new WorkspaceError('Войдите в аккаунт ещё раз.', 401);
    throw new WorkspaceError('Не удалось загрузить данные. Проверьте соединение и повторите попытку.');
  }
  return data as T;
}

import { authConfigured, supabase } from './supabase';
import { WorkspaceError } from './workspace-api';

export type StaffMember = { userId: string; displayName: string; staticId: string; rank: string; position: string; bio: string; active: boolean; sortOrder: number; version: number; updatedAt: string };
export const appealKinds = { complaint: 'Жалоба', question: 'Вопрос', proposal: 'Предложение' } as const;
export const appealStatuses = { new: 'Новое', in_review: 'На рассмотрении', resolved: 'Рассмотрено', rejected: 'Отклонено' } as const;
export type AppealStatus = keyof typeof appealStatuses;
export type AppealSummary = { id: string; authorLogin: string; kind: keyof typeof appealKinds; subject: string; status: AppealStatus; createdAt: string; updatedAt: string };
export type Appeal = AppealSummary & { body: string; evidence: string[]; response: string; version: number; history: { status: AppealStatus; response: string; actorLogin: string; createdAt: string; version: number }[] };
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить действие. Повторите попытку.';

export async function departmentApi<T>(payload: Record<string, unknown>): Promise<T> {
  if (!authConfigured) throw new WorkspaceError('Сервис временно недоступен.');
  const { data, error } = await supabase().rpc('knowledge_department', { payload });
  if (error) {
    if (/^PT4\d\d$/.test(error.code)) throw new WorkspaceError(error.message, Number(error.code.slice(2)));
    if (/^PGRST30[123]$/.test(error.code) || error.code === '42501') throw new WorkspaceError('Войдите в аккаунт с подтверждённой почтой.', 401);
    throw new WorkspaceError('Не удалось загрузить данные. Проверьте соединение и повторите попытку.');
  }
  return data as T;
}

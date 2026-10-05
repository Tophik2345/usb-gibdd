import { accountRpc } from './account-session';
import { WorkspaceError } from './workspace-api';
export type FeedbackTarget = { kind: 'question'; attemptId: string; questionId: string; label: string } | { kind: 'law'; document: string; article: string; label: string };
export type ContentReport = { id: string; authorLogin: string; kind: 'question' | 'law'; context: { document?: string; article?: string; testTitle?: string; testVersion?: number | null; text?: string }; description: string; status: 'new' | 'in_review' | 'resolved' | 'rejected'; response: string; version: number; createdAt: string; updatedAt: string };
export async function supportApi<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await accountRpc('knowledge_support', payload, true);
  if (error) {
    if (/^PT4\d\d$/.test(error.code)) throw new WorkspaceError(error.message, Number(error.code.slice(2)));
    throw new WorkspaceError('Не удалось выполнить действие. Проверьте соединение и повторите.');
  }
  return data as T;
}

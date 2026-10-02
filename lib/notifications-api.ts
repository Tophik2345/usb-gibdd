import { accountRpc } from './account-session';
import { WorkspaceError } from './workspace-api';

export type NotificationKind = 'assignment' | 'deadline' | 'overdue' | 'appeal' | 'clearance';
export type PersonalNotification = {
  id: string; kind: NotificationKind; title: string; summary: string; targetId: string | null; createdAt: string; read: boolean;
};
export type NotificationCursor = { at: string; id: string };
export type NotificationCounts = { unreadCount: number; total: number };
export type NotificationPage = NotificationCounts & { items: PersonalNotification[]; nextCursor: NotificationCursor | null; serverNow: string };
export async function notificationsApi<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await accountRpc('knowledge_notifications', payload, true);
  if (error) {
    if (/^PT4\d\d$/.test(error.code)) throw new WorkspaceError(error.message, Number(error.code.slice(2)));
    throw new WorkspaceError('Не удалось обновить уведомления. Проверьте соединение и повторите.');
  }
  return data as T;
}

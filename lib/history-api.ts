import { accountRpc } from './account-session';
import { WorkspaceError } from './workspace-api';
export type HistoryKind = 'result' | 'rank' | 'clearance';
export type HistoryPage = {
  userId: string; displayName: string; own: boolean; total: number; snapshot: string;
  permissions: { results: boolean; ranks: boolean; clearances: boolean; others: boolean };
  items: { id: string; kind: HistoryKind; title: string; summary: string; targetId: string; createdAt: string }[];
  nextCursor: { at: string; id: string } | null;
};
export async function historyApi(payload: Record<string, unknown>): Promise<HistoryPage> {
  const { data, error } = await accountRpc('knowledge_history', payload, true);
  if (error) {
    if (/^PT4\d\d$/.test(error.code)) throw new WorkspaceError(error.message, Number(error.code.slice(2)));
    throw new WorkspaceError('Не удалось загрузить историю. Проверьте соединение и повторите.');
  }
  return data as HistoryPage;
}

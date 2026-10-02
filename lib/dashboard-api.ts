import { accountRpc } from './account-session';
import { WorkspaceError } from './workspace-api';
import type { Assignment, Attempt } from './types';

export type Dashboard = {
  serverNow: string;
  period: { days: number; from: string; to: string };
  permissions: { canViewTests: boolean; canManageClearances: boolean };
  tests: null | {
    activeAssignments: number; overdueAssignments: number; dueSoonAssignments: number;
    finishedExams: number; passedExams: number; failedExams: number;
    averageScore: number | null; passRate: number | null;
    overdue: Assignment[]; recentResults: Attempt[];
  };
  clearances: null | { pendingCount: number; pending: { userId: string; login: string; requestedAt: string }[] };
};
export async function dashboardApi<T>(payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await accountRpc('knowledge_dashboard', payload, true);
  if (error) {
    if (/^PT4\d\d$/.test(error.code)) throw new WorkspaceError(error.message, Number(error.code.slice(2)));
    throw new WorkspaceError('Не удалось загрузить сводку. Проверьте соединение и повторите.');
  }
  return data as T;
}

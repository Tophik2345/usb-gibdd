import { accountRpc } from './account-session';
import { WorkspaceError } from './workspace-api';
import type { Test } from './types';
import type { ClearanceStatus } from './training-api';
export async function leadershipApi<T>(rpc: 'knowledge_bulk_assign' | 'knowledge_analysis' | 'knowledge_attestation', payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await accountRpc(rpc, payload, true);
  if (error) {
    if (/^PT4\d\d$/.test(error.code)) throw new WorkspaceError(error.message, Number(error.code.slice(2)));
    throw new WorkspaceError('Не удалось загрузить данные или выполнить действие. Проверьте соединение и повторите.');
  }
  return data as T;
}
export type BulkRecipient = { userId: string; displayName: string; login: string; staticId: string; rank: string };
export type RecipientsPage = { items: BulkRecipient[]; total: number; nextCursor: string | null };
export type BulkPreview = { test: Test; dueAt: string; createCount: number; skipCount: number; recipients: (BulkRecipient & { existingAssignmentId: string | null })[] };
export type BulkResult = { testTitle: string; dueAt: string; createdCount: number; skipCount: number; created: { id: string; userId: string }[]; skipped: { id: string; userId: string }[]; replayed: boolean };
export type ErrorAnalysis = {
  snapshot: string; period: { days: number; from: string; to: string }; summary: { exams: number; seen: number; wrong: number; unanswered: number; errorRate: number | null };
  tests: { id: string; title: string }[]; topics: { name: string; exams: number; seen: number; wrong: number; unanswered: number; errorRate: number }[];
  questions: { id: string; testId: string; testTitle: string; version: number | null; text: string; seen: number; wrong: number; unanswered: number; errorRate: number }[];
  totalQuestions: number; nextOffset: number | null;
};
export type Attestation = {
  serverNow: string; own: boolean; person: { userId: string; displayName: string; staticId: string; rank: string | null; position: string | null; active: boolean };
  permissions: { results: boolean; clearance: boolean };
  results: null | { id: string; testId: string; title: string; version: number | null; score: number; total: number; passMark: number; finishedAt: string }[];
  clearance: null | { status: ClearanceStatus; ready: boolean; programVersion: number; note: string | null; requestedAt: string | null; decidedAt: string | null; decidedBy: string | null; materialCount: number; materialsRead: number; requiredTestCount: number; requiredTestsPassed: number };
};

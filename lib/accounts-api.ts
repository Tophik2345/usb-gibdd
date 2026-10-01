import { accountRpc } from './account-session';
import { WorkspaceError } from './workspace-api';
export type ManagedAccount = { userId: string; login: string; email: string; role: 'owner'|'deputy'|'author'|'employee'; confirmed: boolean; createdAt: string; blocked: boolean; protected: boolean; authoredTests: number; results: number };
export type AccountsPage = { accounts: ManagedAccount[]; total: number; page: number; pageSize: number };
export async function accountsApi<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await accountRpc('knowledge_accounts', payload, true);
  if (error) {
    if (/^PT4\d\d$/.test(error.code)) throw new WorkspaceError(error.message, Number(error.code.slice(2)));
    if (error.code === 'PGRST202') throw new WorkspaceError('Управление аккаунтами ещё не настроено. Обратитесь к администратору сайта.');
    throw new WorkspaceError('Не удалось выполнить действие. Обновите список перед повторной попыткой.');
  }
  return data as T;
}

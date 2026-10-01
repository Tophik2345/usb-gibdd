import { accountRpc } from './account-session';
import { WorkspaceError } from './workspace-api';
import { resultsCsv } from './results-export';
import type { Attempt } from './types';
export type ResultScope = 'mine'|'practice'|'team'|'all';
export type ResultsFilters = { testId: string; employee: string; from: string; to: string; minScore: string; maxScore: string; status: 'all'|'passed'|'failed' };
export const emptyResultsFilters: ResultsFilters = { testId:'',employee:'',from:'',to:'',minScore:'',maxScore:'',status:'all' };
export type ResultCursor = { finishedAt: string; id: string };
export type ResultsPage = { rows: Attempt[]; total: number; snapshot: string; nextCursor: ResultCursor|null; tests: {id:string;title:string}[] };
export async function resultsApi(scope: ResultScope, filters: ResultsFilters, cursor: ResultCursor|null=null, snapshot?: string): Promise<ResultsPage> {
  const payload = { scope,...filters,minScore:filters.minScore === '' ? null : Number(filters.minScore),maxScore:filters.maxScore === '' ? null : Number(filters.maxScore),cursor,snapshot };
  const { data,error } = await accountRpc('knowledge_results',payload,true);
  if(error) {
    if(/^PT4\d\d$/.test(error.code))throw new WorkspaceError(error.message,Number(error.code.slice(2)));
    throw new WorkspaceError('Не удалось загрузить результаты. Повторите попытку.');
  }
  return data as ResultsPage;
}
export async function exportResults(scope: ResultScope, filters: ResultsFilters, cancelled:()=>boolean, progress:(loaded:number,total:number)=>void) {
  let cursor:ResultCursor|null=null, snapshot:string|undefined, expected:number|undefined;
  const rows:Attempt[]=[]; const ids=new Set<string>();
  do {
    if(cancelled())throw new Error('Экспорт отменён.');
    const page=await resultsApi(scope,filters,cursor,snapshot);
    if(cancelled())throw new Error('Экспорт отменён.');
    expected ??= page.total; snapshot ??= page.snapshot;
    if(expected!==page.total || page.rows.some(row=>ids.has(row.id)))throw new Error('Результаты изменились. Обновите список и повторите экспорт.');
    for(const row of page.rows){ids.add(row.id);rows.push(row);}
    progress(rows.length,expected); cursor=page.nextCursor;
    if(cursor && !page.rows.length)throw new Error('Не удалось получить весь отчёт. Повторите экспорт.');
  } while(cursor);
  if(rows.length!==expected)throw new Error('Не удалось получить весь отчёт. Повторите экспорт.');
  return resultsCsv(rows);
}

import { useEffect, useState, type ReactNode } from 'react';
import { CalendarClock, ClipboardCheck, GraduationCap, Loader2, MessageSquare, RefreshCw } from 'lucide-react';
import type { Assignment, Workspace } from '@/lib/types';
import { formatSiteDate } from '@/lib/date-time';
import { useTraining, type Clearance, type ClearanceStatus } from '@/lib/training-api';
import { appealStatuses, type AppealSummary } from '@/lib/department-api';
import { useDepartmentData } from './use-department-data';
import { departmentLink } from './department-section';
import './my-tasks.css';
import TrainingProgress from './training-progress';

const clearanceLabels: Record<ClearanceStatus, string> = {
  preparing: 'Идёт подготовка', pending: 'На рассмотрении', approved: 'Допуск подтверждён',
  rejected: 'Нужна доработка', revoked: 'Допуск отозван', outdated: 'Программа изменилась',
};
const clearanceHints: Record<ClearanceStatus, string> = {
  preparing: 'Изучите материалы и пройдите обязательные тесты.',
  pending: 'Заявка отправлена. Ожидайте решения руководителя.',
  approved: 'Руководитель подтвердил прохождение подготовки.',
  rejected: 'Посмотрите замечания руководителя и завершите подготовку.',
  revoked: 'Откройте подготовку и уточните причину отзыва допуска.',
  outdated: 'Программа обновилась. Проверьте, что нужно пройти заново.',
};

function ResourceState({ loading, error, onRetry, children }: {
  loading: boolean; error: string; onRetry: () => void; children: ReactNode;
}) {
  if (loading) return <p className="my-tasks-note" role="status"><Loader2 size={16} className="spin" aria-hidden="true" />Загружаем данные…</p>;
  if (error) return <div className="my-tasks-error" role="alert"><p>{error}</p><button type="button" className="button outline" onClick={onRetry}>Повторить</button></div>;
  return children;
}

export default function MyTasks({ data, busy, workspaceError, onRefresh, onAssignments, onStartAssignment, onOpenAttempt }: {
  data: Workspace; busy: boolean; workspaceError: string; onRefresh: () => Promise<void>;
  onAssignments: () => void; onStartAssignment: (assignment: Assignment) => void; onOpenAttempt: (id: string) => void;
}) {
  const [now, setNow] = useState(Date.now);
  const [refreshing, setRefreshing] = useState(false);
  const [showAllAttempts, setShowAllAttempts] = useState(false);
  const clearance = useTraining<Clearance>({ op: 'overview' });
  const appeals = useDepartmentData<{ total: number; appeals: AppealSummary[] }>({ op: 'appeals', scope: 'mine', status: 'all', offset: 0 });
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const assignments = data.assignments.filter(item => item.status === 'assigned' || item.status === 'overdue')
    .slice().sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  const attempts = data.attempts.filter(item => !item.finishedAt && !item.assignmentCancelled && !item.assignmentReset && !item.readOnly)
    .slice().sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const ownAppealsLink = departmentLink('appeals') + '&scope=mine';
  const refresh = async () => {
    setRefreshing(true); setNow(Date.now()); clearance.refresh(); appeals.refresh();
    try { await onRefresh(); } finally { setRefreshing(false); }
  };
  return <section className="my-tasks" aria-labelledby="my-tasks-title">
    <header className="my-tasks-heading"><div><h2 id="my-tasks-title">Мои задачи</h2><p>Ближайшие сроки, подготовка и связь с руководством.</p></div>
      <button type="button" className="button outline" disabled={busy || refreshing} onClick={() => void refresh()}><RefreshCw size={16} className={refreshing ? 'spin' : undefined} aria-hidden="true" />Обновить задачи</button>
    </header>
    {workspaceError && <div className="my-tasks-error" role="alert"><p>{workspaceError}</p><button type="button" className="button outline" disabled={busy || refreshing} onClick={() => void refresh()}>Повторить загрузку задач</button></div>}
    <div className="my-tasks-grid">
      <article className="my-tasks-panel" aria-labelledby="my-assignments-title">
        <h3 id="my-assignments-title"><CalendarClock size={20} aria-hidden="true" />Задания со сроками<span className="count-pill">{assignments.length}</span></h3>
        {assignments.length ? <ul className="my-tasks-list">{assignments.slice(0, 3).map(item => {
          const overdue = item.status === 'overdue' || Date.parse(item.dueAt) < now;
          return <li key={item.id} className={'my-task-deadline'+(overdue?' is-overdue':Date.parse(item.dueAt)<=now+86400000?' is-soon':'')}><div className="my-tasks-item-heading"><h4>{item.testTitle}</h4><span className={'badge ' + (overdue ? 'orange-badge' : 'blue-badge')}>{overdue ? 'Просрочено' : 'Назначено'}</span></div>
            <p className="my-tasks-note my-task-due">Срок: <time dateTime={item.dueAt}>{formatSiteDate(item.dueAt)}</time></p>
            <button type="button" className="button outline" disabled={busy || refreshing} onClick={() => onStartAssignment(item)}>{item.inProgressAttemptId ? 'Продолжить задание' : 'Начать задание'}</button>
          </li>;
        })}</ul> : <p className="my-tasks-empty">Нет заданий, ожидающих сдачи.</p>}
        <button type="button" className="text-button my-tasks-more" onClick={onAssignments}>Все мои задания</button>
      </article>
      <article className="my-tasks-panel" aria-labelledby="my-attempts-title">
        <h3 id="my-attempts-title"><ClipboardCheck size={20} aria-hidden="true" />Незавершённые тесты<span className="count-pill">{attempts.length}</span></h3>
        {attempts.length ? <ul className="my-tasks-list">{(showAllAttempts ? attempts : attempts.slice(0, 3)).map(item => <li key={item.id}>
          <div className="my-tasks-item-heading"><h4>{item.testTitle}</h4><span className="badge neutral">{item.mode === 'practice' ? 'Тренировка' : 'Тест'}</span></div>
          <p className="my-tasks-note">Начат <time dateTime={item.startedAt}>{formatSiteDate(item.startedAt)}</time></p>
          {item.deadlineAt && <p className="my-tasks-note">Таймер до <time dateTime={item.deadlineAt}>{formatSiteDate(item.deadlineAt)}</time></p>}
          <button type="button" className="button outline" disabled={busy || refreshing} onClick={() => onOpenAttempt(item.id)}>{item.deadlineAt && Date.parse(item.deadlineAt) <= now ? 'Открыть попытку' : 'Продолжить тест'}</button>
        </li>)}</ul> : <p className="my-tasks-empty">Все начатые тесты завершены.</p>}
        {attempts.length > 3 && <button type="button" className="text-button my-tasks-more" aria-expanded={showAllAttempts} onClick={() => setShowAllAttempts(value => !value)}>{showAllAttempts ? 'Показать меньше' : `Все незавершённые тесты (${attempts.length})`}</button>}
      </article>
      <article className="my-tasks-panel" aria-labelledby="my-clearance-title">
        <h3 id="my-clearance-title"><GraduationCap size={20} aria-hidden="true" />Мой допуск</h3>
        <ResourceState loading={clearance.loading} error={clearance.error} onRetry={clearance.refresh}>
          {clearance.data && <div className="my-tasks-clearance"><strong>{clearanceLabels[clearance.data.status]}</strong>
            <p className="my-tasks-note">{clearance.data.status === 'preparing' && clearance.data.ready ? 'Материалы и тесты пройдены. Можно подать заявку руководителю.' : clearanceHints[clearance.data.status]}</p>
            <TrainingProgress materialsRead={clearance.data.materials.filter(item => item.readAt).length} materialCount={clearance.data.materials.length} testsPassed={clearance.data.tests.filter(item => item.passed).length} testCount={clearance.data.tests.length}/>
            {clearance.data.note && <p className="my-tasks-decision">Комментарий руководителя: {clearance.data.note}</p>}
          </div>}
        </ResourceState>
        <a className="text-button my-tasks-more" href="#training?tab=admission">Открыть подготовку и допуск</a>
      </article>
      <article className="my-tasks-panel" aria-labelledby="my-appeals-title">
        <h3 id="my-appeals-title"><MessageSquare size={20} aria-hidden="true" />Мои обращения{appeals.data && <span className="count-pill">{appeals.data.total}</span>}</h3>
        <ResourceState loading={appeals.loading} error={appeals.error} onRetry={appeals.refresh}>
          {appeals.data && (appeals.data.appeals.length ? <ul className="my-tasks-list">{appeals.data.appeals.slice(0, 3).map(item => <li key={item.id}>
            <div className="my-tasks-item-heading"><h4>{item.subject}</h4><span className={'badge ' + (item.status === 'resolved' ? 'green-badge' : item.status === 'rejected' ? 'orange-badge' : 'blue-badge')}>{appealStatuses[item.status]}</span></div>
            <p className="my-tasks-note">Обновлено <time dateTime={item.updatedAt}>{formatSiteDate(item.updatedAt)}</time></p>
            <a className="button outline" href={departmentLink('appeals', 'appeal', item.id) + '&scope=mine'}>{item.status === 'resolved' || item.status === 'rejected' ? 'Открыть ответ' : 'Открыть обращение'}</a>
          </li>)}</ul> : <p className="my-tasks-empty">Вы ещё не подавали обращения.</p>)}
        </ResourceState>
        <a className="text-button my-tasks-more" href={ownAppealsLink}>Все мои обращения</a>
      </article>
    </div>
  </section>;
}

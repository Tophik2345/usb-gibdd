import { useEffect, useState } from 'react';
import { CalendarClock, ChartNoAxesCombined, ClipboardCheck, GraduationCap, Loader2, RefreshCw } from 'lucide-react';
import { dashboardApi, type Dashboard } from '@/lib/dashboard-api';
import { formatSiteDate } from '@/lib/date-time';
import { resultPassed } from '@/lib/results-export';
import './leader-dashboard.css';

export default function LeaderDashboard({ onAssignment, onAssignments, onResult, onResults, onClearance }:{
  onAssignment: (id: string) => void; onAssignments: () => void; onResult: (id: string) => void;
  onResults: () => void; onClearance: (userId?: string) => void;
}) {
  const [days, setDays] = useState(30), [revision, setRevision] = useState(0);
  const [data, setData] = useState<Dashboard | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true; setData(null); setError(''); setLoading(true);
    dashboardApi<Dashboard>({ days }).then(next => { if (active) setData(next); })
      .catch(cause => { if (active) setError(cause.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [days, revision]);
  const percent = (value: number | null) => value === null ? '—' : value.toLocaleString('ru-RU') + '%';
  const tests = data?.tests, clearances = data?.clearances;
  return <section className="leader-dashboard" aria-labelledby="dashboard-title">
    <header className="page-heading"><div><div className="eyebrow">КОНТРОЛЬ ПОДГОТОВКИ</div><h1 id="dashboard-title">Сводка руководителя</h1><p>Задания, результаты проверок и заявки на допуск.</p></div><button type="button" className="button outline" disabled={loading} onClick={() => setRevision(n => n + 1)}><RefreshCw size={17} aria-hidden="true"/>Обновить сводку</button></header>
    <div className="dashboard-controls">{(!data||tests)&&<label className="field">Период результатов<select value={days} onChange={e => setDays(Number(e.target.value))}><option value={7}>7 дней</option><option value={30}>30 дней</option><option value={90}>90 дней</option></select></label>}{data && <p>Обновлено: {formatSiteDate(data.serverNow)}<br/>Сроки и заявки показаны на текущий момент.</p>}</div>
    {loading && <p className="dashboard-loading" role="status"><Loader2 size={19} className="spin" aria-hidden="true"/>Загружаем сводку…</p>}
    {error && <div className="error-banner" role="alert"><span>{error}</span><button type="button" className="button outline" onClick={() => setRevision(n => n + 1)}>Повторить</button></div>}
    {tests && <>
      <div className="dashboard-metrics" aria-label="Показатели назначений"><article><ClipboardCheck size={21} aria-hidden="true"/><span>Активных заданий</span><strong>{tests.activeAssignments}</strong></article><article className="dashboard-urgent"><CalendarClock size={21} aria-hidden="true"/><span>Просрочено</span><strong>{tests.overdueAssignments}</strong></article><article><CalendarClock size={21} aria-hidden="true"/><span>Срок в ближайшие 24 часа</span><strong>{tests.dueSoonAssignments}</strong></article></div>
      <div className="dashboard-section-heading"><div><h2>Результаты за {data!.period.days} дней</h2><p>{data!.period.from.split('-').reverse().join('.')} — {data!.period.to.split('-').reverse().join('.')} · МСК</p></div><button type="button" className="text-button" onClick={onResults}>Все результаты</button></div>
      <div className="dashboard-metrics dashboard-results" aria-label="Показатели результатов"><article><ChartNoAxesCombined size={21} aria-hidden="true"/><span>Завершено проверок</span><strong>{tests.finishedExams}</strong><small>Зачёт: {tests.passedExams} · Без зачёта: {tests.failedExams}</small></article><article><ClipboardCheck size={21} aria-hidden="true"/><span>Доля с зачётом</span><strong>{percent(tests.passRate)}</strong></article><article><ChartNoAxesCombined size={21} aria-hidden="true"/><span>Средний результат</span><strong>{percent(tests.averageScore)}</strong></article></div><p className="dashboard-caption">Учитываются завершённые проверки за выбранный период. Повторные попытки сохраняются в статистике; тренировки и учебный пример исключены.</p>
      <div className="dashboard-columns"><section className="dashboard-panel" aria-labelledby="dashboard-overdue"><div className="dashboard-section-heading"><h2 id="dashboard-overdue">Просроченные задания <span className="count-pill">{tests.overdueAssignments}</span></h2><button type="button" className="text-button" onClick={onAssignments}>Все назначения</button></div>
        {!tests.overdue.length ? <p className="dashboard-empty">Просроченных заданий нет.</p> : <><ul className="dashboard-list">{tests.overdue.map(item => <li key={item.id}><div><h3>{item.testTitle}</h3><p>{item.employeeLogin}</p><time dateTime={item.dueAt}>Срок: {formatSiteDate(item.dueAt)}</time></div><button type="button" className="button outline" onClick={() => onAssignment(item.id)}>Открыть назначение</button></li>)}</ul><p className="dashboard-caption">Показано {tests.overdue.length} из {tests.overdueAssignments}. Сначала самые ранние сроки.</p></>}
      </section><section className="dashboard-panel" aria-labelledby="dashboard-recent"><div className="dashboard-section-heading"><h2 id="dashboard-recent">Последние результаты</h2></div>
        {!tests.recentResults.length ? <p className="dashboard-empty">За этот период завершённых проверок нет.</p> : <ul className="dashboard-list">{tests.recentResults.map(item => <li key={item.id}><div><h3>{item.testTitle}</h3><p>{item.employeeName}</p><span className={'badge '+(resultPassed(item)?'green-badge':'orange-badge')}>{resultPassed(item)?'Зачёт':'Без зачёта'} · {percent(item.score === null ? null : Math.round(item.score / item.total * 1000) / 10)}</span><time dateTime={item.finishedAt!}>{formatSiteDate(item.finishedAt!)}</time></div><button type="button" className="button outline" onClick={() => onResult(item.id)}>Открыть результат</button></li>)}</ul>}
      </section></div>
    </>}
    {clearances ? <section className="dashboard-panel dashboard-clearances" aria-labelledby="dashboard-clearances"><div className="dashboard-section-heading"><div><h2 id="dashboard-clearances"><GraduationCap size={23} aria-hidden="true"/>Ожидают решения по допуску <span className="count-pill">{clearances.pendingCount}</span></h2><p>Актуальные заявки действующих сотрудников.</p></div><button type="button" className="text-button" onClick={() => onClearance()}>Подготовка сотрудников</button></div>
      {!clearances.pending.length ? <p className="dashboard-empty">Заявок, ожидающих решения, нет.</p> : <><ul className="dashboard-list">{clearances.pending.map(person => <li key={person.userId}><div><h3>{person.login}</h3><time dateTime={person.requestedAt}>Заявка: {formatSiteDate(person.requestedAt)}</time></div><button type="button" className="button outline" onClick={() => onClearance(person.userId)}>Рассмотреть заявку</button></li>)}</ul><p className="dashboard-caption">Показано {clearances.pending.length} из {clearances.pendingCount}. Сначала более ранние заявки.</p></>}
    </section> : data && <p className="dashboard-caption">Заявки на допуск доступны владельцу и заместителю.</p>}
    {data && !tests && <p className="dashboard-caption">Назначения и результаты сотрудников доступны от звания «Капитан».</p>}
  </section>;
}

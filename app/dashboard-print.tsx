import { createPortal } from 'react-dom';
import type { Dashboard } from '@/lib/dashboard-api';
import { formatSiteDate } from '@/lib/date-time';
import { resultPassed } from '@/lib/results-export';
import './dashboard-print.css';

export default function DashboardPrint({ data }: { data: Dashboard }) {
  const percent = (value: number | null) => value === null ? '—' : value.toLocaleString('ru-RU') + '%';
  const tests = data.tests, clearances = data.clearances;
  return createPortal(<article className="dashboard-print-root" aria-hidden="true">
    <header><p>УСБ ГИБДД · Россия Онлайн · Кутузовский</p><h1>Сводка руководителя</h1><p>Сформировано: {formatSiteDate(data.serverNow)}</p></header>
    {tests && <><h2>Назначения на текущий момент</h2><table><tbody>{[['Активных заданий',tests.activeAssignments],['Просрочено',tests.overdueAssignments],['Срок в ближайшие 24 часа',tests.dueSoonAssignments]].map(([label,value]) => <tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>)}</tbody></table>
      <h2>Результаты за {data.period.days} дней</h2><p>{data.period.from.split('-').reverse().join('.')} — {data.period.to.split('-').reverse().join('.')} · МСК</p><table><tbody>{[['Завершено проверок',tests.finishedExams],['Зачёт',tests.passedExams],['Без зачёта',tests.failedExams],['Доля с зачётом',percent(tests.passRate)],['Средний результат',percent(tests.averageScore)]].map(([label,value]) => <tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>)}</tbody></table><p>Тренировки и учебный пример исключены. Все завершённые повторные проверки учтены.</p>
      <h2>Просроченные задания</h2><p>Показано {tests.overdue.length} из {tests.overdueAssignments}. Сначала самые ранние сроки.</p>{tests.overdue.length > 0 && <table><thead><tr><th>Сотрудник</th><th>Тест</th><th>Срок, МСК</th></tr></thead><tbody>{tests.overdue.map(item => <tr key={item.id}><td>{item.employeeLogin}</td><td>{item.testTitle}</td><td>{formatSiteDate(item.dueAt)}</td></tr>)}</tbody></table>}
      <h2>Последние результаты</h2><p>Показано {tests.recentResults.length} из {tests.finishedExams} проверок за период.</p>{tests.recentResults.length > 0 && <table><thead><tr><th>Сотрудник</th><th>Тест</th><th>Завершено, МСК</th><th>Результат</th></tr></thead><tbody>{tests.recentResults.map(item => <tr key={item.id}><td>{item.employeeName}</td><td>{item.testTitle}</td><td>{formatSiteDate(item.finishedAt!)}</td><td>{percent(item.score === null ? null : Math.round(item.score / item.total * 1000) / 10)} · {resultPassed(item) ? 'Зачёт' : 'Без зачёта'}</td></tr>)}</tbody></table>}</>}
    {clearances && <><h2>Ожидают решения по допуску</h2><p>Актуальных заявок действующих сотрудников: {clearances.pendingCount}. Показано {clearances.pending.length}. Сначала более ранние заявки.</p>{clearances.pending.length > 0 && <table><thead><tr><th>Сотрудник</th><th>Заявка, МСК</th></tr></thead><tbody>{clearances.pending.map(person => <tr key={person.userId}><td>{person.login}</td><td>{formatSiteDate(person.requestedAt)}</td></tr>)}</tbody></table>}</>}
    <footer>Отчёт отражает данные на момент формирования и разделы, доступные пользователю.</footer>
  </article>, document.body);
}

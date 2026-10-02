import { ArrowRight } from 'lucide-react';
import type { Attempt } from '@/lib/types';
import { formatSiteDate } from '@/lib/date-time';
import { resultPassed, resultStatus } from '@/lib/results-export';

export function resultPercentage(row: Attempt) {
  return row.score !== null && row.total > 0
    ? `${Number((row.score * 100 / row.total).toFixed(1)).toLocaleString('ru-RU')}%`
    : '—';
}

export function ResultNotes({ row }: { row: Attempt }) {
  return <>
    {row.mode === 'practice' && <small>Работа над ошибками</small>}
    {row.assignmentId && <small>{row.assignmentReset ? 'Обнулённое назначение' : row.assignmentCancelled ? 'Отменённое назначение' : 'По назначению'}</small>}
    {row.demo && <small>Демонстрация</small>}
  </>;
}

export default function ResultCards({ rows, employees, onOpen }: {
  rows: Attempt[];
  employees: boolean;
  onOpen?: (id: string) => void;
}) {
  return <ul className="results-cards" aria-label="Результаты проверок">
    {rows.map(row => <li key={row.id}>
      <article className="result-card" aria-labelledby={`result-title-${row.id}`}>
        {employees && <p className="result-employee">{row.employeeName}</p>}
        <h3 id={`result-title-${row.id}`}>{row.testTitle}</h3>
        <div className="result-notes"><ResultNotes row={row} /></div>
        <div className="result-card-outcome">
          <strong>{resultPercentage(row)}</strong>
          <span className={'badge ' + (resultPassed(row) ? 'green-badge' : 'orange-badge')}>{resultStatus(row)}</span>
        </div>
        <p className="result-answers">Верно: <strong>{row.score} из {row.total}</strong></p>
        <time dateTime={row.finishedAt!}>{formatSiteDate(row.finishedAt!, { month: 'short' })}</time>
        {onOpen && <button className="text-button result-review" type="button" onClick={() => onOpen(row.id)}>
          Разбор<span className="sr-only">: {row.testTitle}{employees ? `, ${row.employeeName}` : ''}</span><ArrowRight size={16} aria-hidden="true" />
        </button>}
      </article>
    </li>)}
  </ul>;
}

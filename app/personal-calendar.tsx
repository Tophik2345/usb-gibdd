import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import type { Assignment } from '@/lib/types';
import { calendarDays, shiftMonth } from '@/lib/personal-calendar';
import { formatSiteDate, toSiteDateTimeInput } from '@/lib/date-time';
import './personal-tools.css';

export default function PersonalCalendar({ assignments, error, onRefresh, onAssignment }: { assignments: Assignment[]; error: string; onRefresh: () => Promise<void>; onAssignment: (id: string) => void }) {
  const [now, setNow] = useState(Date.now), [busy, setBusy] = useState(false);
  const today = toSiteDateTimeInput(now).slice(0, 10);
  const [month, setMonth] = useState(today.slice(0, 7)), [selected, setSelected] = useState(today);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(timer); }, []);
  const active = assignments.filter(item => item.status === 'assigned' || item.status === 'overdue').sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  const dayOf = (item: Assignment) => toSiteDateTimeInput(item.dueAt).slice(0, 10);
  const overdue = active.filter(item => Date.parse(item.dueAt) <= now), days = calendarDays(month), events = active.filter(item => dayOf(item) === selected);
  const choose = (day: string) => { setSelected(day); setMonth(day.slice(0, 7)); };
  const changeMonth = (delta: number) => { const next = shiftMonth(month, delta); setMonth(next); setSelected(next + '-01'); };
  return <section className="personal-tool" aria-labelledby="calendar-title"><header className="page-heading"><div><div className="eyebrow">МОИ ЗАДАНИЯ</div><h1 id="calendar-title">Календарь сроков</h1><p>Активные задания по московскому времени. Завершённые назначения доступны в истории заданий.</p></div><button type="button" className="button outline" disabled={busy} onClick={async () => { setBusy(true); try { await onRefresh(); setNow(Date.now()); } finally { setBusy(false); } }}><RefreshCw size={17} aria-hidden="true"/>{busy ? 'Обновляем…' : 'Обновить задания'}</button></header>
    {error && <p className="error-banner" role="alert">{error} Показаны последние загруженные задания.</p>}
    <p>Активных заданий: <strong>{active.length}</strong>. Просрочено: <strong>{overdue.length}</strong>.</p>{overdue.length > 0 && <button type="button" className="button outline" onClick={() => choose(dayOf(overdue[0]))}>К самому раннему просроченному сроку</button>}
    <div className="calendar-controls"><h2>{new Date(month + '-01T12:00:00Z').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' })}</h2><div className="calendar-buttons"><button type="button" className="button outline" aria-label="Предыдущий месяц" onClick={() => changeMonth(-1)}><ChevronLeft size={18}/></button><button type="button" className="button outline" onClick={() => choose(today)}>Сегодня</button><button type="button" className="button outline" aria-label="Следующий месяц" onClick={() => changeMonth(1)}><ChevronRight size={18}/></button></div></div>
    <table className="deadline-calendar" aria-label="Сроки моих заданий по МСК"><thead><tr>{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(day => <th scope="col" key={day}>{day}</th>)}</tr></thead><tbody>{Array.from({ length: 6 }, (_, week) => <tr key={week}>{days.slice(week * 7, week * 7 + 7).map(day => {
      const list = active.filter(item => dayOf(item) === day), late = list.some(item => Date.parse(item.dueAt) <= now);
      return <td key={day}><button type="button" className={day.startsWith(month) ? '' : 'outside-month'} aria-pressed={selected === day} aria-current={day === today ? 'date' : undefined} aria-label={new Date(day + 'T12:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' }) + `, заданий: ${list.length}${late ? ', есть просроченные' : ''}`} onClick={() => choose(day)}><span className="calendar-day">{Number(day.slice(-2))}</span>{list.length > 0 && <span className={'calendar-count' + (late ? ' overdue' : '')}>{late ? '!' : ''} {list.length} зад.</span>}</button></td>;
    })}</tr>)}</tbody></table>
    <section className="calendar-day-events" aria-labelledby="calendar-day-title" aria-live="polite"><h2 id="calendar-day-title">Сроки на {new Date(selected + 'T12:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' })}</h2>{!events.length ? <p>На этот день сроков нет.</p> : <ul className="calendar-events">{events.map(item => <li key={item.id}><div><h3>{item.testTitle}</h3><time dateTime={item.dueAt}>{formatSiteDate(item.dueAt)}</time><p>{Date.parse(item.dueAt) <= now ? 'Просрочено' : item.inProgressAttemptId ? 'Начато, ответы сохранены' : 'Ожидает прохождения'}</p></div><button type="button" className="button outline" onClick={() => onAssignment(item.id)}>Открыть задание</button></li>)}</ul>}</section><a className="button outline" href="#profile">Вернуться в профиль</a>
  </section>;
}

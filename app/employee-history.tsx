import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { historyApi, type HistoryPage } from '@/lib/history-api';
import { formatSiteDate } from '@/lib/date-time';
import './personal-tools.css';

function readPerson() { return new URLSearchParams(window.location.hash.split('?')[1] || '').get('user') || ''; }
export default function EmployeeHistory({ onResult }: { onResult: (id: string) => void }) {
  const [person, setPerson] = useState(readPerson);
  useEffect(() => { const update = () => setPerson(readPerson()); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  return <HistoryEntries key={person} person={person} onResult={onResult}/>;
}
function HistoryEntries({ person, onResult }: { person: string; onResult: (id: string) => void }) {
  const [data, setData] = useState<HistoryPage | null>(null), [kind, setKind] = useState('all'), [revision, setRevision] = useState(0), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  useEffect(() => {
    let active = true; setData(null); setError(''); setLoading(true);
    historyApi({ ...(person ? { userId: person } : {}), kind }).then(next => { if (active) setData(next); }).catch(cause => { if (active) setError(cause.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [person, kind, revision]);
  useEffect(() => { let active = true; if (!more || !data?.nextCursor) return;
    historyApi({ userId: data.userId, kind, snapshot: data.snapshot, cursor: data.nextCursor }).then(next => { if (active) setData(previous => previous && ({ ...next, items: [...previous.items, ...next.items] })); }).catch(cause => { if (active) setError(cause.message); }).finally(() => { if (active) setMore(false); });
    return () => { active = false; };
  }, [more, person, kind, revision]);
  return <section className="personal-tool" aria-labelledby="history-title"><header className="page-heading"><div><div className="eyebrow">СОХРАНЁННЫЕ СОБЫТИЯ</div><h1 id="history-title">История сотрудника</h1><p>{data ? data.displayName : 'Результаты, повышения и решения по допуску.'}</p></div><button type="button" className="button outline" disabled={loading || more} onClick={() => setRevision(n => n + 1)}><RefreshCw size={17} aria-hidden="true"/>Обновить историю</button></header>
    {loading && <p role="status">Загружаем историю…</p>}{error && <div className="error-banner" role="alert"><span>{error}</span><button className="button outline" disabled={more} onClick={() => { setError(''); data?.nextCursor ? setMore(true) : setRevision(n => n + 1); }}>Повторить</button></div>}
    {data && <><p className="helper">Показаны сохранённые проверки, повышения и решения в пределах ваших прав. После обнуления назначения результаты остаются в истории. Текущий допуск проверяйте в разделе подготовки.</p>
      <nav className="tool-filters" aria-label="Тип событий">{[['all','Все события'],...(data.permissions.results ? [['result','Результаты']] : []),...(data.permissions.ranks ? [['rank','Повышения']] : []),...(data.permissions.clearances ? [['clearance','Допуски']] : [])].map(([id, title]) => <button type="button" className="button outline" key={id} aria-pressed={kind === id} disabled={more} onClick={() => setKind(id)}>{title}</button>)}</nav>
      <ul className="history-events">{data.items.map(item => <li key={item.id}><time dateTime={item.createdAt}>{formatSiteDate(item.createdAt)}</time><h3>{item.title}</h3><p>{item.summary}</p>{item.kind === 'result' ? <button type="button" className="text-button" onClick={() => onResult(item.targetId)}>Открыть результат</button> : <a href={item.kind === 'rank' ? '#department?tab=staff&member=' + encodeURIComponent(data.userId) : data.own ? '#training?tab=admission' : '#training?tab=team&person=' + encodeURIComponent(data.userId)}>{item.kind === 'rank' ? 'Служебный профиль' : 'Текущий допуск'}</a>}</li>)}</ul>
      {!data.items.length && <p>Сохранённых событий этого типа пока нет.</p>}{data.nextCursor && <button type="button" className="button outline" disabled={more} onClick={() => { setError(''); setMore(true); }}>{more ? 'Загружаем…' : 'Показать ещё события'}</button>}<p className="history-count">Показано {data.items.length} из {data.total}.</p>
      {data.permissions.others && <a className="button outline" href="#department?tab=staff">Выбрать сотрудника в составе</a>}
    </>}<p><a href="#profile">В мой профиль</a></p>
  </section>;
}

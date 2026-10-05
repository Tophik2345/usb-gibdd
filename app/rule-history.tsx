import { useEffect, useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import { loadRevision, useRuleHistory, ruleChangesSummary, type RuleRevision, type RuleRevisionDetail } from '@/lib/rule-history';
import { formatSiteDate } from '@/lib/date-time';
import './site-improvements.css';

export default function RuleHistoryPanel({ document }: { document?: string }) {
  const { history, error, refresh } = useRuleHistory();
  const [filter, setFilter] = useState(document || 'all'), [limit, setLimit] = useState(10);
  useEffect(() => { setFilter(document || 'all'); setLimit(10); }, [document]);
  const revisions = history.revisions.filter(revision => filter === 'all' || revision.document === filter);
  return <section className="rule-history-panel" id="rule-history" aria-labelledby="rule-history-title">
    <h2 id="rule-history-title"><History size={22}/>История изменений правил</h2>
    <p className="helper">Наблюдение началось {formatSiteDate(history.startedAt)}. Сравнение сохраняется при изменении текста, а не при каждой проверке источника.</p>
    <label className="field">Документ<select value={filter} onChange={event => { setFilter(event.target.value); setLimit(10); }}><option value="all">Все документы и правила</option>{history.documents.map(doc => <option value={doc.id} key={doc.id}>{doc.title}</option>)}</select></label>
    {error && <p className="inline-error" role="alert">{error} <button className="text-button" onClick={refresh}>Повторить</button></p>}
    {!revisions.length ? <p className="history-empty">После включения истории изменений в выбранных документах пока не зафиксировано.</p> : revisions.slice(0, limit).map(revision => <Revision key={revision.id} revision={revision}/>)}
    {revisions.length > limit && <button className="button outline" onClick={() => setLimit(value => value + 10)}>Показать ещё изменения</button>}
  </section>;
}
function Revision({ revision }: { revision: RuleRevision }) {
  const [open, setOpen] = useState(false), [data, setData] = useState<RuleRevisionDetail | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => { if (!open || data) return; let active = true; setError(''); void loadRevision(revision).then(next => { if (active) setData(next); }).catch(cause => { if (active) setError(cause.message); }); return () => { active = false; }; }, [open, data, revision, retry]);
  return <details className="rule-revision" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary><strong>{revision.title}</strong><span>{formatSiteDate(revision.detectedAt)} · {ruleChangesSummary(revision)}</span></summary>
    <p className="helper">Обнаружено при проверке источника.{revision.sourceEditedAt && <> Правка на форуме: {formatSiteDate(revision.sourceEditedAt)}.</>} <a href={revision.sourceUrl} target="_blank" rel="noopener noreferrer">Официальный источник ↗</a></p>
    {error ? <p role="alert">{error} <button className="text-button" onClick={() => setRetry(value => value + 1)}>Повторить</button></p> : !data ? <p role="status"><Loader2 size={18} className="spin"/>Загружаем сравнение…</p> : data.changes.map(change => <article className="rule-change" key={change.id}><h3>{change.type === 'added' ? 'Добавлено' : change.type === 'removed' ? 'Удалено' : 'Изменено'} · {(change.after || change.before)!.title || 'Вводные положения'}</h3>
      <div className="rule-comparison">{(['before', 'after'] as const).map(side => <div key={side}><h4>{side === 'before' ? 'До изменения' : 'После изменения'}</h4>{change[side] ? <><p className="helper">{change[side]!.chapter}</p><p>{change[side]!.title}</p>{change[side]!.paragraphs.map((text, index) => <p key={index}>{text}</p>)}</> : <p className="helper">{side === 'before' ? 'Положения не было.' : 'Положение удалено.'}</p>}</div>)}</div>
      {change.after?.kind === 'article' && <a className="text-button" href={revision.document === 'state-organizations' ? '#new-employees?topic=project-rules' : `#laws?document=${revision.document}&article=${change.id}`}>Открыть действующий текст →</a>}
    </article>)}
  </details>;
}

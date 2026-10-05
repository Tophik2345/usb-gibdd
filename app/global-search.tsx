import { useEffect, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { useLawDocuments } from '@/lib/law-updates';
import { loadDocument } from '@/lib/law-loader';
import { useProjectRules } from '@/lib/project-rules';
import { searchApi, searchGuides, searchLaws, type SearchItem, type SearchPage } from '@/lib/site-search';
import './personal-tools.css';

function readQuery() { return new URLSearchParams(window.location.hash.split('?')[1] || '').get('q') || ''; }
function safeHref(href?: string) { return href && /^#(?:laws|training|new-employees|duties)(?:\?|$)/.test(href) ? href : '#training'; }
function Items({ items, onTest }: { items: SearchItem[]; onTest: (id: string) => Promise<void> }) {
  const [pending, setPending] = useState(''), [error, setError] = useState('');
  return <>{error && <p className="error-banner" role="alert">{error}</p>}<ul className="search-results">{items.map(item => <li key={item.id}>
    <span className="eyebrow">{item.source}</span><h3>{item.kind === 'test'
      ? <button type="button" className="text-button" disabled={!!pending} onClick={async () => { setPending(item.id); setError(''); try { await onTest(item.targetId!); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось открыть тест.'); } finally { setPending(''); } }}>{item.title}{pending === item.id && <Loader2 size={16} className="spin" aria-hidden="true"/>}</button>
      : <a href={safeHref(item.href)}>{item.title}</a>}</h3><p>{item.summary}</p>
  </li>)}</ul></>;
}
function RemoteResults({ kind, query, onTest }: { kind: 'test' | 'material'; query: string; onTest: (id: string) => Promise<void> }) {
  const [data, setData] = useState<SearchPage | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [revision, setRevision] = useState(0);
  const [more, setMore] = useState(false);
  useEffect(() => {
    let active = true; setData(null); setError(''); setLoading(true);
    searchApi<SearchPage>({ query, kind }).then(next => { if (active) setData(next); }).catch(cause => { if (active) setError(cause.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [kind, query, revision]);
  // A new query mounts a new panel, so a late page cannot enter another query's results.
  useEffect(() => { let active = true; if (!more || !data?.nextCursor) return;
    searchApi<SearchPage>({ query, kind, cursor: data.nextCursor }).then(next => { if (active) setData(previous => previous && ({ ...next, items: [...previous.items, ...next.items] })); }).catch(cause => { if (active) setError(cause.message); }).finally(() => { if (active) setMore(false); });
    return () => { active = false; };
  }, [more]);
  return <section className="search-group" aria-label={kind === 'test' ? 'Тесты' : 'Материалы подготовки'}><h2>{kind === 'test' ? 'Тесты' : 'Материалы подготовки'}{data && <span className="count-pill">{data.total}</span>}</h2>
    {loading && <p role="status">Ищем…</p>}{error && <div className="error-banner" role="alert"><span>{error}</span><button className="button outline" onClick={() => { setError(''); data?.nextCursor ? setMore(true) : setRevision(n => n + 1); }} disabled={more}>Повторить</button></div>}
    {data && <><Items items={data.items} onTest={onTest}/>{!data.total && <p>Совпадений нет.</p>}{data.nextCursor && <button className="button outline" disabled={more} onClick={() => { setError(''); setMore(true); }}>{more ? 'Загружаем…' : 'Показать ещё'}</button>}<p className="helper">Показано {data.items.length} из {data.total}.</p></>}
  </section>;
}
export default function GlobalSearch({ signedIn, onTest }: { signedIn: boolean; onTest: (id: string) => Promise<void> }) {
  const {documents}=useLawDocuments();
  const { cards: projectCards } = useProjectRules();
  const [query, setQuery] = useState(readQuery), [input, setInput] = useState(readQuery), [filter, setFilter] = useState('all');
  const locationQuery = useRef(query);
  const [laws, setLaws] = useState<SearchItem[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0), [limit, setLimit] = useState(24);
  const valid = query.trim().length >= 2 && query.length <= 100;
  useEffect(() => { const update = () => { const q = readQuery(); if (q === locationQuery.current) return; locationQuery.current = q; setQuery(q); setInput(q); }; window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  useEffect(() => {
    let active = true; setLaws([]); setError(''); setLimit(24); if (!valid) return;
    setLoading(true); Promise.allSettled(documents.map(doc => loadDocument(doc.id))).then(results => {
      if (!active) return; setLaws(searchLaws(results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []), query));
      if (results.some(result => result.status === 'rejected')) setError('Часть законов не загрузилась. Показаны доступные совпадения.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, valid, revision, documents]);
  const guides = valid ? searchGuides(query, projectCards) : [];
  return <section className="personal-tool" aria-labelledby="search-title"><header className="page-heading"><div><div className="eyebrow">БЫСТРЫЙ ПЕРЕХОД</div><h1 id="search-title">Поиск по сайту</h1><p>Найди тест, статью закона или учебную памятку.</p></div></header>
    <form className="site-search-form" onSubmit={event => { event.preventDefault(); const q = input.trim().replace(/\s+/g, ' '); locationQuery.current = q; setQuery(q); setInput(q); window.location.hash = 'search?q=' + encodeURIComponent(q); }}><label className="field">Что найти<input type="search" required minLength={2} maxLength={100} value={input} onChange={event => setInput(event.target.value)} placeholder="Например: задержание или статья 12.1"/></label><button className="button primary" type="submit"><Search size={18} aria-hidden="true"/>Найти</button></form>
    {!signedIn && <p className="helper"><a href="#account">Войдите</a>, чтобы искать тесты и материалы подготовки.</p>}
    {!valid ? <p>Введите от 2 до 100 символов. Можно искать по нескольким словам.</p> : <>
      <nav className="tool-filters" aria-label="Тип результатов">{[['all','Всё'],['test','Тесты'],['law','Законы'],['material','Материалы']].map(([id, title]) => <button type="button" className="button outline" aria-pressed={filter === id} key={id} onClick={() => setFilter(id)}>{title}</button>)}</nav>
      {(filter === 'all' || filter === 'test') && signedIn && <RemoteResults key={'test:' + query + ':' + revision} kind="test" query={query} onTest={onTest}/>}
      {(filter === 'all' || filter === 'law') && <section className="search-group"><h2>Законы <span className="count-pill">{laws.length}</span></h2>{loading && <p role="status">Ищем в законах…</p>}{error && <div className="error-banner" role="alert"><span>{error}</span><button className="button outline" onClick={() => setRevision(n => n + 1)}>Повторить</button></div>}<Items key={query} items={laws.slice(0, limit)} onTest={onTest}/>{!loading && !laws.length && <p>Совпадений нет.</p>}{laws.length > limit && <button className="button outline" onClick={() => setLimit(n => n + 24)}>Показать ещё статьи</button>}</section>}
      {(filter === 'all' || filter === 'material') && <><section className="search-group"><h2>Памятки <span className="count-pill">{guides.length}</span></h2><Items key={query} items={guides} onTest={onTest}/>{!guides.length && <p>Совпадений нет.</p>}</section>{signedIn && <RemoteResults key={'material:' + query + ':' + revision} kind="material" query={query} onTest={onTest}/>}</>}
    </>}
  </section>;
}

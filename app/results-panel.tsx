import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Download, FileSearch, ListChecks, Loader2, SlidersHorizontal } from 'lucide-react';
import { resultsApi, exportResults, emptyResultsFilters, type ResultScope, type ResultsFilters, type ResultCursor, type ResultsPage } from '@/lib/results-api';
import { resultStatus, resultPassed } from '@/lib/results-export';
import { formatSiteDate } from '@/lib/date-time';
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import ResultCards, { ResultNotes, resultPercentage } from './result-cards';

const narrowQuery = '(max-width: 760px)';
function subscribeLayout(onChange: () => void) {
  const media = window.matchMedia(narrowQuery);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
const narrowLayout = () => window.matchMedia(narrowQuery).matches;

function filterLabels(filters: ResultsFilters, tests: { id: string; title: string }[], scope: ResultScope) {
  const dateLabel = (value: string) => value.split('-').reverse().join('.');
  return [
    filters.testId && 'Тест: ' + (tests.find(test => test.id === filters.testId)?.title || 'выбранный тест'),
    filters.employee.trim() && 'Сотрудник: ' + filters.employee.trim(),
    filters.from && 'С ' + dateLabel(filters.from) + ' (МСК)',
    filters.to && 'По ' + dateLabel(filters.to) + ' (МСК)',
    filters.minScore !== '' && 'Оценка от ' + filters.minScore + '%',
    filters.maxScore !== '' && 'Оценка до ' + filters.maxScore + '%',
    filters.status !== 'all' && (filters.status === 'passed'
      ? scope === 'practice' ? 'Без ошибок' : 'Зачёт'
      : scope === 'practice' ? 'Есть ошибки' : 'Не зачтено'),
  ].filter((label): label is string => typeof label === 'string' && label !== '');
}

export default function ResultsPanel({ scope, onOpen }: { scope: ResultScope; onOpen?: (id: string) => void }) {
  const [draft, setDraft] = useState({ ...emptyResultsFilters }), [filters, setFilters] = useState({ ...emptyResultsFilters });
  const [page, setPage] = useState<ResultsPage | null>(null), [history, setHistory] = useState<(ResultCursor | null)[]>([null]);
  const [snapshot, setSnapshot] = useState<string | undefined>(), [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [exporting, setExporting] = useState(false), [progress, setProgress] = useState('');
  const exportId = useRef(0);
  const [tests, setTests] = useState<{ id: string; title: string }[]>([]);
  const narrow = useSyncExternalStore(subscribeLayout, narrowLayout, () => false);
  const [filtersOpen, setFiltersOpen] = useState(!narrow);
  const filterDetails = useRef<HTMLDetailsElement>(null);
  useEffect(() => setFiltersOpen(!narrow), [narrow]);
  useEffect(() => () => { exportId.current++; }, []);
  const cursor = history[history.length - 1];
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setPage(null);
    resultsApi(scope, filters, cursor, snapshot)
      .then(next => { if (active) { setPage(next); setTests(next.tests); } })
      .catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [scope, filters, cursor, snapshot, revision]);

  function apply(next: ResultsFilters) {
    if (next.from && next.to && next.from > next.to) { setError('Начальная дата должна быть не позже конечной.'); return; }
    if (next.minScore !== '' && next.maxScore !== '' && Number(next.minScore) > Number(next.maxScore)) { setError('Минимальная оценка должна быть не больше максимальной.'); return; }
    setFilters({ ...next }); setHistory([null]); setSnapshot(undefined); setError(''); setProgress('');
    if (narrow) {
      if (filtersOpen) filterDetails.current?.querySelector('summary')?.focus();
      setFiltersOpen(false);
    }
  }
  function resetFilters() { setDraft({ ...emptyResultsFilters }); apply(emptyResultsFilters); }
  function refresh() { setHistory([null]); setSnapshot(undefined); setProgress(''); setRevision(v => v + 1); }

  async function download() {
    if (exporting || loading || !page?.total) return;
    const id = ++exportId.current;
    setExporting(true); setError(''); setProgress('Готовим отчёт…');
    try {
      const csv = await exportResults(scope, filters, () => id !== exportId.current, (loaded, total) => setProgress('Подготовлено ' + loaded + ' из ' + total));
      if (id !== exportId.current) return;
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url; link.download = 'results-' + scope + '.csv';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setProgress('Отчёт готов.');
    } catch (e) {
      if (id === exportId.current) { setError(e instanceof Error ? e.message : 'Не удалось выгрузить отчёт.'); setProgress(''); }
    } finally { if (id === exportId.current) setExporting(false); }
  }
  const change = (key: keyof ResultsFilters, value: string) => setDraft(current => ({ ...current, [key]: value }));
  const employees = scope === 'team' || scope === 'all';
  const labels = filterLabels(filters, tests, scope);

  return <section className="results-panel" aria-label="Фильтры и результаты">
    <details ref={filterDetails} className="results-filter-details" open={filtersOpen} onToggle={e => setFiltersOpen(e.currentTarget.open)}>
      <summary><SlidersHorizontal size={18} aria-hidden="true" /><span>Фильтры результатов</span><small>{labels.length ? 'Применено: ' + labels.length : 'Все результаты'}</small></summary>
      <form className="results-filters" onSubmit={e => { e.preventDefault(); apply(draft); }}>
        <label className="field">Тест<select aria-label="Тест" value={draft.testId} onChange={e => change('testId', e.target.value)} disabled={exporting}><option value="">Все тесты</option>{tests.map(test => <option key={test.id} value={test.id}>{test.title}</option>)}</select></label>
        <label className="field">Сотрудник<input maxLength={100} value={draft.employee} onChange={e => change('employee', e.target.value)} placeholder="Имя или часть имени" disabled={exporting} /></label>
        <label className="field">Дата с (МСК)<input type="date" value={draft.from} onChange={e => change('from', e.target.value)} disabled={exporting} /></label>
        <label className="field">Дата по (МСК)<input type="date" value={draft.to} onChange={e => change('to', e.target.value)} disabled={exporting} /></label>
        <label className="field">Оценка от, %<input type="number" min={0} max={100} step={1} value={draft.minScore} onChange={e => change('minScore', e.target.value)} disabled={exporting} /></label>
        <label className="field">Оценка до, %<input type="number" min={0} max={100} step={1} value={draft.maxScore} onChange={e => change('maxScore', e.target.value)} disabled={exporting} /></label>
        <label className="field">Статус<select aria-label="Статус" value={draft.status} onChange={e => change('status', e.target.value)} disabled={exporting}><option value="all">Все результаты</option><option value="passed">{scope === 'practice' ? 'Без ошибок' : 'Зачёт'}</option><option value="failed">{scope === 'practice' ? 'Есть ошибки' : 'Не зачтено'}</option></select></label>
        <div className="results-filter-actions"><button className="button outline" disabled={exporting} type="submit">Применить</button><button className="text-button" disabled={exporting} type="button" onClick={resetFilters}>Сбросить</button></div>
      </form>
    </details>
    {labels.length > 0 && <div className="results-applied"><ul aria-label="Применённые фильтры">{labels.map(label => <li key={label}>{label}</li>)}</ul><button className="text-button" type="button" disabled={exporting} onClick={resetFilters}>Сбросить фильтры</button></div>}
    <div className="results-toolbar">
      <p role="status">{loading ? 'Загружаем результаты…' : page ? 'Найдено результатов: ' + page.total : 'Результаты не загружены.'}</p>
      <div><button className="text-button" type="button" disabled={exporting || loading} onClick={refresh}>Обновить</button><button className="button outline" type="button" disabled={exporting || loading || !page?.total} onClick={download}>{exporting ? <Loader2 size={17} className="spin" /> : <Download size={17} />}Скачать CSV для Excel</button>{exporting && <button className="text-button" type="button" onClick={() => { exportId.current++; setExporting(false); setProgress('Экспорт отменён.'); }}>Отменить экспорт</button>}</div>
    </div>
    {progress && <p className="table-caption" role="status">{progress}</p>}
    {error && <div className="results-error"><p className="inline-error" role="alert">{error}</p>{!loading && !page && <button className="button outline" type="button" onClick={refresh}>Повторить загрузку</button>}</div>}
    {loading && <div className={'results-loading ' + (narrow ? 'results-loading-cards' : 'results-loading-table')} aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => <div key={index}><Skeleton className="result-loading-title" /><Skeleton className="result-loading-score" /><Skeleton className="result-loading-detail" /></div>)}
    </div>}
    {!loading && page && !page.rows.length && <div className="results-empty-state">
      {labels.length ? <FileSearch size={30} aria-hidden="true" /> : <ListChecks size={30} aria-hidden="true" />}
      <h3>{labels.length ? 'Нет результатов по выбранным фильтрам.' : 'Результатов пока нет'}</h3>
      <p>{labels.length ? 'Измените условия поиска или сбросьте фильтры, чтобы увидеть все результаты.' : scope === 'practice' ? 'После работы над ошибками здесь появятся результаты тренировок.' : 'Завершённые проверки появятся здесь. Можно открыть разбор каждой попытки и выгрузить отчёт.'}</p>
      {labels.length > 0 && <button className="button outline" type="button" disabled={exporting} onClick={resetFilters}>Показать все результаты</button>}
    </div>}
    {page && page.rows.length > 0 && <>
      {narrow ? <ResultCards rows={page.rows} employees={employees} onOpen={onOpen} /> : <div className="results-table"><Table containerLabel="Результаты проверок — прокрутка таблицы"><TableHeader><TableRow>{employees && <TableHead>Сотрудник</TableHead>}<TableHead>Тест</TableHead><TableHead>Дата (МСК)</TableHead><TableHead>Верно</TableHead><TableHead>Результат</TableHead><TableHead>Статус</TableHead>{onOpen && <TableHead><span className="sr-only">Действия</span></TableHead>}</TableRow></TableHeader><TableBody>{page.rows.map(row => <TableRow key={row.id}>{employees && <TableCell>{row.employeeName}</TableCell>}<TableCell className="test-name-cell">{row.testTitle}<ResultNotes row={row} /></TableCell><TableCell>{formatSiteDate(row.finishedAt!, { month: 'short', year: undefined })}</TableCell><TableCell>{row.score} из {row.total}</TableCell><TableCell className="result-score"><strong>{resultPercentage(row)}</strong></TableCell><TableCell><span className={'badge ' + (resultPassed(row) ? 'green-badge' : 'orange-badge')}>{resultStatus(row)}</span></TableCell>{onOpen && <TableCell><button className="text-button" type="button" onClick={() => onOpen(row.id)}>Разбор</button></TableCell>}</TableRow>)}</TableBody></Table></div>}
      <nav className="account-pagination" aria-label="Страницы результатов"><button type="button" className="button outline" disabled={exporting || history.length === 1} onClick={() => setHistory(v => v.slice(0, -1))}>Назад</button><span>Страница {history.length}</span><button type="button" className="button outline" disabled={exporting || !page.nextCursor} onClick={() => { setSnapshot(page.snapshot); setHistory(v => [...v, page.nextCursor]); }}>Далее</button></nav>
    </>}
  </section>;
}

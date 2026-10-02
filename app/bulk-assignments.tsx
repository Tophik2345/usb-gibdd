import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { leadershipApi, type RecipientsPage, type BulkRecipient, type BulkPreview, type BulkResult } from '@/lib/leadership-tools';
import type { Test } from '@/lib/types';
import { formatSiteDate, fromSiteDateTimeInput, toSiteDateTimeInput, SITE_TIME_LABEL } from '@/lib/date-time';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import './leadership-tools.css';

type Prepared = { preview: BulkPreview; payload: Record<string, unknown>; requestId: string };
export default function BulkAssignments({ tests, onRefresh }: { tests: Test[]; onRefresh: () => Promise<void> }) {
  const [testId, setTestId] = useState(tests[0]?.id || ''), [due, setDue] = useState(() => toSiteDateTimeInput(Date.now() + 86400000));
  const [input, setInput] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState<RecipientsPage | null>(null), [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Map<string, BulkRecipient>>(() => new Map()), [loading, setLoading] = useState(true), [more, setMore] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [prepared, setPrepared] = useState<Prepared | null>(null), [result, setResult] = useState<BulkResult | null>(null);
  const live = useRef(true); useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { const timer = window.setTimeout(() => setQuery(input.trim()), 250); return () => window.clearTimeout(timer); }, [input]);
  useEffect(() => { let active = true; setLoading(true); setPage(null); setError('');
    leadershipApi<RecipientsPage>('knowledge_bulk_assign', { action: 'recipients', query }).then(next => { if (active) setPage(next); }).catch(cause => { if (active) setError(cause.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; };
  }, [query, revision]);
  useEffect(() => { let active = true; if (!more || !page?.nextCursor) return;
    leadershipApi<RecipientsPage>('knowledge_bulk_assign', { action: 'recipients', query, cursor: page.nextCursor }).then(next => { if (active) setPage(previous => previous && ({ ...next, items: [...previous.items, ...next.items] })); }).catch(cause => { if (active) setError(cause.message); }).finally(() => { if (active) setMore(false); }); return () => { active = false; };
  }, [more, query]);
  const choose = (person: BulkRecipient, checked: boolean) => setSelected(previous => { const next = new Map(previous); if (checked && next.size < 100) next.set(person.userId, person); else if (!checked) next.delete(person.userId); return next; });
  const prepare = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError(''); setResult(null);
    try { const test = tests.find(item => item.id === testId); const payload = { testId, testVersion: test?.version, userIds: [...selected.keys()], dueAt: fromSiteDateTimeInput(due) };
      const preview = await leadershipApi<BulkPreview>('knowledge_bulk_assign', { action: 'preview', ...payload }); if (live.current) setPrepared({ preview, payload, requestId: crypto.randomUUID() });
    } catch (cause) { if (live.current) setError(cause instanceof Error ? cause.message : 'Проверьте назначение.'); } finally { if (live.current) setBusy(false); }
  };
  const commit = async () => {
    if (!prepared || busy) return; setBusy(true); setError('');
    try { const next = await leadershipApi<BulkResult>('knowledge_bulk_assign', { action: 'create', ...prepared.payload, requestId: prepared.requestId });
      if (!live.current) return; setResult(next); setPrepared(null); setSelected(new Map()); toast.success(`Создано заданий: ${next.createdCount}. Пропущено действующих: ${next.skipCount}.`); void onRefresh();
    } catch (cause) { if (live.current) setError(cause instanceof Error ? cause.message : 'Не удалось назначить тест.'); } finally { if (live.current) setBusy(false); }
  };
  return <section className="bulk-assignments" aria-labelledby="bulk-title"><h2 id="bulk-title">Массовое назначение</h2><p>Выберите до 100 сотрудников и общий срок. Действующие назначения этого теста будут пропущены; попытки и результаты сохраняются.</p>
    <form className="bulk-form" onSubmit={prepare}><div className="bulk-fields"><label className="field">Тест для группы<select required value={testId} disabled={busy || !!prepared || !tests.length} onChange={event => setTestId(event.target.value)}><option value="" disabled>Выберите тест</option>{tests.map(test => <option value={test.id} key={test.id}>{test.title}</option>)}</select></label><label className="field">Общий срок сдачи<input type="datetime-local" required value={due} disabled={busy || !!prepared} min={toSiteDateTimeInput(Date.now())} onChange={event => setDue(event.target.value)}/><small>{SITE_TIME_LABEL}</small></label></div>
      <label className="field">Найти получателей<input type="search" value={input} maxLength={100} disabled={busy || more || !!prepared} onChange={event => setInput(event.target.value)} placeholder="Имя, статик, звание или логин"/></label>
      <div className="bulk-selection-actions"><strong>Выбрано: {selected.size} / 100</strong><button type="button" className="text-button" disabled={busy || !!prepared || !page?.items.length} onClick={() => setSelected(previous => { const next = new Map(previous); for (const person of page?.items || []) { if (next.size >= 100) break; next.set(person.userId, person); } return next; })}>Выбрать показанных</button><button type="button" className="text-button" disabled={busy || !!prepared || !selected.size} onClick={() => setSelected(new Map())}>Очистить выбор</button></div>
      {loading && <p role="status">Загружаем действующий состав…</p>}{!prepared && error && <div className="error-banner" role="alert"><span>{error}</span><button type="button" className="button outline" disabled={busy || more} onClick={() => { setError(''); page?.nextCursor ? setMore(true) : setRevision(n => n + 1); }}>Обновить состав</button></div>}
      {page && <><ul className="bulk-recipients">{page.items.map(person => <li key={person.userId}><label><input type="checkbox" checked={selected.has(person.userId)} disabled={busy || !!prepared || (!selected.has(person.userId) && selected.size >= 100)} onChange={event => choose(person, event.target.checked)}/><span><strong>{person.displayName}</strong><small>{person.rank} · {person.staticId || 'Статик не указан'}<br/>{person.login}</small></span></label></li>)}</ul>{!page.total && <p>Действующих сотрудников по этому запросу нет.</p>}<p className="helper">Показано {page.items.length} из {page.total}. Выбранные сотрудники сохраняются при смене поиска.</p>{page.nextCursor && <button type="button" className="button outline" disabled={more || busy || input.trim() !== query} onClick={() => setMore(true)}>{more ? 'Загружаем…' : 'Показать ещё сотрудников'}</button>}</>}
      <button className="button primary" type="submit" disabled={busy || !!prepared || !selected.size || !testId}>{busy ? 'Проверяем…' : 'Проверить массовое назначение'}</button>
    </form>
    {result && <p className="bulk-result" role="status">{result.testTitle}: создано {result.createdCount}, пропущено действующих {result.skipCount}. Срок: {formatSiteDate(result.dueAt)}.</p>}
    <Dialog open={!!prepared} onOpenChange={open => { if (!open && !busy) { setPrepared(null); setError(''); } }}><DialogContent className="portal-dialog"><DialogHeader><DialogTitle>Проверка массового назначения</DialogTitle><DialogDescription>Действующие задания не обнуляются. Перед отправкой доступ к тесту и состав проверяется ещё раз.</DialogDescription></DialogHeader>{prepared && <><h3>{prepared.preview.test.title}</h3><p>Редакция {prepared.preview.test.version} · {prepared.preview.test.count} вопросов · зачёт от {prepared.preview.test.passMark}%</p><p>Срок: {formatSiteDate(prepared.preview.dueAt)}</p><p>Создать: <strong>{prepared.preview.createCount}</strong> · Пропустить действующих: <strong>{prepared.preview.skipCount}</strong></p><ul className="bulk-preview-list">{prepared.preview.recipients.map(person => <li key={person.userId}><strong>{person.displayName}</strong><span>{person.existingAssignmentId ? 'Уже назначен — пропустить' : 'Создать задание'}</span></li>)}</ul>{error && <p className="inline-error" role="alert">{error}</p>}<div className="bulk-selection-actions"><button type="button" className="button outline" disabled={busy} onClick={() => { setPrepared(null); setError(''); }}>Изменить список</button><button type="button" className="button primary" disabled={busy || !prepared.preview.createCount} onClick={commit}>{busy ? 'Назначаем…' : 'Назначить выбранным'}</button></div></>}</DialogContent></Dialog>
  </section>;
}

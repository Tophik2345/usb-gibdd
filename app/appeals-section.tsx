import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Loader2, MessageSquare, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { appealKinds, appealStatuses, departmentApi, errorMessage, type Appeal, type AppealStatus, type AppealSummary } from '@/lib/department-api';
import { formatSiteDate } from '@/lib/date-time';
import { useDepartmentData } from './use-department-data';
import { departmentLink, DepartmentLoading } from './department-section';

const shortId = (id: string) => id.slice(0, 8).toUpperCase();
function Status({ status }: { status: AppealStatus }) { return <span className={'appeal-status status-' + status}>{appealStatuses[status]}</span>; }
type AppealDraft = { id: string; kind: keyof typeof appealKinds; subject: string; body: string; evidence: string };
export default function AppealsSection({ canManage, appealId, initialScope }: { canManage: boolean; appealId: string | null; initialScope?: string }) {
  const [scope, setScope] = useState(initialScope || (canManage ? 'team' : 'mine'));
  const [status, setStatus] = useState('all');
  const [offset, setOffset] = useState(0);
  useEffect(() => { setScope(initialScope || (canManage ? 'team' : 'mine')); setOffset(0); }, [initialScope, canManage]);
  const [draft, setDraft] = useState<AppealDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const { data, loading, error, refresh } = useDepartmentData<{ total: number; appeals: AppealSummary[] }>({ op: 'appeals', scope: canManage ? scope : 'mine', status, offset });
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); if (!draft || saving) return;
    setSaving(true); setFormError('');
    try {
      const evidence = draft.evidence.split('\n').map(item => item.trim()).filter(Boolean);
      const result = await departmentApi<{ id: string }>({ action: 'createAppeal', ...draft, evidence });
      setDraft(null); refresh(); window.location.hash = departmentLink('appeals', 'appeal', result.id);
      toast.success('Обращение отправлено');
    } catch (cause) { setFormError(errorMessage(cause)); } finally { setSaving(false); }
  };
  return <div className="department-content"><div className="portal-heading"><div><h2><MessageSquare size={24} />Обращения в УСБ</h2><p className="portal-note">Обращение и материалы видны только заявителю, владельцу и заместителю.</p></div><button className="button primary" onClick={() => { setFormError(''); setDraft({ id: crypto.randomUUID(), kind: 'complaint', subject: '', body: '', evidence: '' }); }}><Plus size={17} />Подать обращение</button></div>
    <p className="portal-note">Здесь принимаются внутренние обращения руководству подразделения. Подача на сайте не заменяет установленный порядок обращения в прокуратуру, суд или к администрации проекта.</p>
    {appealId ? <AppealDetails key={appealId} id={appealId} canManage={canManage} onUpdated={refresh} scope={canManage ? scope : 'mine'} /> : <>
      <div className="department-toolbar appeal-filters">{canManage && <label className="field">Очередь<select value={scope} onChange={e => { setScope(e.target.value); setOffset(0); }}><option value="team">Все обращения</option><option value="mine">Мои обращения</option></select></label>}<label className="field">Статус<select value={status} onChange={e => { setStatus(e.target.value); setOffset(0); }}><option value="all">Все статусы</option>{Object.entries(appealStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="button outline" onClick={refresh} disabled={loading}><RefreshCw size={16} />Обновить</button></div>
      {loading || error ? <DepartmentLoading error={error} refresh={refresh} /> : !data?.appeals.length ? <div className="department-empty"><MessageSquare size={30} /><h3>Обращений пока нет</h3><p>{status === 'all' ? 'Здесь появятся обращения и ответы руководства.' : 'По выбранному статусу ничего не найдено.'}</p></div> : <div className="appeal-list">{data.appeals.map(item => <a className="appeal-row department-card" href={departmentLink('appeals', 'appeal', item.id) + '&scope=' + (canManage ? scope : 'mine')} key={item.id}><div><div className="appeal-meta"><span>№ {shortId(item.id)} · {appealKinds[item.kind]}</span><Status status={item.status} /></div><h3>{item.subject}</h3><p className="portal-note">{item.authorLogin} · {formatSiteDate(item.createdAt)}</p></div><ArrowRight size={20} /></a>)}</div>}
      {data && data.total > 20 && <div className="appeal-pagination"><button className="button outline" disabled={offset === 0 || loading} onClick={() => setOffset(value => Math.max(0, value - 20))}><ArrowLeft size={16} />Назад</button><span>{offset + 1}–{Math.min(offset + 20, data.total)} из {data.total}</span><button className="button outline" disabled={offset + 20 >= data.total || loading} onClick={() => setOffset(value => value + 20)}>Далее<ArrowRight size={16} /></button></div>}
    </>}
    <Dialog open={!!draft} onOpenChange={open => { if (!open && !saving) setDraft(null); }}><DialogContent className="portal-dialog"><DialogHeader><DialogTitle>Новое обращение</DialogTitle><DialogDescription>Обращение будет подписано вашим логином. Для жалобы приложите ссылки на доказательства.</DialogDescription></DialogHeader>{draft && <form className="portal-form" onSubmit={create}>
      <label className="field">Тип обращения<select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as AppealDraft['kind'] })}>{Object.entries(appealKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field">Тема<input required minLength={5} maxLength={160} value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} placeholder="Кратко опишите суть обращения" /></label>
      <label className="field">Описание ситуации<textarea required minLength={30} maxLength={12000} rows={7} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} placeholder="Что произошло, когда и где? Укажите имена, статики участников и последовательность событий." /><small>Не менее 30 символов. Время указывайте по МСК.</small></label>
      <label className="field">Ссылки на доказательства{draft.kind !== 'complaint' && ' · необязательно'}<textarea required={draft.kind === 'complaint'} maxLength={7504} rows={4} value={draft.evidence} onChange={e => setDraft({ ...draft, evidence: e.target.value })} placeholder="https://…" /><small>До 5 ссылок HTTPS, каждая с новой строки. Скриншоты, видео или логи должны открываться у рассматривающего обращение.</small></label>
      {formError && <p className="inline-error" role="alert">{formError}</p>}<div className="portal-actions"><button type="button" className="button outline" disabled={saving} onClick={() => setDraft(null)}>Отмена</button><button className="button primary" disabled={saving}>{saving && <Loader2 size={17} className="spin" />}Отправить обращение</button></div>
    </form>}</DialogContent></Dialog>
  </div>;
}

function AppealDetails({ id, canManage, onUpdated, scope }: { id: string; canManage: boolean; onUpdated: () => void; scope: string }) {
  const { data, loading, error, refresh } = useDepartmentData<Appeal>({ op: 'appeal', id });
  return <><div className="department-detail-tools"><a className="department-back" href={departmentLink('appeals') + '&scope=' + scope}><ArrowLeft size={17} />К обращениям</a><button className="button outline" onClick={refresh} disabled={loading}><RefreshCw size={16} />Обновить</button></div>
    {loading || error ? <DepartmentLoading error={error} refresh={refresh} /> : data && <div className="appeal-detail-grid"><article className="department-card appeal-detail"><div className="appeal-meta"><span>№ {shortId(data.id)} · {appealKinds[data.kind]}</span><Status status={data.status} /></div><h3>{data.subject}</h3><p className="portal-note">Заявитель: {data.authorLogin}<br />Подано: {formatSiteDate(data.createdAt)}</p><h4>Описание ситуации</h4><p className="department-preserve">{data.body}</p><h4>Материалы и доказательства</h4>{data.evidence.length ? <ol className="appeal-evidence">{data.evidence.map((url, index) => <li key={index}><a href={url} target="_blank" rel="noopener noreferrer">Материал {index + 1} · {new URL(url).hostname}<ExternalLink size={14} /></a></li>)}</ol> : <p className="portal-note">Ссылки не приложены.</p>}
      {data.response && <div className="appeal-response"><h4>Ответ руководства</h4><p className="department-preserve">{data.response}</p></div>}
      {canManage && <AppealReview key={data.id + ':' + data.version} appeal={data} onSaved={() => { refresh(); onUpdated(); }} />}
    </article><aside className="department-card appeal-history"><h3>История рассмотрения</h3><ol>{data.history.map(event => <li key={event.version}><Status status={event.status} /><p>{event.actorLogin}</p><time dateTime={event.createdAt}>{formatSiteDate(event.createdAt)}</time>{event.response && <p className="department-preserve">{event.response}</p>}</li>)}</ol></aside></div>}
  </>;
}
function AppealReview({ appeal, onSaved }: { appeal: Appeal; onSaved: () => void }) {
  const closed = appeal.status === 'resolved' || appeal.status === 'rejected';
  const [status, setStatus] = useState<AppealStatus>('in_review');
  const [response, setResponse] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (saving) return; setSaving(true); setError('');
    try { await departmentApi({ action: 'reviewAppeal', id: appeal.id, version: appeal.version, status, response }); toast.success('Статус обращения обновлён'); onSaved(); }
    catch (cause) { setError(errorMessage(cause)); } finally { setSaving(false); }
  };
  return <form className="portal-form appeal-review" onSubmit={save}><h4>Рассмотрение обращения</h4>{closed && <p className="portal-note">Чтобы дополнить решение, верните обращение на рассмотрение. Предыдущий ответ сохранится в истории.</p>}<label className="field">Новый статус<select value={status} onChange={e => setStatus(e.target.value as AppealStatus)}><option value="in_review">На рассмотрении</option>{!closed && <><option value="resolved">Рассмотрено</option><option value="rejected">Отклонено</option></>}</select></label><label className="field">Ответ заявителю<textarea rows={5} maxLength={6000} required={status !== 'in_review'} minLength={status !== 'in_review' ? 10 : undefined} value={response} onChange={e => setResponse(e.target.value)} placeholder="Решение, обоснование или запрос дополнительных сведений" /><small>Для завершения рассмотрения — минимум 10 символов.</small></label>{error && <p className="inline-error" role="alert">{error}</p>}<button className="button primary" disabled={saving}>{saving && <Loader2 className="spin" size={17} />}Сохранить статус и ответ</button></form>;
}

import { useState } from 'react';
import { ArrowLeft, ArrowUpRight, Pencil, Plus, UserRound, Users, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { departmentApi, errorMessage, type StaffMember } from '@/lib/department-api';
import { useDepartmentData } from './use-department-data';
import { DepartmentLoading, departmentLink } from './department-section';

type Draft = Omit<StaffMember, 'userId' | 'version' | 'updatedAt'> & { userId?: string; version?: number; login?: string };
const empty: Draft = { login: '', displayName: '', staticId: '', rank: '', position: '', bio: '', active: true, sortOrder: 100 };
export default function StaffSection({ canManage, memberId }: { canManage: boolean; memberId: string | null }) {
  const [management, setManagement] = useState(false);
  const { data, loading, error, refresh } = useDepartmentData<{ members: StaffMember[] }>({ op: canManage && management ? 'manageStaff' : 'staff' });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [query, setQuery] = useState('');
  const edit = (member?: StaffMember) => { setDraft(member ? { ...member } : { ...empty }); setFormError(''); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!draft || saving) return;
    setSaving(true); setFormError('');
    try { await departmentApi({ action: 'saveMember', ...draft }); setDraft(null); refresh(); toast.success('Карточка сотрудника сохранена'); }
    catch (cause) { setFormError(errorMessage(cause)); } finally { setSaving(false); }
  };
  const members = data?.members || [];
  const member = members.find(item => item.userId === memberId);
  const filtered = members.filter(item => `${item.displayName} ${item.staticId} ${item.rank} ${item.position}`.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));
  return <div className="department-content">
    <div className="portal-heading"><div><h2><Users size={24} />Состав УСБ</h2><p className="portal-note">Служебные профили сотрудников подразделения.</p></div>{canManage && <div className="portal-actions"><button className="button outline" onClick={() => setManagement(value => !value)}>{management ? 'Действующий состав' : 'Управление составом'}</button><button className="button primary" onClick={() => edit()}><Plus size={17} />Добавить сотрудника</button></div>}</div>
    {management && <p className="department-notice">Здесь можно изменить карточку или убрать сотрудника из действующего состава. Должность в карточке не меняет права аккаунта.</p>}
    {loading || error ? <DepartmentLoading error={error} refresh={refresh} /> : memberId ? <>
      <a className="department-back" href={departmentLink('staff')}><ArrowLeft size={17} />К составу</a>
      {member ? <article className="staff-profile department-card"><div className="staff-avatar large"><UserRound size={40} /></div><div className="staff-profile-body"><div className="eyebrow">СЛУЖЕБНЫЙ ПРОФИЛЬ</div><h3>{member.displayName}</h3><p className="staff-position">{member.position}</p>{!member.active && <span className="badge">В архиве состава</span>}<dl className="staff-facts"><div><dt>Статик</dt><dd>{member.staticId || 'Не указан'}</dd></div><div><dt>Звание</dt><dd>{member.rank || 'Не указано'}</dd></div><div><dt>Подразделение</dt><dd>УСБ ГИБДД</dd></div></dl>{member.bio && <div className="staff-bio"><h4>О сотруднике</h4><p>{member.bio}</p></div>}{canManage && <button className="button outline" onClick={() => edit(member)}><Pencil size={16} />Редактировать карточку</button>}</div></article> : <div className="department-empty"><h3>Карточка недоступна</h3><p>Сотрудник не найден или убран из действующего состава.</p></div>}
    </> : <>
      <div className="department-toolbar"><label className="field">Поиск сотрудника<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Имя, статик, звание или должность" /></label><span className="portal-note">Найдено: {filtered.length}</span></div>
      {filtered.length ? <div className="staff-grid">{filtered.map(item => <article className={'staff-card department-card' + (!item.active ? ' is-archived' : '')} key={item.userId}><div className="staff-card-top"><div className="staff-avatar"><UserRound size={26} /></div>{!item.active && <span className="badge">Архив</span>}{canManage && <button className="icon-button" aria-label={'Редактировать: ' + item.displayName} onClick={() => edit(item)}><Pencil size={17} /></button>}</div><h3><a href={departmentLink('staff', 'member', item.userId)}>{item.displayName}</a></h3><p className="staff-position">{item.position}</p><dl className="staff-facts"><div><dt>Статик</dt><dd>{item.staticId || 'Не указан'}</dd></div><div><dt>Звание</dt><dd>{item.rank || 'Не указано'}</dd></div></dl><a className="staff-profile-link" href={departmentLink('staff', 'member', item.userId)}>Открыть профиль<ArrowUpRight size={16} /></a></article>)}</div> : <div className="department-empty"><Users size={30} /><h3>{query ? 'Сотрудники не найдены' : 'Состав пока не заполнен'}</h3><p>{query ? 'Попробуйте другое имя или статик.' : 'Руководство добавит карточки сотрудников в этот раздел.'}</p></div>}
    </>}
    <Dialog open={!!draft} onOpenChange={open => { if (!open && !saving) setDraft(null); }}><DialogContent className="portal-dialog"><DialogHeader><DialogTitle>{draft?.userId ? 'Карточка сотрудника' : 'Добавить сотрудника'}</DialogTitle><DialogDescription>Укажите игровые данные. Они будут видны вошедшим пользователям сайта.</DialogDescription></DialogHeader>{draft && <form className="portal-form" onSubmit={save}>
      {!draft.userId && <label className="field">Логин зарегистрированного аккаунта<input required minLength={2} maxLength={100} value={draft.login} onChange={e => setDraft({ ...draft, login: e.target.value })} placeholder="Имя Фамилия Статик" /><small>Сначала сотрудник должен зарегистрироваться и подтвердить почту.</small></label>}
      <div className="portal-form-row"><label className="field">Имя сотрудника<input required minLength={2} maxLength={100} value={draft.displayName} onChange={e => setDraft({ ...draft, displayName: e.target.value })} /></label><label className="field">Статик<input inputMode="numeric" pattern="[0-9]{1,20}" maxLength={20} value={draft.staticId} onChange={e => setDraft({ ...draft, staticId: e.target.value })} /></label></div>
      <div className="portal-form-row"><label className="field">Звание<input maxLength={100} value={draft.rank} onChange={e => setDraft({ ...draft, rank: e.target.value })} placeholder="Можно заполнить позже" /></label><label className="field">Должность<input required minLength={2} maxLength={100} value={draft.position} onChange={e => setDraft({ ...draft, position: e.target.value })} /></label></div>
      <label className="field">О сотруднике<textarea rows={4} maxLength={1500} value={draft.bio} onChange={e => setDraft({ ...draft, bio: e.target.value })} placeholder="Направление работы и служебная информация" /></label>
      <label className="field">Порядок в списке<input type="number" required min={0} max={1000} step={1} value={draft.sortOrder} onChange={e => setDraft({ ...draft, sortOrder: Number(e.target.value) })} /><small>Меньшее число — выше в списке.</small></label>
      <label className="portal-checkbox"><input type="checkbox" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })} />В действующем составе</label>
      {formError && <p className="inline-error" role="alert">{formError}</p>}<div className="portal-actions"><button type="button" className="button outline" disabled={saving} onClick={() => setDraft(null)}>Отмена</button><button className="button primary" disabled={saving}>{saving && <Loader2 size={17} className="spin" />}Сохранить</button></div>
    </form>}</DialogContent></Dialog>
  </div>;
}

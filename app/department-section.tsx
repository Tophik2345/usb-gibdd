import { useEffect, useState } from 'react';
import { Users, FileText, MessageSquare, LogIn, Loader2 } from 'lucide-react';
import StaffSection from './staff-section';
import ReportTemplates from './report-templates';
import AppealsSection from './appeals-section';
import './department.css';

export const departmentTabs = [
  { id: 'staff', label: 'Состав УСБ', description: 'Сотрудники, должности и служебные профили', icon: Users },
  { id: 'reports', label: 'Рапорты и отчёты', description: 'Шаблоны проверок, мероприятий и смен', icon: FileText },
  { id: 'appeals', label: 'Обращения в УСБ', description: 'Подача обращения и ответ руководства', icon: MessageSquare },
] as const;
export type DepartmentTab = typeof departmentTabs[number]['id'];
function route() {
  const query = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const tab = query.get('tab');
  return { tab: (departmentTabs.some(item => item.id === tab) ? tab : 'staff') as DepartmentTab, member: query.get('member'), appeal: query.get('appeal') };
}
export function departmentLink(tab: DepartmentTab, field?: 'member' | 'appeal', id?: string) {
  const query = new URLSearchParams({ tab });
  if (field && id) query.set(field, id);
  return '#department?' + query.toString();
}
export function DepartmentLoading({ error, refresh }: { error: string; refresh: () => void }) {
  return error ? <div className="error-banner" role="alert"><span>{error}</span><button className="button outline" onClick={refresh}>Повторить</button></div>
    : <p className="portal-loading" role="status"><Loader2 className="spin" size={18} />Загружаем данные…</p>;
}
export default function DepartmentSection({ signedIn, canManage, displayName }: { signedIn: boolean; canManage: boolean; displayName: string }) {
  const [current, setCurrent] = useState(route);
  useEffect(() => { const update = () => { setCurrent(route()); window.scrollTo({ top: 0 }); }; window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  return <section className="department-section" aria-labelledby="department-title">
    <header className="department-heading">
      <div className="eyebrow">
        <a href="https://forum.russia.online/" target="_blank" rel="noopener noreferrer" title="Форум «Россия Онлайн» — в новой вкладке">РОССИЯ ОНЛАЙН</a>
        <span aria-hidden="true"> · </span>
        <a href={departmentLink('staff')} title="Состав отдела УСБ">ОТДЕЛ УСБ</a>
      </div>
      <h1 id="department-title">Подразделение</h1><p>Состав, служебные документы и связь с руководством.</p>
    </header>
    <nav className="department-tabs" aria-label="Разделы подразделения">{departmentTabs.map(({ id, label, icon: Icon }) => <a key={id} href={departmentLink(id)} aria-current={current.tab === id ? 'page' : undefined}><Icon size={19} />{label}</a>)}</nav>
    {!signedIn && current.tab !== 'reports' ? <div className="department-empty"><LogIn size={30} /><h2>{current.tab === 'staff' ? 'Состав доступен сотрудникам' : 'Войдите, чтобы подать обращение'}</h2><p>{current.tab === 'staff' ? 'Войдите в аккаунт с подтверждённой почтой, чтобы открыть служебные профили.' : 'После входа вы сможете отправить обращение, следить за статусом и прочитать ответ руководства.'}</p><a className="button primary" href="#account">Войти в аккаунт</a></div>
      : current.tab === 'staff' ? <StaffSection canManage={canManage} memberId={current.member} />
      : current.tab === 'reports' ? <ReportTemplates displayName={displayName} />
      : <AppealsSection canManage={canManage} appealId={current.appeal} />}
  </section>;
}

import { useEffect, useState } from 'react';
import { Users, FileText, MessageSquare, LogIn, Loader2, Flag, Map, FolderSearch, CalendarDays, Camera } from 'lucide-react';
import StaffSection from './staff-section';
import ReportTemplates from './report-templates';
import AppealsSection from './appeals-section';
import FeedbackSection from './feedback-section';
import SectionLinks from './section-links';
import ServiceSection from './service-section';
import './department.css';

export const departmentTabs = [
  { id: 'staff', label: 'Состав УСБ', description: 'Сотрудники, должности и служебные профили', icon: Users },
  { id: 'reports', label: 'Рапорты и отчёты', description: 'Шаблоны проверок, мероприятий и смен', icon: FileText },
  { id: 'appeals', label: 'Обращения в УСБ', description: 'Подача обращения и ответ руководства', icon: MessageSquare },
  { id: 'feedback', label: 'Ошибки в материалах', description: 'Сообщения о неточностях и их исправление', icon: Flag },
  { id: 'map', label: 'Карта службы', description: 'Посты, объекты и маршруты патрулирования', icon: Map },
  { id: 'cases', label: 'Служебные проверки', description: 'Материалы, исполнители и итоговые решения', icon: FolderSearch },
  { id: 'shifts', label: 'Дежурства', description: 'Запись на смену, напарники и замены', icon: CalendarDays },
  { id: 'gallery', label: 'Публикация фото', description: 'Загрузка скриншотов и управление подписями', icon: Camera },
] as const;
export type DepartmentTab = typeof departmentTabs[number]['id'];
function route() {
  const query = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const tab = query.get('tab');
  const scope = query.get('scope');
  return { tab: (departmentTabs.some(item => item.id === tab) ? tab : 'staff') as DepartmentTab, member: query.get('member'), appeal: query.get('appeal'), caseId: query.get('case'), scope: scope === 'mine' || scope === 'team' ? scope : undefined };
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
      <SectionLinks section="department"/>
      <h1 id="department-title">Подразделение</h1><p>Состав, проверки, дежурства и связь с руководством.</p>
    </header>
    <nav className="department-tabs" aria-label="Разделы подразделения">{departmentTabs.map(({ id, label, icon: Icon }) => <a key={id} href={departmentLink(id)} aria-current={current.tab === id ? 'page' : undefined}><Icon size={19} />{label}</a>)}</nav>
    {!signedIn && current.tab !== 'reports' ? <div className="department-empty"><LogIn size={30} /><h2>Войдите, чтобы открыть раздел</h2><p>Подтверждённый аккаунт нужен для обращений и служебных разделов. Карта и дежурства доступны действующему составу, публикация фото — руководству.</p><a className="button primary" href="#account">Войти в аккаунт</a></div>
      : current.tab === 'staff' ? <StaffSection canManage={canManage} memberId={current.member} />
      : current.tab === 'reports' ? <ReportTemplates displayName={displayName} />
      : current.tab === 'feedback' ? <FeedbackSection canManage={canManage}/>
      : current.tab === 'map' || current.tab === 'cases' || current.tab === 'shifts' || current.tab === 'gallery' ? <ServiceSection key={current.tab} tab={current.tab} caseId={current.caseId}/>
      : <AppealsSection canManage={canManage} appealId={current.appeal} initialScope={current.scope} />}
  </section>;
}

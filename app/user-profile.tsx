import { BookOpen, ChartNoAxesCombined, ShieldCheck, Users } from 'lucide-react';
import type { Workspace } from '@/lib/types';
import type { StaffRank } from '@/lib/department-api';
import { useDepartmentData } from './use-department-data';
import './staff-ranks.css';

export default function UserProfile({data,onResults,onTests,onAccess}:{data:Workspace;onResults:()=>void;onTests:()=>void;onAccess:()=>void}) {
  const rank=useDepartmentData<StaffRank>({op:'myRank'});
  const finished=data.attempts.filter(attempt=>attempt.finishedAt&&attempt.mode!=='practice');
  const average=finished.length?Math.round(finished.reduce((total,attempt)=>total+(attempt.score||0)/attempt.total*100,0)/finished.length):null;
  const role=data.permissions.canManageCreators?'Владелец сайта':data.role==='deputy'?'Заместитель':data.permissions.canCreateTests?'Автор тестов':'Сотрудник';
  return <section className="user-profile" aria-labelledby="profile-title">
    <div className="eyebrow">ЛИЧНЫЙ КАБИНЕТ</div>
    <h1 id="profile-title">Профиль пользователя</h1>
    <div className="profile-card">
      <div className="profile-card-heading"><span className="profile-avatar" aria-hidden="true">{data.user.displayName?.[0]?.toUpperCase()||'У'}</span><div><h2>{data.user.displayName||'Сотрудник'}</h2><span className="badge blue-badge"><ShieldCheck size={15}/>{role}</span></div></div>
      <dl className="profile-details"><div><dt>Имя пользователя</dt><dd>{data.user.displayName||'Не указано'}</dd></div><div><dt>Электронная почта</dt><dd>{data.user.email||'Не указана'}</dd></div><div><dt>Звание</dt><dd>{rank.loading?'Загружаем звание…':rank.error?<span role="alert">{rank.error} <button type="button" className="text-button" onClick={rank.refresh}>Повторить</button></span>:<>{rank.data?.rank||'Звание недоступно'}<small className="staff-rank-group">{rank.data?.rankGroup}{rank.data&&!rank.data.active&&' · Вне действующего состава'}</small></>}</dd></div><div><dt>Доступ к созданию тестов</dt><dd>{data.permissions.canCreateTests?'Предоставлен':'Не предоставлен'}</dd></div></dl>
    </div>
    <div className="profile-statistics"><article><span>Завершено попыток</span><strong>{finished.length}</strong></article><article><span>Средний результат</span><strong>{average===null?'—':average+'%'}</strong></article></div>
    <div className="profile-actions"><a className="button outline" href="#training"><ShieldCheck size={18}/>Подготовка и допуск</a><a className="button outline" href="#department?tab=staff"><Users size={18}/>Состав и звания</a><button type="button" className="button primary" onClick={onResults}><ChartNoAxesCombined size={18}/>Мои результаты</button><button type="button" className="button outline" onClick={onTests}><BookOpen size={18}/>Перейти к тестам</button>{data.permissions.canManageCreators&&<button type="button" className="button outline" onClick={onAccess}><Users size={18}/>Управление авторами</button>}</div>
  </section>;
}

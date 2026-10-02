import { BookOpen, ChartNoAxesCombined, ShieldCheck, Users } from 'lucide-react';
import type { Assignment, Workspace } from '@/lib/types';
import type { StaffRank } from '@/lib/department-api';
import { useDepartmentData } from './use-department-data';
import MyTasks from './my-tasks';
import './staff-ranks.css';

export default function UserProfile({data,busy,workspaceError,onRefresh,onAssignments,onStartAssignment,onOpenAttempt,onResults,onTests,onAccess,onDashboard}:{data:Workspace;busy:boolean;workspaceError:string;onRefresh:()=>Promise<void>;onAssignments:()=>void;onStartAssignment:(assignment:Assignment)=>void;onOpenAttempt:(id:string)=>void;onResults:()=>void;onTests:()=>void;onAccess:()=>void;onDashboard?:()=>void}) {
  const rank=useDepartmentData<StaffRank>({op:'myRank'});
  const finished=data.attempts.filter(attempt=>attempt.finishedAt&&attempt.mode!=='practice');
  const average=finished.length?Math.round(finished.reduce((total,attempt)=>total+(attempt.score||0)/attempt.total*100,0)/finished.length):null;
  const role=data.permissions.canManageCreators?'Владелец сайта':data.role==='deputy'?'Заместитель':data.permissions.canCreateTests?'Автор тестов':'Сотрудник';
  return <section className="user-profile" aria-labelledby="profile-title">
    <div className="eyebrow">ЛИЧНЫЙ КАБИНЕТ</div>
    <h1 id="profile-title">Профиль пользователя</h1>
    <div className="profile-card">
      <div className="profile-card-heading"><span className="profile-avatar" aria-hidden="true">{data.user.displayName?.[0]?.toUpperCase()||'У'}</span><div className="profile-identity"><h2>{data.user.displayName||'Сотрудник'}</h2><span className="badge blue-badge"><ShieldCheck size={15}/>{role}</span></div><div className="profile-rank">{rank.loading?<span role="status">Загружаем звание…</span>:rank.error?<span role="alert">{rank.error} <button type="button" className="text-button" onClick={rank.refresh}>Повторить</button></span>:<><strong>{rank.data?.rank||'Звание недоступно'}</strong><small className="staff-rank-group">{rank.data?.rankGroup}{rank.data&&!rank.data.active&&' · Вне действующего состава'}</small></>}</div></div>
    </div>
    <MyTasks data={data} busy={busy} workspaceError={workspaceError} onRefresh={onRefresh} onAssignments={onAssignments} onStartAssignment={onStartAssignment} onOpenAttempt={onOpenAttempt}/>
    <div className="profile-statistics"><article><span>Завершено попыток</span><strong>{finished.length}</strong></article><article><span>Средний результат</span><strong>{average===null?'—':average+'%'}</strong>{average!==null&&<div className="score-meter" role="meter" aria-label="Средний результат проверок" aria-valuemin={0} aria-valuemax={100} aria-valuenow={average} aria-valuetext={average+'%'}><span style={{width:average+'%'}}/></div>}</article></div>
    <div className="profile-actions"><a className="button outline" href="#attestation">Карточка аттестации</a><a className="button outline" href="#install">Установить сайт</a><a className="button outline" href="#calendar">Календарь сроков</a><a className="button outline" href="#history">Моя история</a>{onDashboard&&<button type="button" className="button outline" onClick={onDashboard}><ChartNoAxesCombined size={18}/>Сводка руководителя</button>}<a className="button outline" href="#training"><ShieldCheck size={18}/>Подготовка и допуск</a><a className="button outline" href="#department?tab=staff"><Users size={18}/>Состав и звания</a><button type="button" className="button primary" onClick={onResults}><ChartNoAxesCombined size={18}/>Мои результаты</button><button type="button" className="button outline" onClick={onTests}><BookOpen size={18}/>Перейти к тестам</button>{data.permissions.canManageCreators&&<button type="button" className="button outline" onClick={onAccess}><Users size={18}/>Управление авторами</button>}</div>
    <details className="profile-account-details"><summary>Сведения об аккаунте</summary><dl className="profile-details"><div><dt>Имя пользователя</dt><dd>{data.user.displayName||'Не указано'}</dd></div><div><dt>Электронная почта</dt><dd>{data.user.email||'Не указана'}</dd></div><div><dt>Доступ к созданию тестов</dt><dd>{data.permissions.canCreateTests?'Предоставлен':'Не предоставлен'}</dd></div></dl></details>
  </section>;
}

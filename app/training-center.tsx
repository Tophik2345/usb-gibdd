import { useEffect, useState } from 'react';
import { GraduationCap, Route, History, Users, LogIn, Loader2, ClipboardCheck } from 'lucide-react';
import Admission from './training-admission';
import Scenarios from './rp-scenarios';
import AuditLog from './audit-log';
import SectionLinks from './section-links';
import ServiceChecklists from './service-checklists';
export function TrainingLoad({error,refresh}:{error:string;refresh:()=>void}){
  return error?<div className="error-banner" role="alert"><span>{error}</span><button className="button outline" onClick={refresh}>Повторить</button></div>:<p className="portal-loading" role="status"><Loader2 size={18} className="spin"/>Загружаем подготовку…</p>;
}
const getTab=()=>new URLSearchParams(window.location.hash.split('?')[1]||'').get('tab')||'admission';
export default function TrainingCenter({signedIn,canManage}:{signedIn:boolean;canManage:boolean}){
  const [tab,setTab]=useState(getTab);
  useEffect(()=>{const update=()=>setTab(getTab());window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update);},[]);
  const tabs=[{id:'admission',title:'Мой допуск',icon:GraduationCap},{id:'situations',title:'RP-ситуации',icon:Route},{id:'checklists',title:'Чек-листы действий',icon:ClipboardCheck},...(canManage?[{id:'team',title:'Подготовка сотрудников',icon:Users},{id:'audit',title:'Журнал действий',icon:History}]:[])];
  const active=tabs.some(t=>t.id===tab)?tab:'admission';
  return <section className="training-center"><header className="training-heading"><SectionLinks section="training"/><h1>Подготовка к службе</h1><p>Изучи материалы, проверь знания и отработай решения в служебных ситуациях.</p></header>
    {!signedIn?<div className="training-panel training-empty"><LogIn size={32}/><h2>Твой путь к самостоятельной службе</h2><p>Войди в аккаунт, чтобы сохранять подготовку, проходить RP-ситуации и подать заявку на допуск.</p><a className="button primary" href="#account">Войти в аккаунт</a></div>:<>
      <nav className="training-tabs" aria-label="Разделы подготовки">{tabs.map(({id,title,icon:Icon})=><a key={id} href={`#training?tab=${id}`} aria-current={active===id?'page':undefined}><Icon size={18}/>{title}</a>)}</nav>
      {active==='situations'?<Scenarios/>:active==='audit'?<AuditLog/>:active==='checklists'?<ServiceChecklists/>:<Admission key={active} management={active==='team'}/>}
    </>}
  </section>;
}

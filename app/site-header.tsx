import { useState } from 'react';
import { Menu, X, LogOut, LogIn } from 'lucide-react';
import Emblem from './emblem';

export const siteSections = [
  { id: 'home', title: 'Главная' },
  { id: 'tests', title: 'Тест' },
  { id: 'laws', title: 'Законы РО' },
  { id: 'new-employees', title: 'Для новых сотрудников' },
  { id: 'duties', title: 'Обязанности сотрудников УСБ' },
  { id: 'department', title: 'Подразделение' },
  { id: 'links', title: 'Полезные ссылки' },
] as const;
export type SitePage = typeof siteSections[number]['id'] | 'account' | 'profile';

export function pageFromHash(): SitePage {
  const hash = window.location.hash.slice(1).split('?')[0];
  return hash==='profile'||siteSections.some(section => section.id === hash) ? hash as SitePage : 'account';
}

export function Logo() {
  return <div className="brand"><span className="brand-mark"><Emblem/></span><span>УСБ ГибДД<span className="brand-caption">РОССИЯ ОНЛАЙН · КУТУЗОВСКИЙ</span></span></div>;
}

export default function SiteHeader({page,displayName,busy,onLogout,onNavigate}:{
  page:SitePage;displayName?:string;busy?:boolean;onLogout?:()=>void;onNavigate:(page:SitePage)=>void;
}) {
  const [menuOpen,setMenuOpen]=useState(false);
  const navigate=(next:SitePage)=>{setMenuOpen(false);onNavigate(next);};
  return <header className="site-header">
    <div className="site-header-top">
      <a href="#home" className="site-brand-link" aria-label="УСБ ГибДД — Главная" onClick={e=>{e.preventDefault();navigate('home');}}><Logo/></a>
      <aside className="site-motto"><strong>Наш девиз</strong><span>«Мы следим за теми, кто следит за порядком».</span></aside>
      <div className="site-account">
        {displayName!==undefined ? <><a href="#profile" className="profile-name profile-link" title="Открыть мой профиль" aria-label={(displayName||'Личный кабинет')+' — открыть профиль'} onClick={e=>{e.preventDefault();navigate('profile');}}>{displayName||'Личный кабинет'}</a><button type="button" className="icon-button" aria-label="Выйти из аккаунта" onClick={onLogout} disabled={busy}><LogOut size={20}/></button></> :
          <a href="#account" className="button outline" onClick={e=>{e.preventDefault();navigate('account');}}><LogIn size={17}/>Войти</a>}
        <button type="button" className="mobile-menu-button icon-button" aria-label={menuOpen?'Закрыть меню':'Открыть меню'} aria-expanded={menuOpen} aria-controls="site-navigation" onClick={()=>setMenuOpen(open=>!open)}>{menuOpen?<X size={23}/>:<Menu size={23}/>}</button>
      </div>
    </div>
    <nav id="site-navigation" aria-label="Основные разделы сайта" className={'site-navigation'+(menuOpen?' is-open':'')}>
      {siteSections.map(section=><a key={section.id} href={'#'+section.id} aria-current={page===section.id?'page':undefined} onClick={e=>{e.preventDefault();navigate(section.id);}}>{section.title}</a>)}
    </nav>
  </header>;
}

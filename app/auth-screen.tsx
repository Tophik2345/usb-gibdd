'use client';
import { useState, useEffect } from 'react';
import { Eye, EyeOff, LockKeyhole, Loader2, ShieldCheck } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { authConfigured, discordEnabled, siteReturnUrl, signInWithLogin, supabase } from '@/lib/supabase';
import { authErrorMessage } from '@/lib/auth-errors';
import Emblem from './emblem';
export default function AuthScreen({onSuccess,header}:{onSuccess:()=>void;header:React.ReactNode}){
 const [mode,setMode]=useState('login');const [name,setName]=useState('');const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [show,setShow]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const ready=authConfigured;const discord=authConfigured&&discordEnabled;
 useEffect(()=>{if(!authConfigured)setError('Вход временно недоступен. Обратитесь к администратору сайта.');const url=new URL(window.location.href);if(url.searchParams.has('error')||new URLSearchParams(url.hash.slice(1)).has('error'))setError('Не удалось завершить подтверждение входа. Попробуйте войти по логину.');},[]);
 const message=(error:unknown)=>authErrorMessage(error,mode==='register'?'register':'login');
 const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');setNotice('');try{const client=supabase();if(mode==='register'){const {data,error}=await client.auth.signUp({email:email.trim().toLowerCase(),password,options:{data:{login:name.trim().replace(/\s+/g,' '),full_name:name.trim().replace(/\s+/g,' ')},emailRedirectTo:siteReturnUrl()}});if(error)throw error;setPassword('');if(!data.session){setNotice('Проверьте почту: для завершения регистрации нужна ссылка из письма. Если аккаунт уже существует, перейдите на вкладку «Войти».');return;}}else{await signInWithLogin(name,password);setPassword('');}onSuccess();}catch(e){setError(message(e));}finally{setBusy(false);}};
 const social=async()=>{setBusy(true);setError('');try{const {error}=await supabase().auth.signInWithOAuth({provider:'discord',options:{redirectTo:siteReturnUrl(),scopes:'identify email'}});if(error)throw error;}catch(e){setError(message(e));setBusy(false);}};
 const form=<>{notice&&<p className="auth-success" role="status">{notice}</p>}<form onSubmit={submit} className="auth-form"><label className="field">Логин<Input value={name} onChange={e=>setName(e.target.value)} required minLength={2} maxLength={100} autoComplete="username" placeholder={mode==='register'?'Имя Фамилия Статик':'Введите логин'} disabled={busy}/></label>{mode==='register'&&<label className="field">Электронная почта<Input type="email" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={254} autoComplete="email" placeholder="name@example.ru" disabled={busy}/></label>}<label className="field">Пароль<span className="password-input"><Input type={show?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} required minLength={mode==='register'?12:1} maxLength={128} autoComplete={mode==='register'?'new-password':'current-password'} placeholder={mode==='register'?'Не менее 12 символов':'Введите пароль'} disabled={busy}/><button type="button" onClick={()=>setShow(v=>!v)} aria-label={show?'Скрыть пароль':'Показать пароль'}>{show?<EyeOff size={18}/>:<Eye size={18}/>}</button></span></label>{mode==='register'&&<p className="auth-hint">Используйте отдельный пароль для этого сайта.</p>}{error&&<p role="alert" className="inline-error">{error}</p>}<button className="button primary full" type="submit" disabled={busy||!ready}>{busy?<Loader2 className="spin" size={18}/>:<LockKeyhole size={18}/>} {mode==='login'?'Войти':'Создать аккаунт'}</button></form></>;
 return <div className="auth-page">{header}<main className="auth-layout"><section className="auth-form-panel"><div className="eyebrow">ЛИЧНЫЙ КАБИНЕТ</div><h1>{mode==='login'?'Вход в аккаунт':'Начнём с аккаунта.'}</h1><p className="auth-subtitle">{mode==='login'?'Введите логин и пароль.':'Создайте аккаунт для тестов и результатов.'}</p><Tabs className="gap-0" value={mode} onValueChange={v=>{setMode(v);setError('');setNotice('');}}><TabsList className="auth-tabs"><TabsTrigger value="login">Войти</TabsTrigger><TabsTrigger value="register">Создать аккаунт</TabsTrigger></TabsList><TabsContent value="login" tabIndex={-1}>{form}</TabsContent><TabsContent value="register" tabIndex={-1}>{form}</TabsContent></Tabs><div className="auth-divider"><span/>или<span/></div><button type="button" className="button discord-button full" disabled={!discord||busy} onClick={social}>{discord?'Продолжить с Discord':'Discord пока не подключён'}</button><p className="auth-private"><ShieldCheck size={15}/>Ваши результаты доступны вам и автору теста.</p></section><aside className="auth-aside auth-welcome" aria-labelledby="auth-welcome-title">
  <div className="auth-welcome-identity">
    <Emblem/>
    <div><p className="auth-welcome-name">УСБ ГибДД</p><p className="auth-welcome-server">Россия Онлайн · Кутузовский</p></div>
  </div>
  <div className="auth-welcome-copy">
    <h2 id="auth-welcome-title">Добро пожаловать<br/>в УСБ</h2>
    <p className="auth-welcome-invitation">Войдите, чтобы продолжить работу</p>
    <p className="auth-welcome-family">Вас приветствует <strong>семья Карапетян</strong></p>
  </div>
  <blockquote className="auth-welcome-motto">
    <span>Наш девиз</span>
    <p>«Мы следим за теми,<br/>кто следит за порядком».</p>
  </blockquote>
</aside></main></div>;
}

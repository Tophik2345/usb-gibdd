'use client';
import { useState, useEffect, useRef } from 'react';
import { Eye, EyeOff, LockKeyhole, Loader2, ShieldCheck } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { authConfigured, discordEnabled, siteReturnUrl, signInWithLogin, supabase } from '@/lib/supabase';
import { authErrorMessage } from '@/lib/auth-errors';
import { resendSignupCode, verifySignupCode } from '@/lib/email-confirmation';
import Emblem from './emblem';
import { beginRecovery } from '@/lib/password-recovery';
import { useCodeCooldown } from '@/lib/code-cooldown';
import { checkSignupLogin } from '@/lib/signup-validation';

export default function AuthScreen({ onSuccess, header }: { onSuccess: () => void; header: React.ReactNode }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState<'submit' | 'social' | 'resend' | 'verify' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [code, setCode] = useState('');
  const emailInput = useRef<HTMLInputElement>(null);
  const wait = useCodeCooldown('signup', email);
  const busy = pending !== null;
  const ready = authConfigured;
  const discord = ready && discordEnabled;
  const confirmationStep = mode === 'register' && confirming;

  useEffect(() => {
    if (!ready) setError('Вход временно недоступен. Обратитесь к администратору сайта.');
    const url = new URL(window.location.href);
    if (url.searchParams.has('error') || new URLSearchParams(url.hash.slice(1)).has('error')) {
      setError('Не удалось завершить подтверждение входа. Попробуйте войти по логину.');
    }
  }, [ready]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !ready) return;
    setPending('submit'); setError(''); setNotice('');
    try {
      if (mode === 'register') {
        await checkSignupLogin(name);
        const { data, error } = await supabase().auth.signUp({
          email: email.trim().toLowerCase(), password,
          options: {
            data: { login: name.trim().replace(/\s+/g, ' '), full_name: name.trim().replace(/\s+/g, ' ') },
            emailRedirectTo: siteReturnUrl(),
          },
        });
        if (error) throw error;
        if (data.user?.identities?.length === 0) throw { code: 'email_exists' };
        setPassword('');
        if (!data.session) {
          wait.start(); setConfirming(true); setCode('');
          setNotice('Проверьте почту и папку «Спам». Введите код из последнего письма. Если аккаунт уже подтверждён, перейдите к входу.');
          return;
        }
      } else {
        await signInWithLogin(name, password);
        setPassword('');
      }
      onSuccess();
    } catch (error) {
      setError(authErrorMessage(error, mode === 'register' ? 'register' : 'login'));
    } finally { setPending(null); }
  };

  const resend = async () => {
    if (busy || !ready || wait.remaining || !emailInput.current?.reportValidity()) return;
    setPending('resend'); setError(''); setNotice('');
    try {
      await resendSignupCode(email);
      wait.start();
      setCode('');
      setNotice('Запрос на повторную отправку принят. Проверьте почту и папку «Спам»; используйте код из последнего письма. Если почта уже подтверждена, перейдите к входу.');
    } catch (error) {
      setError(authErrorMessage(error, 'resend'));
    } finally { setPending(null); }
  };

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !ready) return;
    setPending('verify'); setError(''); setNotice('');
    try {
      await verifySignupCode(email, code);
      setCode('');
      onSuccess();
    } catch (error) {
      setError(authErrorMessage(error, 'verify'));
    } finally { setPending(null); }
  };

  const social = async () => {
    if (busy || !discord) return;
    setPending('social'); setError('');
    try {
      const { error } = await supabase().auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: siteReturnUrl(), scopes: 'identify email' } });
      if (error) throw error;
    } catch (error) {
      setError(authErrorMessage(error, 'login'));
      setPending(null);
    }
  };

  const form = <>
    {notice && <p className="auth-success" role="status">{notice}</p>}
    {confirmationStep ? <form onSubmit={verify} className="auth-form">
      <label className="field">Электронная почта
        <Input ref={emailInput} type="email" required maxLength={254} value={email} onChange={event => { setEmail(event.target.value); setCode(''); setNotice(''); }} autoComplete="email" placeholder="name@example.ru" disabled={busy} autoFocus={!email}/>
      </label>
      <label className="field">Код подтверждения
        <Input required minLength={6} maxLength={10} pattern="[0-9]{6,10}" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value.replace(/\s/g, ''))} placeholder="Код из письма" disabled={busy} autoFocus={!!email}/>
      </label>
      <p className="auth-hint">Для подтверждения используйте код из последнего письма.</p>
      {error && <p role="alert" className="inline-error">{error}</p>}
      <button className="button primary full" type="submit" disabled={busy || !ready}>
        {pending === 'verify' ? <Loader2 className="spin" size={18}/> : <ShieldCheck size={18}/>} {pending === 'verify' ? 'Подтверждаем…' : 'Подтвердить почту'}
      </button>
      <button className="button outline full" type="button" disabled={busy || !ready || wait.remaining > 0} onClick={resend}>
        {pending === 'resend' && <Loader2 className="spin" size={18}/>} {pending === 'resend' ? 'Отправляем…' : wait.remaining ? `Повторная отправка через ${wait.remaining} с` : 'Отправить код повторно'}
      </button>
      <button className="text-button" type="button" disabled={busy} onClick={() => { setConfirming(false); setCode(''); setError(''); setNotice(''); }}>Вернуться к регистрации</button>
    </form> : <form onSubmit={submit} className="auth-form">
      <label className="field">Логин
        <Input value={name} onChange={event => setName(event.target.value)} required minLength={2} maxLength={100} autoComplete="username" placeholder={mode === 'register' ? 'Имя Фамилия Статик' : 'Введите логин'} disabled={busy}/>
      </label>
      {mode === 'register' && <label className="field">Электронная почта
        <Input type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" placeholder="name@example.ru" disabled={busy}/>
      </label>}
      <label className="field">Пароль<span className="password-input">
        <Input type={show ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} required minLength={mode === 'register' ? 12 : 1} maxLength={128} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} placeholder={mode === 'register' ? 'Не менее 12 символов' : 'Введите пароль'} disabled={busy}/>
        <button type="button" disabled={busy} onClick={() => setShow(value => !value)} aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}>{show ? <EyeOff size={18}/> : <Eye size={18}/>}</button>
      </span></label>
      {mode === 'register' && <p className="auth-hint">Используйте отдельный пароль для этого сайта.</p>}
      {error && <p role="alert" className="inline-error">{error}</p>}
      <button className="button primary full" type="submit" disabled={busy || !ready}>
        {pending === 'submit' ? <Loader2 className="spin" size={18}/> : <LockKeyhole size={18}/>} {mode === 'login' ? 'Войти' : 'Создать аккаунт'}
      </button>
      {mode === 'login' && <button className="text-button" type="button" disabled={busy || !ready} onClick={() => beginRecovery(email)}>Забыли пароль?</button>}
      {mode === 'register' && <button className="text-button" type="button" disabled={busy} onClick={() => { setConfirming(true); setCode(''); setError(''); setNotice(''); }}>Уже получали код? Подтвердить почту</button>}
    </form>}
  </>;

  return <div className="auth-page">{header}<main className="auth-layout">
    <section className="auth-form-panel">
      <div className="eyebrow">ЛИЧНЫЙ КАБИНЕТ</div>
      <h1>{mode === 'login' ? 'Вход в аккаунт' : confirmationStep ? 'Подтвердите почту' : 'Начнём с аккаунта.'}</h1>
      <p className="auth-subtitle">{mode === 'login' ? 'Введите логин и пароль.' : confirmationStep ? 'Введите код из письма или запросите новый.' : 'Создайте аккаунт для тестов и результатов.'}</p>
      <Tabs className="gap-0" value={mode} onValueChange={value => { setMode(value); setError(''); setNotice(''); }}>
        <TabsList className="auth-tabs">
          <TabsTrigger value="login" disabled={busy}>Войти</TabsTrigger>
          <TabsTrigger value="register" disabled={busy}>Создать аккаунт</TabsTrigger>
        </TabsList>
        <TabsContent value="login" tabIndex={-1}>{form}</TabsContent>
        <TabsContent value="register" tabIndex={-1}>{form}</TabsContent>
      </Tabs>
      <div className="auth-divider"><span/>или<span/></div>
      <button type="button" className="button discord-button full" disabled={!discord || busy} onClick={social}>{discord ? 'Продолжить с Discord' : 'Discord пока не подключён'}</button>
      <p className="auth-private"><ShieldCheck size={15}/>Ваши результаты доступны вам и автору теста.</p>
    </section>
    <aside className="auth-aside auth-welcome" aria-labelledby="auth-welcome-title">
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
    </aside>
  </main></div>;
}

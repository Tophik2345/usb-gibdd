import { useRef, useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { authErrorMessage } from '@/lib/auth-errors';
import { useCodeCooldown } from '@/lib/code-cooldown';
import { closeRecovery, requestRecoveryCode, verifyRecoveryCode, saveRecoveredPassword, type RecoveryState } from '@/lib/password-recovery';
import SiteHeader, { type SitePage } from './site-header';

export default function PasswordRecovery({ recovery }: { recovery: RecoveryState }) {
  const [email, setEmail] = useState(recovery.email);
  const [requested, setRequested] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [repeated, setRepeated] = useState('');
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState<'request' | 'verify' | 'save' | 'cancel' | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const wait = useCodeCooldown('recovery', email);
  const busy = pending !== null;
  const verified = !!recovery.userId;
  async function send() {
    if (busy || wait.remaining || !emailInput.current?.reportValidity()) return;
    setPending('request'); setError(''); setNotice('');
    try {
      await requestRecoveryCode(email); wait.start(); setRequested(true); setCode('');
      setNotice('Если аккаунт с этой почтой существует, вы получите письмо. Проверьте почту и папку «Спам».');
    } catch (error) { setError(authErrorMessage(error, 'recovery')); } finally { setPending(null); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    if (!requested && !verified) { await send(); return; }
    setPending(verified ? 'save' : 'verify'); setError(''); setNotice('');
    try {
      if (verified) {
        await saveRecoveredPassword(password, repeated, recovery.userId!);
        setPassword(''); setRepeated(''); setDone(true);
      } else { await verifyRecoveryCode(email, code); setCode(''); }
    } catch (error) { setError(authErrorMessage(error, verified ? 'password' : 'verifyRecovery')); } finally { setPending(null); }
  }
  async function leaveRecovery(nextPage: SitePage = 'account') {
    if (busy) return;
    setPending('cancel'); setError('');
    try {
      if (verified && !done) {
        const client = supabase();
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) {
          // Auth can clear the local session even when server revocation fails.
          const { data: { session }, error: sessionError } = await client.auth.getSession();
          if (sessionError || session) throw error;
        }
      }
      closeRecovery(); window.location.hash = nextPage;
      window.scrollTo({ top: 0, behavior: 'instant' });
    } catch { setError('Не удалось выйти. Попробуйте ещё раз.'); } finally { setPending(null); }
  }
  return <div className="auth-page"><SiteHeader page="account" busy={busy} onNavigate={page => { void leaveRecovery(page); }}/><main className="auth-layout recovery-layout"><section className="auth-form-panel">
    <div className="eyebrow">ЛИЧНЫЙ КАБИНЕТ</div>
    <h1>{done ? 'Пароль изменён' : verified ? 'Новый пароль' : 'Восстановление пароля'}</h1>
    {done ? <><p className="auth-success" role="status">Новый пароль сохранён. Вы можете продолжить работу.</p><button className="button primary full" onClick={() => { void leaveRecovery('home'); }}>Перейти в кабинет</button></> : <>
      <p className="auth-subtitle">{verified ? 'Установите отдельный пароль для этого сайта.' : 'Укажите почту, которую использовали при регистрации.'}</p>
      {notice && <p className="auth-success" role="status">{notice}</p>}
      <form className="auth-form" onSubmit={submit}>
        {verified ? <>
          <label className="field">Новый пароль<span className="password-input"><Input type={show ? 'text' : 'password'} required minLength={6} maxLength={128} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} autoFocus/><button type="button" disabled={busy} onClick={() => setShow(v => !v)} aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}>{show ? <EyeOff size={18}/> : <Eye size={18}/>}</button></span></label>
          <label className="field">Повторите новый пароль<Input type={show ? 'text' : 'password'} required minLength={6} maxLength={128} autoComplete="new-password" value={repeated} onChange={e => setRepeated(e.target.value)} disabled={busy}/></label>
        </> : <>
          <label className="field">Электронная почта<Input ref={emailInput} type="email" required maxLength={254} autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setCode(''); setRequested(false); setNotice(''); }} disabled={busy} autoFocus/></label>
          {requested && <label className="field">Код восстановления<Input required minLength={6} maxLength={10} pattern="[0-9]{6,10}" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value.replace(/\s/g, ''))} disabled={busy} placeholder="Код из последнего письма" autoFocus/></label>}
        </>}
        {error && <p className="inline-error" role="alert">{error}</p>}
        <button className="button primary full" type="submit" disabled={busy || (!requested && !verified && wait.remaining > 0)}>{busy && <Loader2 className="spin" size={18}/>} {busy ? 'Подождите…' : verified ? 'Сохранить пароль' : requested ? 'Подтвердить код' : wait.remaining ? `Отправить код через ${wait.remaining} с` : 'Отправить код'}</button>
        {requested && !verified && <button className="button outline full" type="button" onClick={send} disabled={busy || wait.remaining > 0}>{wait.remaining ? `Повторная отправка через ${wait.remaining} с` : 'Отправить код повторно'}</button>}
        <button className="text-button" type="button" disabled={busy} onClick={() => { void leaveRecovery(); }}>Вернуться к входу</button>
      </form>
    </>}
  </section></main></div>;
}

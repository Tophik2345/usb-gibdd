import { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, Loader2, Search, Trash2, Unlock, Users } from 'lucide-react';
import { accountsApi, type AccountsPage, type ManagedAccount } from '@/lib/accounts-api';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog';
type Action = 'block'|'unblock'|'delete';
const labels = { block: 'Заблокировать', unblock: 'Разблокировать', delete: 'Удалить аккаунт' };
const roles = { owner: 'Владелец', deputy: 'Заместитель', author: 'Автор', employee: 'Сотрудник' };
export default function AccountManagement() {
  const [data, setData] = useState<AccountsPage | null>(null);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<{ account: ManagedAccount; action: Action } | null>(null);
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestId.current; setLoading(true); setError('');
    try {
      const next = await accountsApi<AccountsPage>({ action: 'list', search, page });
      if (id !== requestId.current) return;
      if (page > 0 && !next.accounts.length) { setPage(page - 1); return; }
      setData(next);
    } catch (e) { if (id === requestId.current) { setData(null); setError(e instanceof Error ? e.message : 'Не удалось загрузить аккаунты.'); } }
    finally { if (id === requestId.current) setLoading(false); }
  }, [search, page]);
  useEffect(() => { load(); return () => { requestId.current++; }; }, [load]);
  async function apply() {
    if (!selected || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await accountsApi({ action: selected.action, userId: selected.account.userId });
      setNotice(selected.action === 'delete' ? 'Аккаунт удалён.' : selected.action === 'block' ? 'Аккаунт заблокирован. Его данные сохранены.' : 'Аккаунт разблокирован.');
      setSelected(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось выполнить действие.'); }
    finally { setBusy(false); }
  }
  return <section className="account-management creator-access" aria-labelledby="accounts-title">
    <div className="section-top"><h2 id="accounts-title"><Users size={21}/>Аккаунты {data && <span className="count-pill">{data.total}</span>}</h2><button type="button" className="text-button" onClick={load} disabled={busy || loading}>Обновить аккаунты</button></div>
    <form className="creator-add" onSubmit={e => { e.preventDefault(); if (input.trim() === search && page === 0) load(); else { setSearch(input.trim()); setPage(0); } }}>
      <label className="field">Поиск по логину или почте<input type="search" maxLength={100} value={input} onChange={e => setInput(e.target.value)} disabled={busy} autoComplete="off"/></label>
      <button type="submit" className="button outline" disabled={busy}><Search size={17}/>Найти</button>
    </form>
    {error && !selected && <p className="inline-error" role="alert">{error}</p>}
    {notice && <p className="auth-success" role="status">{notice}</p>}
    {loading ? <p role="status" className="creator-loading"><Loader2 className="spin" size={20}/>Загружаем аккаунты…</p> : data && <>
      <div className="creator-list">{data.accounts.map(account => <article className="creator-row account-row" key={account.userId}>
        <div className="creator-name"><strong>{account.login}</strong><span>{account.email}</span><span>{roles[account.role]} · {account.blocked ? 'Заблокирован' : account.confirmed ? 'Почта подтверждена' : 'Почта не подтверждена'} · результатов: {account.results}</span></div>
        {account.protected ? <span className="badge blue-badge">Защищённый аккаунт</span> : <div className="account-actions">
          <button className="button outline" type="button" disabled={busy} onClick={() => { setError(''); setSelected({ account, action: account.blocked ? 'unblock' : 'block' }); }}>{account.blocked ? <Unlock size={17}/> : <Ban size={17}/>} {account.blocked ? 'Разблокировать' : 'Заблокировать'}</button>
          <button className="button outline" type="button" disabled={busy || account.authoredTests > 0} title={account.authoredTests ? 'У аккаунта есть авторские тесты. Используйте блокировку.' : undefined} onClick={() => { setError(''); setSelected({ account, action: 'delete' }); }}><Trash2 size={17}/>Удалить</button>
        </div>}
      </article>)}</div>
      {!data.accounts.length && <p>Аккаунты не найдены.</p>}
      {data.total > data.pageSize && <div className="account-pagination"><button type="button" className="button outline" disabled={busy || page === 0} onClick={() => setPage(v => v - 1)}>Назад</button><span>Страница {page + 1}</span><button type="button" className="button outline" disabled={busy || (page + 1) * data.pageSize >= data.total} onClick={() => setPage(v => v + 1)}>Далее</button></div>}
    </>}
    <p className="creator-note">Блокировка сохраняет данные. Удаление убирает аккаунт и его личные результаты навсегда. Владельцы и заместители защищены; аккаунты с авторскими тестами можно блокировать.</p>
    <AlertDialog open={!!selected} onOpenChange={open => { if (!open && !busy) { setSelected(null); setError(''); } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{selected ? labels[selected.action] : ''}?</AlertDialogTitle><AlertDialogDescription>{selected?.account.login} · {selected?.account.email}<br/>{selected?.action === 'delete' ? `Будут удалены аккаунт и его личные данные, включая результаты (${selected.account.results}). Это действие нельзя отменить.` : selected?.action === 'block' ? 'Сотрудник потеряет доступ к личным данным и действиям на сайте. Тесты и результаты сохранятся.' : 'Сотрудник снова сможет войти в аккаунт.'}</AlertDialogDescription></AlertDialogHeader>{error && <p className="inline-error" role="alert">{error}</p>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={e => { e.preventDefault(); apply(); }}>{busy ? 'Сохраняем…' : selected ? labels[selected.action] : ''}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}

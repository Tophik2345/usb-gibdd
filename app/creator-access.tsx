import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, ShieldCheck, UserMinus, Users } from 'lucide-react';
import { workspaceApi } from '@/lib/workspace-api';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog';

type Creator={userId:string;login:string;role:'owner'|'author';grantedAt:string};
type AccessList={creators:Creator[]};

export default function CreatorAccess(){
  const [creators,setCreators]=useState<Creator[]>([]);
  const [login,setLogin]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [removing,setRemoving]=useState<Creator|null>(null);
  const load=useCallback(async()=>{setLoading(true);setError('');try{const data=await workspaceApi<AccessList>('?op=creatorAccess');setCreators(data.creators);}catch(e){setError(e instanceof Error?e.message:'Не удалось загрузить список.');}finally{setLoading(false);}},[]);
  useEffect(()=>{load();},[load]);
  async function grant(e:React.FormEvent){
    e.preventDefault();setBusy(true);setError('');setNotice('');
    try{const data=await workspaceApi<AccessList>('',{action:'grantCreator',login:login.trim()});setCreators(data.creators);setLogin('');setNotice('Доступ к созданию тестов предоставлен.');}
    catch(e){setError(e instanceof Error?e.message:'Не удалось добавить автора.');}finally{setBusy(false);}
  }
  async function revoke(){
    if(!removing)return;setBusy(true);setError('');setNotice('');
    try{const data=await workspaceApi<AccessList>('',{action:'revokeCreator',userId:removing.userId});setCreators(data.creators);setRemoving(null);setNotice('Доступ к созданию и редактированию тестов отозван.');}
    catch(e){setError(e instanceof Error?e.message:'Не удалось убрать доступ.');}finally{setBusy(false);}
  }
  return <section className="creator-access">
    <div className="page-heading"><div><div className="eyebrow">УПРАВЛЕНИЕ ДОСТУПОМ</div><h1>Авторы тестов</h1><p>Добавляйте сотрудников, которым разрешено создавать и редактировать свои тесты.</p></div></div>
    <form className="creator-add" onSubmit={grant}>
      <label className="field">Логин сотрудника<input value={login} onChange={e=>setLogin(e.target.value)} placeholder="Имя Фамилия Статик" minLength={2} maxLength={100} required disabled={busy||loading} autoComplete="off"/></label>
      <button type="submit" className="button primary" disabled={busy||loading||login.trim().length<2}>{busy?<Loader2 size={18} className="spin"/>:<Plus size={18}/>}Добавить автора</button>
      <p>Сотрудник должен зарегистрироваться на сайте и подтвердить электронную почту.</p>
    </form>
    {error&&<p className="inline-error" role="alert">{error}</p>}
    {notice&&<p className="auth-success" role="status">{notice}</p>}
    <div className="section-top"><h2><Users size={21}/>Список авторов <span className="count-pill">{creators.length}</span></h2><button type="button" className="text-button" onClick={load} disabled={busy||loading}>Обновить список</button></div>
    {loading?<p className="creator-loading" role="status"><Loader2 size={20} className="spin"/>Загружаем список…</p>:<div className="creator-list">{creators.map(creator=><article className="creator-row" key={creator.userId}>
      <span className="stat-icon blue"><ShieldCheck size={22}/></span>
      <div className="creator-name"><strong>{creator.login}</strong><span>{creator.role==='owner'?'Владелец сайта · управление списком авторов':'Автор · создание и редактирование своих тестов'}</span></div>
      {creator.role==='owner'?<span className="badge blue-badge">Владелец</span>:<button type="button" className="button outline" onClick={()=>setRemoving(creator)} disabled={busy}><UserMinus size={17}/>Убрать доступ</button>}
    </article>)}</div>}
    <p className="creator-note">Отзыв доступа не удаляет аккаунт, уже созданные тесты и результаты прохождения.</p>
    <AlertDialog open={!!removing} onOpenChange={open=>{if(!open&&!busy)setRemoving(null);}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Убрать доступ у {removing?.login}?</AlertDialogTitle><AlertDialogDescription>Сотрудник больше не сможет создавать и редактировать тесты. Доступ к прохождению тестов сохранится.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={e=>{e.preventDefault();revoke();}}>{busy?'Сохраняем…':'Убрать доступ'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}

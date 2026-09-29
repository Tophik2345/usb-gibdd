import { useEffect, useState } from 'react';
import { CalendarClock, ClipboardCheck, Loader2, RefreshCw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { workspaceApi as api } from '@/lib/workspace-api';
import type { Assignment, Workspace } from '@/lib/types';

const when=(value:string)=>new Date(value).toLocaleString('ru-RU',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
const localInput=(value:Date)=>new Date(value.getTime()-value.getTimezoneOffset()*60_000).toISOString().slice(0,16);
const labels={assigned:'Назначен',overdue:'Просрочен',passed:'Пройден',cancelled:'Отменён'};

export default function AssignmentsPanel({data,busy,onStart,onOpen,onRefresh,initialTestId}:{
  data:Workspace;busy:boolean;onStart:(assignment:Assignment)=>void;onOpen:(id:string)=>void;onRefresh:()=>Promise<void>;initialTestId?:string;
}){
  const canAssign=data.permissions.canCreateTests;
  const published=data.managed.filter(test=>test.published&&!test.demo);
  const [scope,setScope]=useState(initialTestId&&canAssign?'team':'mine');
  const [testId,setTestId]=useState(initialTestId||published[0]?.id||'');
  const [login,setLogin]=useState('');
  const [due,setDue]=useState(localInput(new Date(Date.now()+24*60*60_000)));
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [reschedule,setReschedule]=useState<Assignment|null>(null);
  const [newDue,setNewDue]=useState('');
  const [cancel,setCancel]=useState<Assignment|null>(null);
  const [clock,setClock]=useState(Date.now());
  const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone;
  useEffect(()=>{const id=setInterval(()=>setClock(Date.now()),30_000);return()=>clearInterval(id);},[]);
  useEffect(()=>{if(initialTestId){setTestId(initialTestId);setScope('team');}},[initialTestId]);
  const status=(item:Assignment)=>item.status==='assigned'&&Date.parse(item.dueAt)<clock?'overdue':item.status;
  const locked=saving||busy;
  const create=async(event:React.FormEvent)=>{
    event.preventDefault();setSaving(true);setError('');
    try{
      await api('',{action:'assignTest',testId,login:login.trim(),dueAt:new Date(due).toISOString()});
      setLogin('');setScope('team');await onRefresh();toast.success('Тест назначен сотруднику');
    }catch(e:any){setError(e.message||'Проверьте срок сдачи.');}finally{setSaving(false);}
  };
  const change=async(action:'rescheduleAssignment'|'cancelAssignment',item:Assignment)=>{
    setSaving(true);setError('');
    try{
      await api('',{action,id:item.id,...(action==='rescheduleAssignment'?{dueAt:new Date(newDue).toISOString()}:{})});
      setReschedule(null);setCancel(null);await onRefresh();toast.success(action==='rescheduleAssignment'?'Срок обновлён':'Назначение отменено');
    }catch(e:any){setError(e.message||'Не удалось обновить назначение.');}finally{setSaving(false);}
  };
  const cards=(rows:Assignment[],own:boolean)=>rows.length?<div className="assignment-list">{rows.map(item=>{
    const current=status(item);const pending=current==='assigned'||current==='overdue';
    return <article className="assignment-card" key={item.id}>
      <div className="assignment-card-heading"><span className={'badge '+(current==='passed'?'green-badge':current==='overdue'?'orange-badge':current==='cancelled'?'neutral':'blue-badge')}>{labels[current]}</span><span className="subtle">{own?`Автор: ${item.authorLogin}`:`Сотрудник: ${item.employeeLogin}`}</span></div>
      <h2>{item.testTitle}</h2>
      <p className="assignment-deadline"><CalendarClock size={17}/>Срок: <strong>{when(item.dueAt)}</strong></p>
      <p className="helper">{item.count} вопросов · для зачёта {item.passMark}%</p>
      {item.completedAt?<p className="assignment-result">Пройден {when(item.completedAt)}{Date.parse(item.completedAt)>Date.parse(item.dueAt)?' · с опозданием':''}</p>:item.lastFinishedAt&&<p className="assignment-result">Последняя попытка: {item.lastScore} из {item.lastTotal}. {pending?'Нужно достичь проходного балла.':''}</p>}
      <div className="assignment-actions">{own? <>
        {pending&&<button className="button primary" disabled={locked} onClick={()=>onStart(item)}><ClipboardCheck size={17}/>{item.inProgressAttemptId?'Продолжить':item.lastFinishedAt?'Пройти ещё раз':'Начать задание'}</button>}
        {current==='passed'&&item.completedAttemptId&&<button className="button outline" disabled={locked} onClick={()=>onOpen(item.completedAttemptId!)}>Посмотреть результат</button>}
      </>:pending&&<>
        <button className="button outline" disabled={locked} onClick={()=>{setError('');setReschedule(item);setNewDue(localInput(new Date(Math.max(Date.parse(item.dueAt),Date.now()+24*60*60_000))));}}>Изменить срок</button>
        <button className="text-button" disabled={locked} onClick={()=>{setError('');setCancel(item);}}>Отменить назначение</button>
      </>}</div>
    </article>;
  })}</div>:<div className="assignment-empty"><ClipboardCheck size={28}/><h2>{own?'Вам пока не назначены тесты':'Вы ещё не назначали тесты'}</h2><p>{own?'Когда автор назначит проверку, здесь появятся тест и срок сдачи.':'Выберите свой опубликованный тест, укажите логин сотрудника и срок сдачи.'}</p></div>;
  return <section className="assignments-panel">
    <div className="page-heading"><div><div className="eyebrow">ПОДГОТОВКА СОТРУДНИКОВ</div><h1>Задания<span className="heading-dot">.</span></h1><p>Назначенные проверки и сроки сдачи.</p></div><button className="button outline" disabled={locked} onClick={()=>{setSaving(true);onRefresh().finally(()=>setSaving(false));}}><RefreshCw size={17}/>Обновить</button></div>
    {error&&!reschedule&&!cancel&&<p className="inline-error" role="alert">{error}</p>}
    <Tabs value={scope} onValueChange={setScope}>
      <TabsList className="scope-tabs"><TabsTrigger value="mine">Мои задания <span className="count-pill">{(data.assignments||[]).filter(item=>['assigned','overdue'].includes(status(item))).length}</span></TabsTrigger>{canAssign&&<TabsTrigger value="team">Выданные мной</TabsTrigger>}</TabsList>
      <TabsContent value="mine"><p className="table-caption">Начинайте проверку из карточки задания. Зачёт засчитывается при достижении проходного балла; работу над ошибками можно пройти отдельно. Сроки показаны в часовом поясе {timezone}.</p>{cards(data.assignments||[],true)}</TabsContent>
      {canAssign&&<TabsContent value="team">
        <form className="assignment-form" onSubmit={create}>
          <div><h2>Назначить проверку</h2><p>Сотрудник увидит задание в своём аккаунте. Вопросы и проходной балл сохраняются на момент назначения.</p></div>
          <label className="field">Ваш опубликованный тест<select required value={testId} onChange={event=>setTestId(event.target.value)} disabled={locked||!published.length}><option value="" disabled>Выберите тест</option>{published.map(test=><option key={test.id} value={test.id}>{test.title}</option>)}</select></label>
          <div className="assignment-form-fields"><label className="field">Логин сотрудника<input required minLength={2} maxLength={100} value={login} onChange={event=>setLogin(event.target.value)} placeholder="Имя Фамилия Статик" disabled={locked}/></label><label className="field">Срок сдачи<input required type="datetime-local" min={localInput(new Date(clock))} value={due} onChange={event=>setDue(event.target.value)} disabled={locked}/><small>Ваше время: {timezone}</small></label></div>
          {!published.length&&<p className="helper">Сначала опубликуйте свой тест в разделе «Управление».</p>}
          <button className="button primary" type="submit" disabled={locked||!published.length||!testId}>{saving?<Loader2 size={17} className="spin"/>:<Send size={17}/>}Назначить тест</button>
        </form>
        <h2 className="assignment-list-title">Выданные задания</h2>{cards(data.assignedTeam||[],false)}
      </TabsContent>}
    </Tabs>
    <Dialog open={!!reschedule} onOpenChange={open=>{if(!open&&!saving)setReschedule(null);}}><DialogContent className="start-dialog"><DialogHeader><DialogTitle>Изменить срок сдачи</DialogTitle><DialogDescription>{reschedule?.testTitle} · {reschedule?.employeeLogin}</DialogDescription></DialogHeader><form className="assignment-reschedule" onSubmit={event=>{event.preventDefault();if(reschedule)change('rescheduleAssignment',reschedule);}}><label className="field">Новый срок<input type="datetime-local" required min={localInput(new Date(clock))} value={newDue} onChange={event=>setNewDue(event.target.value)}/><small>{timezone}</small></label>{error&&<p className="inline-error" role="alert">{error}</p>}<button className="button primary" disabled={saving} type="submit">{saving?'Сохраняем…':'Сохранить срок'}</button></form></DialogContent></Dialog>
    <AlertDialog open={!!cancel} onOpenChange={open=>{if(!open&&!saving)setCancel(null);}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Отменить назначение?</AlertDialogTitle><AlertDialogDescription>Задание «{cancel?.testTitle}» для {cancel?.employeeLogin} больше не будет требовать сдачи. Уже полученные результаты сохранятся.</AlertDialogDescription></AlertDialogHeader>{error&&<p className="inline-error" role="alert">{error}</p>}<AlertDialogFooter><AlertDialogCancel disabled={saving}>Оставить задание</AlertDialogCancel><AlertDialogAction disabled={saving} onClick={event=>{event.preventDefault();if(cancel)change('cancelAssignment',cancel);}}>{saving?'Сохраняем…':'Отменить назначение'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}

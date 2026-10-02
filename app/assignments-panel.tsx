import { useEffect, useState } from 'react';
import { CalendarClock, ClipboardCheck, Loader2, RefreshCw, RotateCcw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { workspaceApi as api } from '@/lib/workspace-api';
import type { Assignment, Workspace } from '@/lib/types';
import { formatSiteDate as when, toSiteDateTimeInput as localInput, fromSiteDateTimeInput, SITE_TIME_LABEL } from '@/lib/date-time';
import AssignmentReset from './assignment-reset';
import { dashboardApi } from '@/lib/dashboard-api';

const labels={assigned:'Назначен',overdue:'Просрочен',passed:'Пройден',cancelled:'Отменён',reset:'Обнулён'};

export default function AssignmentsPanel({data,busy,onStart,onOpen,onRefresh,initialTestId,focusAssignment}:{
  data:Workspace;busy:boolean;onStart:(assignment:Assignment)=>void;onOpen:(id:string)=>void;onRefresh:()=>Promise<void>;initialTestId?:string;focusAssignment?:{id:string;request:number;scope?:'mine'|'team'}|null;
}){
  const canAssign=data.permissions.canAssignTests===true;
  const published=(data.assignmentTests||[]).filter(test=>test.published&&!test.demo);
  const [scope,setScope]=useState(initialTestId&&canAssign?'team':'mine');
  const [testId,setTestId]=useState(initialTestId||published[0]?.id||'');
  const [login,setLogin]=useState('');
  const [due,setDue]=useState(localInput(new Date(Date.now()+24*60*60_000)));
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [reschedule,setReschedule]=useState<Assignment|null>(null);
  const [newDue,setNewDue]=useState('');
  const [cancel,setCancel]=useState<Assignment|null>(null);
  const [reset,setReset]=useState<Assignment|null>(null);
  const [target,setTarget]=useState<Assignment|null>(null),[targetLoading,setTargetLoading]=useState(false),[targetError,setTargetError]=useState(''),[targetRevision,setTargetRevision]=useState(0);
  const [clock,setClock]=useState(Date.now());
  useEffect(()=>{const id=setInterval(()=>setClock(Date.now()),30_000);return()=>clearInterval(id);},[]);
  useEffect(()=>{if(initialTestId){setTestId(initialTestId);setScope('team');}},[initialTestId]);
  useEffect(()=>{if(focusAssignment)setScope(focusAssignment.scope==='team'&&canAssign?'team':'mine');},[focusAssignment,canAssign]);
  useEffect(()=>{
    let active=true;setTarget(null);setTargetError('');setTargetLoading(false);
    if(!canAssign||focusAssignment?.scope!=='team'||!focusAssignment.id)return;
    setTargetLoading(true);
    dashboardApi<Assignment>({action:'assignment',id:focusAssignment.id}).then(item=>{if(active)setTarget(item);})
      .catch(cause=>{if(active)setTargetError(cause.message);}).finally(()=>{if(active)setTargetLoading(false);});
    return()=>{active=false;};
  },[focusAssignment,canAssign,data.assignedTeam,targetRevision]);
  useEffect(()=>{
    if(!focusAssignment?.id||scope!==(focusAssignment.scope||'mine'))return;
    const frame=requestAnimationFrame(()=>document.getElementById('assignment-'+focusAssignment.id)?.scrollIntoView({block:'center'}));
    return()=>cancelAnimationFrame(frame);
  },[focusAssignment,scope,data.assignments,data.assignedTeam,target]);
  useEffect(()=>{if(!canAssign){setScope('mine');setReset(null);setReschedule(null);setCancel(null);}},[canAssign]);
  const status=(item:Assignment)=>item.status==='assigned'&&Date.parse(item.dueAt)<clock?'overdue':item.status;
  const locked=saving||busy;
  const create=async(event:React.FormEvent)=>{
    event.preventDefault();setSaving(true);setError('');
    try{
      await api('',{action:'assignTest',testId,login:login.trim(),dueAt:fromSiteDateTimeInput(due)});
      setLogin('');setScope('team');await onRefresh();toast.success('Тест назначен сотруднику');
    }catch(e:any){setError(e.message||'Проверьте срок сдачи.');}finally{setSaving(false);}
  };
  const change=async(action:'rescheduleAssignment'|'cancelAssignment',item:Assignment)=>{
    setSaving(true);setError('');
    try{
      await api('',{action,id:item.id,version:item.version,...(action==='rescheduleAssignment'?{dueAt:fromSiteDateTimeInput(newDue)}:{})});
      setReschedule(null);setCancel(null);await onRefresh();toast.success(action==='rescheduleAssignment'?'Срок обновлён':'Назначение отменено');
    }catch(e:any){setError(e.message||'Не удалось обновить назначение.');}finally{setSaving(false);}
  };
  const cards=(rows:Assignment[],own:boolean)=>rows.length?<div className="assignment-list">{rows.map(item=>{
    const current=status(item);const pending=current==='assigned'||current==='overdue';
    return <article className={'assignment-card'+(focusAssignment?.id===item.id?' is-focused':'')} id={'assignment-'+item.id} key={item.id}>
      <div className="assignment-card-heading"><span className={'badge '+(current==='passed'?'green-badge':current==='overdue'?'orange-badge':current==='cancelled'?'neutral':'blue-badge')}>{labels[current]}</span><span className="subtle">{own?`Автор: ${item.authorLogin}`:`Сотрудник: ${item.employeeLogin}`}</span></div>
      <h2>{item.testTitle}</h2>
      <p className="assignment-deadline"><CalendarClock size={17}/>Срок: <strong>{when(item.dueAt)}</strong></p>
      <p className="helper">{item.count} вопросов · для зачёта {item.passMark}% · {item.timeLimitMinutes?`${item.timeLimitMinutes} мин. с момента начала — закрытие страницы не останавливает таймер`:"без таймера"}</p>
      {item.completedAt?<p className="assignment-result">Пройден {when(item.completedAt)}{Date.parse(item.completedAt)>Date.parse(item.dueAt)?' · с опозданием':''}</p>:item.lastFinishedAt&&<p className="assignment-result">Последняя попытка: {item.lastScore} из {item.lastTotal}. {pending?'Нужно достичь проходного балла.':''}</p>}
      {current==='reset'&&<p className="helper">Все попытки сохранены. Для повторного прохождения создано новое задание.</p>}
      <div className="assignment-actions">{own? <>
        {pending&&<button className="button primary" disabled={locked} onClick={()=>onStart(item)}><ClipboardCheck size={17}/>{item.inProgressAttemptId?'Продолжить':item.lastFinishedAt?'Пройти ещё раз':'Начать задание'}</button>}
        {(current==='passed'||current==='reset')&&item.completedAttemptId&&<button className="button outline" disabled={locked} onClick={()=>onOpen(item.completedAttemptId!)}>Посмотреть результат</button>}
        {current==='reset'&&item.inProgressAttemptId&&<button className="button outline" disabled={locked} onClick={()=>onOpen(item.inProgressAttemptId!)}>Сохранённая попытка</button>}
      </>:<>{pending&&<>
        <button className="button outline" disabled={locked} onClick={()=>{setError('');setReschedule(item);setNewDue(localInput(new Date(Math.max(Date.parse(item.dueAt),Date.now()+24*60*60_000))));}}>Изменить срок</button>
        <button className="text-button" disabled={locked} onClick={()=>{setError('');setCancel(item);}}>Отменить назначение</button>
      </>}{current!=='reset'&&<button className="button outline" aria-label={`Обнулить назначение: ${item.testTitle} — ${item.employeeLogin}`} disabled={locked} onClick={()=>setReset(item)}><RotateCcw size={17}/>Обнулить назначение</button>}{item.completedAttemptId&&<button className="text-button" disabled={locked} onClick={()=>onOpen(item.completedAttemptId!)}>Посмотреть результат</button>}</>}</div>
    </article>;
  })}</div>:<div className="assignment-empty"><ClipboardCheck size={28}/><h2>{own?'Вам пока не назначены тесты':'Назначений пока нет'}</h2><p>{own?'Когда руководитель назначит проверку, здесь появятся тест и срок сдачи.':'Выберите опубликованный тест, укажите логин сотрудника и срок сдачи.'}</p></div>;
  return <section className="assignments-panel">
    <div className="page-heading"><div><div className="eyebrow">ПОДГОТОВКА СОТРУДНИКОВ</div><h1>Задания<span className="heading-dot">.</span></h1><p>Назначенные проверки и сроки сдачи.</p></div><button className="button outline" disabled={locked} onClick={()=>{setSaving(true);onRefresh().finally(()=>setSaving(false));}}><RefreshCw size={17}/>Обновить</button></div>
    {error&&!reschedule&&!cancel&&<p className="inline-error" role="alert">{error}</p>}
    <Tabs value={scope} onValueChange={setScope}>
      <TabsList className="scope-tabs"><TabsTrigger value="mine">Мои задания <span className="count-pill">{(data.assignments||[]).filter(item=>['assigned','overdue'].includes(status(item))).length}</span></TabsTrigger>{canAssign&&<TabsTrigger value="team">Все сотрудники</TabsTrigger>}</TabsList>
      <TabsContent value="mine"><p className="table-caption">Начинайте проверку из карточки задания. Зачёт засчитывается при достижении проходного балла; работу над ошибками можно пройти отдельно. Все сроки указаны по московскому времени — МСК (UTC+3).</p>{cards(data.assignments||[],true)}</TabsContent>
      {canAssign&&<TabsContent value="team">
        <form className="assignment-form" onSubmit={create}>
          <div><h2>Назначить проверку</h2><p>Сотрудник увидит задание в своём аккаунте. Вопросы и проходной балл сохраняются на момент назначения.</p></div>
          <label className="field">Опубликованный тест<select aria-label="Опубликованный тест" required value={testId} onChange={event=>setTestId(event.target.value)} disabled={locked||!published.length}><option value="" disabled>Выберите тест</option>{published.map(test=><option key={test.id} value={test.id}>{test.title}</option>)}</select></label>
          <div className="assignment-form-fields"><label className="field">Логин сотрудника<input required minLength={2} maxLength={100} value={login} onChange={event=>setLogin(event.target.value)} placeholder="Имя Фамилия Статик" disabled={locked}/></label><label className="field">Срок сдачи<input required type="datetime-local" min={localInput(new Date(clock))} value={due} onChange={event=>setDue(event.target.value)} disabled={locked}/><small>{SITE_TIME_LABEL}</small></label></div>
          {!published.length&&<p className="helper">Опубликованных тестов пока нет. Создавать и редактировать их могут сотрудники от звания «Полковник».</p>}
          <button className="button primary" type="submit" disabled={locked||!published.length||!testId}>{saving?<Loader2 size={17} className="spin"/>:<Send size={17}/>}Назначить тест</button>
        </form>
        <h2 className="assignment-list-title">Назначения всех сотрудников</h2><p className="table-caption">Управление доступно от звания «Капитан». Обнуление создаёт новое задание и сохраняет всю историю попыток.</p>
        {targetLoading&&<p role="status">Загружаем выбранное назначение…</p>}{targetError&&<div className="error-banner" role="alert"><span>{targetError}</span><button type="button" className="button outline" onClick={()=>setTargetRevision(n=>n+1)}>Повторить</button></div>}
        {cards(target?[target,...(data.assignedTeam||[]).filter(item=>item.id!==target.id)]:data.assignedTeam||[],false)}
      </TabsContent>}
    </Tabs>
    {reset&&canAssign&&<AssignmentReset assignment={reset} onClose={()=>setReset(null)} onReload={()=>{setReset(null);void onRefresh();}} onSuccess={()=>{setReset(null);void onRefresh();toast.success('Назначение обнулено. Все попытки и результаты сохранены.');}}/>}
    <Dialog open={!!reschedule} onOpenChange={open=>{if(!open&&!saving)setReschedule(null);}}><DialogContent className="start-dialog"><DialogHeader><DialogTitle>Изменить срок сдачи</DialogTitle><DialogDescription>{reschedule?.testTitle} · {reschedule?.employeeLogin}</DialogDescription></DialogHeader><form className="assignment-reschedule" onSubmit={event=>{event.preventDefault();if(reschedule)change('rescheduleAssignment',reschedule);}}><label className="field">Новый срок<input type="datetime-local" required min={localInput(new Date(clock))} value={newDue} onChange={event=>setNewDue(event.target.value)}/><small>{SITE_TIME_LABEL}</small></label>{error&&<p className="inline-error" role="alert">{error}</p>}<button className="button primary" disabled={saving} type="submit">{saving?'Сохраняем…':'Сохранить срок'}</button></form></DialogContent></Dialog>
    <AlertDialog open={!!cancel} onOpenChange={open=>{if(!open&&!saving)setCancel(null);}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Отменить назначение?</AlertDialogTitle><AlertDialogDescription>Задание «{cancel?.testTitle}» для {cancel?.employeeLogin} больше не будет требовать сдачи. Уже полученные результаты сохранятся.</AlertDialogDescription></AlertDialogHeader>{error&&<p className="inline-error" role="alert">{error}</p>}<AlertDialogFooter><AlertDialogCancel disabled={saving}>Оставить задание</AlertDialogCancel><AlertDialogAction disabled={saving} onClick={event=>{event.preventDefault();if(cancel)change('cancelAssignment',cancel);}}>{saving?'Сохраняем…':'Отменить назначение'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}

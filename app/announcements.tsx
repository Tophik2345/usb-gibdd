import { useState } from 'react';
import { CalendarClock, Megaphone, Pencil, Pin, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { portalApi, type Announcement } from '@/lib/portal-api';
import { usePortalList } from './use-portal-list';
const kinds={news:'Новости подразделения',rules:'Изменения правил',attestation:'Аттестация'};
const when=(value:string)=>new Date(value).toLocaleString('ru-RU',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
const localDate=(value:string|null)=>value?new Date(Date.parse(value)-new Date(value).getTimezoneOffset()*60000).toISOString().slice(0,16):'';
type Draft=Partial<Announcement>&Pick<Announcement,'title'|'body'|'kind'|'pinned'|'published'>;
export default function Announcements({canManage=false}:{canManage?:boolean}){
  const [management,setManagement]=useState(false);const [limit,setLimit]=useState(3);
  const {data,loading,error,refresh}=usePortalList<{announcements:Announcement[]}>(management&&canManage?'manageAnnouncements':'announcements');
  const [draft,setDraft]=useState<Draft|null>(null);const [eventDate,setEventDate]=useState('');const [saving,setSaving]=useState(false);const [formError,setFormError]=useState('');
  const items=data?.announcements||[];
  const edit=(item?:Announcement)=>{setDraft(item||{title:'',body:'',kind:'news',pinned:false,published:false});setEventDate(localDate(item?.eventAt||null));setFormError('');};
  const save=async(event:React.FormEvent)=>{event.preventDefault();if(!draft)return;setSaving(true);setFormError('');
    try{await portalApi({action:'saveAnnouncement',...draft,eventAt:eventDate?new Date(eventDate).toISOString():null});setDraft(null);refresh();toast.success(draft.published?'Объявление опубликовано':'Черновик сохранён');}
    catch(e:any){setFormError(e.message||'Проверьте дату события.');}finally{setSaving(false);}
  };
  return <section className="announcements portal-section" aria-labelledby="announcements-title">
    <div className="portal-heading"><div><div className="eyebrow">НОВОСТИ ПОДРАЗДЕЛЕНИЯ</div><h2 id="announcements-title"><Megaphone size={24}/>Объявления руководства</h2></div>
      {canManage&&<div className="portal-actions"><button type="button" className="button outline" onClick={()=>{setManagement(v=>!v);setLimit(3);}}>{management?'Публичный вид':'Управление'}</button><button type="button" className="button primary" onClick={()=>edit()}><Plus size={17}/>Добавить</button></div>}
    </div>
    {management&&<p className="portal-note">Владелец и заместитель могут редактировать объявления. Опубликованные записи видны всем посетителям сайта.</p>}
    {loading?<p className="portal-loading" role="status"><Loader2 className="spin" size={18}/>Загружаем объявления…</p>:error?<div className="error-banner" role="alert"><span>{error}</span><button type="button" className="text-button" onClick={refresh}>Повторить</button></div>:<>
      {!items.length?<div className="portal-empty"><p>{management?'Объявлений пока нет. Создайте новость, сообщение об изменении правил или аттестации.':'Опубликованных объявлений пока нет.'}</p></div>:
      <div className="announcement-list">{items.slice(0,limit).map(item=><article className={'announcement-card '+(item.pinned?'is-pinned':'')} key={item.id}>
        <div className="announcement-meta"><span className="badge">{kinds[item.kind]}</span>{item.pinned&&<span><Pin size={14}/>Закреплено</span>}{management&&<span className={'badge '+(item.published?'green-badge':'orange-badge')}>{item.published?'Опубликовано':'Черновик'}</span>}</div>
        <h3>{item.title}</h3>{item.eventAt&&<p className="announcement-event"><CalendarClock size={17}/><time dateTime={item.eventAt}>{when(item.eventAt)}</time></p>}
        <p className="announcement-body">{item.body}</p><div className="announcement-footer"><small>{item.publishedAt?`Опубликовано: ${when(item.publishedAt)}`:`Обновлено: ${when(item.updatedAt)}`}</small>{management&&<button type="button" className="text-button" onClick={()=>edit(item)}><Pencil size={15}/>Редактировать</button>}</div>
      </article>)}</div>}
      {items.length>limit&&<button type="button" className="button outline" onClick={()=>setLimit(n=>n+6)}>Показать ещё · осталось {items.length-limit}</button>}
    </>}
    <Dialog open={!!draft} onOpenChange={open=>{if(!open&&!saving)setDraft(null);}}><DialogContent className="portal-editor" onInteractOutside={event=>event.preventDefault()} onEscapeKeyDown={event=>{if(saving)event.preventDefault();}}><DialogHeader><DialogTitle>{draft?.id?'Редактировать объявление':'Новое объявление'}</DialogTitle><DialogDescription>Новости, изменения правил и даты аттестаций на главной странице.</DialogDescription></DialogHeader>
      {draft&&<form onSubmit={save} className="portal-form"><label className="field">Заголовок<input required minLength={3} maxLength={140} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
        <div className="portal-form-row"><label className="field">Тип<select value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value as Announcement['kind']})}>{Object.entries(kinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field">Дата события · необязательно<input type="datetime-local" value={eventDate} onChange={e=>setEventDate(e.target.value)}/><small>Часовой пояс: {Intl.DateTimeFormat().resolvedOptions().timeZone}</small></label></div>
        <label className="field">Текст<textarea required rows={8} maxLength={6000} value={draft.body} onChange={e=>setDraft({...draft,body:e.target.value})}/></label>
        <label className="portal-checkbox"><input type="checkbox" checked={draft.pinned} onChange={e=>setDraft({...draft,pinned:e.target.checked})}/>Закрепить в начале списка</label>
        <label className="portal-checkbox"><input type="checkbox" checked={draft.published} onChange={e=>setDraft({...draft,published:e.target.checked})}/>Опубликовать для всех посетителей</label>
        <p className="portal-note">Без отметки публикации запись останется черновиком. Чтобы снять объявление с сайта, снимите эту отметку и сохраните.</p>
        {formError&&<p className="inline-error" role="alert">{formError}</p>}<div className="portal-actions"><button type="button" className="button outline" disabled={saving} onClick={()=>setDraft(null)}>Отмена</button><button type="submit" className="button primary" disabled={saving}>{saving?<Loader2 size={17} className="spin"/>:null}{draft.published?'Сохранить публикацию':'Сохранить черновик'}</button></div>
      </form>}
    </DialogContent></Dialog>
  </section>;
}

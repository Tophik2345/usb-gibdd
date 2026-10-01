import { useState } from 'react';
import { ExternalLink, Link as LinkIcon, Loader2, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { portalApi, type UsefulLink } from '@/lib/portal-api';
import { usePortalList } from './use-portal-list';
import SectionLinks from './section-links';
const categories={forum:'Форум и нормативные материалы',appeals:'Обращения',reports:'Отчёты',contact:'Связь с руководством'};
const hostname=(url:string)=>{try{return new URL(url).hostname;}catch{return 'Внешняя ссылка';}};
type Draft=Partial<UsefulLink>&Pick<UsefulLink,'title'|'description'|'url'|'category'|'position'|'published'>;
export default function UsefulLinks({canManage=false}:{canManage?:boolean}){
  const [management,setManagement]=useState(false);
  const {data,loading,error,refresh}=usePortalList<{links:UsefulLink[]}>(management&&canManage?'manageLinks':'links');
  const [draft,setDraft]=useState<Draft|null>(null);const [saving,setSaving]=useState(false);const [formError,setFormError]=useState('');
  const edit=(item?:UsefulLink,category:UsefulLink['category']='forum')=>{setDraft(item||{title:'',description:'',url:'',category,position:0,published:true});setFormError('');};
  const save=async(event:React.FormEvent)=>{event.preventDefault();if(!draft)return;setSaving(true);setFormError('');
    try{const parsed=new URL(draft.url.trim());if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw new Error('Укажите адрес HTTPS без логина и пароля в ссылке.');await portalApi({action:'saveLink',...draft,url:parsed.href});setDraft(null);refresh();toast.success('Ссылка сохранена');}
    catch(e:any){setFormError(e.message||'Проверьте адрес ссылки.');}finally{setSaving(false);}
  };
  return <section className="useful-links portal-section" aria-labelledby="links-title">
    <SectionLinks section="links"/><div className="portal-heading"><h1 id="links-title">Полезные ссылки</h1>{canManage&&<div className="portal-actions"><button type="button" className="button outline" onClick={()=>setManagement(v=>!v)}>{management?'Публичный вид':'Управление ссылками'}</button><button type="button" className="button primary" onClick={()=>edit()}><Plus size={17}/>Добавить ссылку</button></div>}</div>
    <p className="information-description">Форум, нормативные материалы, обращения, отчёты и каналы связи подразделения.</p>
    {management&&<p className="portal-note">Добавьте точные адреса форм и каналов подразделения. Ссылки с отметкой «Показывать на сайте» доступны всем посетителям.</p>}
    {loading?<p className="portal-loading" role="status"><Loader2 size={18} className="spin"/>Загружаем ссылки…</p>:error?<div className="error-banner" role="alert"><span>{error}</span><button type="button" className="text-button" onClick={refresh}>Повторить</button></div>:
      <div className="link-groups">{Object.entries(categories).map(([category,label])=>{
        const links=(data?.links||[]).filter(item=>item.category===category);
        return <section className="link-group" key={category}><div className="portal-heading"><h2><LinkIcon size={20}/>{label}</h2>{management&&<button type="button" className="text-button" onClick={()=>edit(undefined,category as UsefulLink['category'])}>Добавить</button>}</div>
          {links.length?<div className="useful-link-grid">{links.map(item=><article className="useful-link-card" key={item.id}>
            <a href={item.url} target="_blank" rel="noopener noreferrer"><strong>{item.title}</strong><ExternalLink size={17}/></a>{item.description&&<p>{item.description}</p>}
            <span className="link-domain">{hostname(item.url)}</span>{management&&<div className="link-editor-actions"><span className={'badge '+(item.published?'green-badge':'orange-badge')}>{item.published?'На сайте':'Скрыта'}</span><button type="button" className="text-button" onClick={()=>edit(item)}><Pencil size={15}/>Редактировать</button></div>}
          </article>)}</div>:<p className="portal-empty">Руководство пока не добавило ссылку в этот раздел.</p>}
        </section>;
      })}</div>}
    <Dialog open={!!draft} onOpenChange={open=>{if(!open&&!saving)setDraft(null);}}><DialogContent className="portal-editor" onInteractOutside={event=>event.preventDefault()} onEscapeKeyDown={event=>{if(saving)event.preventDefault();}}><DialogHeader><DialogTitle>{draft?.id?'Редактировать ссылку':'Новая ссылка'}</DialogTitle><DialogDescription>Укажите адрес страницы, формы обращения, отчёта или канала связи.</DialogDescription></DialogHeader>
      {draft&&<form className="portal-form" onSubmit={save}>
        <label className="field">Название<input required minLength={3} maxLength={120} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
        <label className="field">Адрес HTTPS<input type="url" required maxLength={1500} placeholder="https://" value={draft.url} onChange={e=>setDraft({...draft,url:e.target.value})}/></label>
        <label className="field">Краткое описание<textarea rows={3} maxLength={300} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
        <div className="portal-form-row"><label className="field">Раздел<select value={draft.category} onChange={e=>setDraft({...draft,category:e.target.value as UsefulLink['category']})}>{Object.entries(categories).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field">Порядок в списке<input type="number" min={0} max={1000} required value={draft.position} onChange={e=>setDraft({...draft,position:Number(e.target.value)})}/><small>Меньшее число — выше в списке.</small></label></div>
        <label className="portal-checkbox"><input type="checkbox" checked={draft.published} onChange={e=>setDraft({...draft,published:e.target.checked})}/>Показывать на сайте</label>
        {formError&&<p className="inline-error" role="alert">{formError}</p>}<div className="portal-actions"><button type="button" className="button outline" disabled={saving} onClick={()=>setDraft(null)}>Отмена</button><button type="submit" className="button primary" disabled={saving}>{saving&&<Loader2 size={17} className="spin"/>}Сохранить</button></div>
      </form>}
    </DialogContent></Dialog>
  </section>;
}

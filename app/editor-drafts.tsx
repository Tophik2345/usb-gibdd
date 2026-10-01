import {useEffect,useState} from 'react';
import {FilePenLine,Loader2} from 'lucide-react';
import {editorApi,cachedDrafts,draftSignature,type DraftSummary} from '@/lib/editor-drafts';
import {formatSiteDate} from '@/lib/date-time';
export default function EditorDrafts({userId,revision,disabled,onOpen}:{userId:string;revision:number;disabled:boolean;onOpen:(id:string)=>void}){
 const [drafts,setDrafts]=useState<(DraftSummary&{local?:boolean})[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{
   let active=true;setLoading(true);setError('');const cached=cachedDrafts(userId);
   const localRows=cached.map(c=>({...c.record,title:c.record.form.title,local:draftSignature(c.record.form)!==c.synced}));
   setDrafts(localRows);
   editorApi<{drafts:DraftSummary[]}>('list').then(response=>{
     if(!active)return;const merged=new Map(response.drafts.map(d=>[d.id,d]));
     for(const c of localRows)if(c.local)merged.set(c.id,c);
     setDrafts([...merged.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));
   }).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
   return()=>{active=false;};
 },[userId,revision]);
 return <section className="editor-drafts" aria-label="Черновики редактора"><div className="section-top"><h2>Черновики редактора</h2>{loading&&<Loader2 size={18} className="spin" aria-label="Загрузка черновиков"/>}</div><p className="table-caption">Незавершённые вопросы и правки. Для прохождения доступна только сохранённая версия теста.</p>{error&&<p className="inline-error" role="alert">{error}</p>}{!loading&&!drafts.length&&<p className="table-caption">Черновиков пока нет.</p>}<div className="editor-draft-list">{drafts.map(d=><article className="manage-row" key={d.id}><FilePenLine size={23}/><div className="manage-title"><h3>{d.title.trim()||'Тест без названия'}</h3><span>{d.testId?'Правки теста':'Новый тест'} · {formatSiteDate(d.updatedAt)}{d.local?' · На этом устройстве':''}</span></div><button type="button" className="button outline" disabled={disabled} onClick={()=>onOpen(d.id)}>Продолжить</button></article>)}</div></section>;
}

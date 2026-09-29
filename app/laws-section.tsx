import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Search, Loader2, ChevronDown } from 'lucide-react';
import documents from '@/lib/law-documents.json';

type Entry={id:string;kind:'section'|'article'|'introduction';title:string;chapter:string;page:number;paragraphs:string[]};
type LawText={id:string;title:string;entries:Entry[]};
const cache=new Map<string,LawText>();
const articleWord=(n:number)=>n%100>=11&&n%100<=14?'статей':n%10===1?'статья':n%10>=2&&n%10<=4?'статьи':'статей';
const normalize=(text:string)=>text.toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/\s+/g,' ').trim();

export default function LawsSection(){
  const [selected,setSelected]=useState(documents[0].id);
  const [content,setContent]=useState<LawText|null>(null);
  const [query,setQuery]=useState('');
  const [expanded,setExpanded]=useState(true);
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const [jump,setJump]=useState('');
  const meta=documents.find(d=>d.id===selected)!;
  useEffect(()=>{
    const controller=new AbortController();setError('');setContent(cache.get(selected)||null);
    if(!cache.has(selected))fetch(`${import.meta.env.BASE_URL}laws/${selected}.json`,{signal:controller.signal}).then(r=>{if(!r.ok)throw new Error('Не удалось загрузить документ.');return r.json();}).then((data:LawText)=>{if(data.id!==selected||!Array.isArray(data.entries))throw new Error('Некорректный документ.');cache.set(selected,data);if(!controller.signal.aborted)setContent(data);}).catch(e=>{if(!controller.signal.aborted)setError(e.message||'Не удалось загрузить документ.');});
    return()=>controller.abort();
  },[selected,retry]);
  const needle=normalize(query);
  const entries=useMemo(()=>content?.entries.filter(e=>!needle||normalize([e.title,...e.paragraphs].join(' ')).includes(needle))||[],[content,needle]);
  const chapters=content?.entries.filter(e=>e.kind==='section')||[];
  const found=entries.filter(e=>e.kind==='article').length;
  useEffect(()=>{if(jump){document.getElementById(`law-${selected}-${jump}`)?.scrollIntoView({behavior:'smooth',block:'start'});setJump('');}},[jump,selected,entries]);
  const choose=(id:string)=>{setContent(cache.get(id)||null);setSelected(id);setQuery('');setExpanded(true);setJump('');};
  return <section className="laws-library" aria-labelledby="laws-title">
    <div className="eyebrow">УСБ ГИБДД · РОССИЯ ОНЛАЙН</div>
    <h1 id="laws-title">Законы РО</h1>
    <p className="information-description">Полные тексты статей для изучения и служебной работы в игровом проекте «Россия Онлайн».</p>
    <div className="laws-overview"><span><strong>{documents.length}</strong> документов</span><span><strong>{documents.reduce((n,d)=>n+d.articleCount,0)}</strong> статьи</span><span>Материалы от 29.09.2026</span></div>
    <nav className="law-document-picker" aria-label="Выбор нормативного документа">{documents.map(d=><button type="button" key={d.id} aria-pressed={selected===d.id} onClick={()=>choose(d.id)}><BookOpen size={19}/><span><strong>{d.shortTitle}</strong><small>{d.articleCount} {articleWord(d.articleCount)}</small></span></button>)}</nav>
    <div className="law-reading-heading"><h2>{meta.title}</h2><p>{meta.description}</p></div>
    <div className="law-tools"><label className="law-search"><Search size={20}/><span className="sr-only">Поиск по выбранному документу</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Номер статьи, слово или фраза"/></label><button type="button" className="button outline" disabled={!content||!!needle} onClick={()=>setExpanded(v=>!v)}>{expanded?'Свернуть статьи':'Развернуть статьи'}</button></div>
    <p className="law-edition">Текст перенесён из предоставленной копии документа от {meta.date}. Нумерация, части и примечания сохранены.</p>
    {error?<div className="error-banner" role="alert"><span>{error}</span><button type="button" className="text-button" onClick={()=>setRetry(n=>n+1)}>Повторить</button></div>:!content?<p className="law-loading" role="status"><Loader2 className="spin" size={20}/>Загружаем статьи…</p>:<>
      {needle&&<p className="law-search-result" role="status">Найдено статей: {found}. Поиск в документе «{meta.shortTitle}». <button type="button" className="text-button" onClick={()=>setQuery('')}>Сбросить поиск</button></p>}
      <div className="law-reading-layout"><aside className="law-toc"><h3>Оглавление</h3><nav aria-label="Главы выбранного документа">{chapters.map(c=><button type="button" key={c.id} onClick={()=>{setQuery('');setExpanded(true);setJump(c.id);}}>{c.title}</button>)}</nav></aside>
      <div className="law-text" aria-label="Текст выбранного документа">{entries.length===0?<p className="law-no-results">Совпадений нет. Попробуйте другой номер статьи или слово.</p>:entries.map(entry=>entry.kind==='article'?<details key={`${selected}-${entry.id}-${expanded}-${!!needle}`} id={`law-${selected}-${entry.id}`} className="law-article" open={expanded||!!needle}><summary><span>{entry.title}</span><ChevronDown size={19}/></summary><div className="law-article-body">{entry.paragraphs.map((text,i)=><p key={i}>{text}</p>)}</div></details>:<div key={entry.id} id={`law-${selected}-${entry.id}`} className={entry.kind==='section'?'law-chapter':'law-introduction'}>{entry.title&&<h3>{entry.title}</h3>}{entry.paragraphs.map((text,i)=><p key={i}>{text}</p>)}</div>)}</div></div>
    </>}
  </section>;
}

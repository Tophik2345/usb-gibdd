import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Search, Loader2, ChevronDown, Bookmark as BookmarkIcon, ArrowUpRight } from 'lucide-react';
import initialDocuments from '@/lib/law-documents.json';
import { useLawDocuments } from '@/lib/law-updates';
import { formatSiteDate } from '@/lib/date-time';
import { portalApi, type Bookmark } from '@/lib/portal-api';
import { matchesLaw, lawExcerpt, normalizeLawText, type LawText, type LawEntry } from '@/lib/law-search';
import SectionLinks from './section-links';

import { lawCache as cache, loadDocument } from '@/lib/law-loader';
const articleWord=(n:number)=>n%100>=11&&n%100<=14?'статей':n%10===1?'статья':n%10>=2&&n%10<=4?'статьи':'статей';
const pointWord=(n:number)=>n%100>=11&&n%100<=14?'пунктов':n%10===1?'пункт':n%10>=2&&n%10<=4?'пункта':'пунктов';
function lawLocation(){
  const params=new URLSearchParams(window.location.hash.split('?')[1]||'');
  const id=params.get('document');const article=params.get('article')||'';
  return {document:initialDocuments.some(d=>d.id===id)?id!:initialDocuments[0].id,article:/^article-\d+$/.test(article)?article:''};
}
export default function LawsSection({signedIn=false}:{signedIn?:boolean}){
  const {documents,updateError}=useLawDocuments();
  const articleCount=documents.filter(d=>d.unit!=='point').reduce((n,d)=>n+d.articleCount,0);
  const pointCount=documents.filter(d=>d.unit==='point').reduce((n,d)=>n+d.articleCount,0);
  const [selected,setSelected]=useState(()=>lawLocation().document);
  const [content,setContent]=useState<LawText|null>(null);
  const [query,setQuery]=useState('');
  const [scope,setScope]=useState<'all'|'document'|'favorites'>('all');
  const [expanded,setExpanded]=useState(true);
  const [error,setError]=useState('');const [retry,setRetry]=useState(0);
  const [jump,setJump]=useState(()=>lawLocation().article);
  const [loaded,setLoaded]=useState<Record<string,LawText>>({});
  const [failed,setFailed]=useState<string[]>([]);const [searchLoading,setSearchLoading]=useState(false);
  const [bookmarks,setBookmarks]=useState<Bookmark[]>([]);const [bookmarkLoading,setBookmarkLoading]=useState(signedIn);
  const [bookmarkError,setBookmarkError]=useState('');const [bookmarkRetry,setBookmarkRetry]=useState(0);
  const [saving,setSaving]=useState('');const [notice,setNotice]=useState('');
  const [limit,setLimit]=useState(24);
  const needle=normalizeLawText(query);
  const resultMode=scope==='favorites'||!!needle;
  const needsAll=scope==='favorites'||(scope==='all'&&!!needle);
  useEffect(()=>{const update=()=>{const next=lawLocation();setSelected(next.document);setContent(cache.get(next.document)||null);setQuery('');setScope('all');setExpanded(true);setJump(next.article);};window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update);},[]);
  useEffect(()=>{
    let active=true;setError('');setContent(cache.get(selected)||null);
    loadDocument(selected).then(data=>{if(active)setContent(data);}).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[selected,retry,documents]);
  useEffect(()=>{
    if(!needsAll)return;let active=true;setSearchLoading(true);setFailed([]);
    Promise.allSettled(documents.map(d=>loadDocument(d.id))).then(results=>{
      if(!active)return;const next:Record<string,LawText>={};const failures:string[]=[];
      results.forEach((result,index)=>{if(result.status==='fulfilled')next[documents[index].id]=result.value;else failures.push(documents[index].shortTitle);});
      setLoaded(next);setFailed(failures);setSearchLoading(false);
    });return()=>{active=false;};
  },[needsAll,retry,documents]);
  useEffect(()=>{
    if(!signedIn){setBookmarks([]);setBookmarkLoading(false);return;}
    let active=true;setBookmarkLoading(true);setBookmarkError('');
    portalApi<{bookmarks:Bookmark[]}>({op:'bookmarks'}).then(data=>{if(active)setBookmarks(data.bookmarks);}).catch(e=>{if(active)setBookmarkError(e.message);}).finally(()=>{if(active)setBookmarkLoading(false);});
    return()=>{active=false;};
  },[signedIn,bookmarkRetry]);
  useEffect(()=>setLimit(24),[query,scope,selected]);
  const bookmarkKeys=useMemo(()=>new Set(bookmarks.map(b=>`${b.document}/${b.article}`)),[bookmarks]);
  const results=useMemo(()=>{
    const docs=scope==='document'?(content?[content]:[]):documents.flatMap(d=>loaded[d.id]?[loaded[d.id]]:[]);
    return docs.flatMap(doc=>doc.entries.filter(e=>e.kind==='article'&&matchesLaw(e,query)&&(scope!=='favorites'||bookmarkKeys.has(`${doc.id}/${e.id}`))).map(entry=>({document:doc.id,entry})));
  },[scope,content,loaded,query,bookmarkKeys]);
  useEffect(()=>{if(jump&&content?.id===selected&&!resultMode){const target=document.getElementById(`law-${selected}-${jump}`);if(target){target.scrollIntoView({behavior:'smooth',block:'start'});setJump('');}}},[jump,selected,content,resultMode]);
  const toggleBookmark=async(documentId:string,entry:LawEntry)=>{
    if(!signedIn){setNotice('Войдите в аккаунт, чтобы сохранять статьи в избранное.');return;}
    const key=`${documentId}/${entry.id}`;const saved=!bookmarkKeys.has(key);setSaving(key);setNotice('');
    try{const data=await portalApi<{bookmarks:Bookmark[]}>({action:'setBookmark',document:documentId,article:entry.id,saved});setBookmarks(data.bookmarks);setNotice(saved?'Статья добавлена в избранное.':'Статья убрана из избранного.');}
    catch(e:any){setNotice(e.message);}finally{setSaving('');}
  };
  const bookmarkButton=(documentId:string,entry:LawEntry)=>{
    const key=`${documentId}/${entry.id}`;const saved=bookmarkKeys.has(key);
    return <button type="button" className={'law-bookmark '+(saved?'is-saved':'')} disabled={!!saving||bookmarkLoading||!!bookmarkError} aria-pressed={saved} aria-label={`${saved?'Убрать из избранного':'В избранное'}: ${entry.title}`} onClick={()=>toggleBookmark(documentId,entry)}>
      {saving===key?<Loader2 size={15} className="spin"/>:<BookmarkIcon size={15} fill={saved?'currentColor':'none'}/>} {saved?'Сохранено':'В избранное'}
    </button>;
  };
  const choose=(id:string)=>{setContent(cache.get(id)||null);setSelected(id);setQuery('');setScope('document');setExpanded(true);setJump('');window.location.hash=`laws?document=${id}`;};
  const meta=documents.find(d=>d.id===selected)!;
  const chapters=content?.entries.filter(e=>e.kind==='section')||[];
  return <section className="laws-library" aria-labelledby="laws-title">
    <SectionLinks section="laws"/><h1 id="laws-title">Законы РО</h1>
    <p className="information-description">Полные тексты законов и ПДД сервера «Кутузовский» игрового проекта «Россия Онлайн».</p>
    <div className="laws-overview"><span><strong>{documents.length}</strong> документов</span><span><strong>{articleCount}</strong> {articleWord(articleCount)}</span><span><strong>{pointCount}</strong> {pointWord(pointCount)} ПДД</span></div>
    <div className="law-search-panel">
      <div className="law-search-scopes" role="group" aria-label="Область поиска">
        <button type="button" aria-pressed={scope==='all'} onClick={()=>setScope('all')}>Все документы</button>
        <button type="button" aria-pressed={scope==='document'} onClick={()=>setScope('document')}>Выбранный документ</button>
        <button type="button" aria-pressed={scope==='favorites'} onClick={()=>setScope('favorites')}><BookmarkIcon size={16}/>Избранное{signedIn&&!bookmarkLoading&&` · ${bookmarks.length}`}</button>
      </div>
      <label className="law-search"><Search size={20}/><span className="sr-only">Поиск по законам</span><input type="search" maxLength={200} value={query} onChange={e=>setQuery(e.target.value)} placeholder={scope==='all'?'Номер статьи, пункта или фраза во всех документах':'Номер статьи, пункта, слово или фраза'}/></label>
      <p className="law-search-hint">Номер находит точную статью или пункт. Можно уточнить: «ст. 14.7» или «п. 8.2». Слово или фраза — поиск в заголовке и тексте.</p>
      {notice&&<p className="law-feedback" role="status">{notice}{!signedIn&&<> <a href="#account">Войти</a></>}</p>}
      {bookmarkError&&<p className="law-feedback" role="alert">Избранное: {bookmarkError} <button type="button" className="text-button" onClick={()=>setBookmarkRetry(n=>n+1)}>Повторить</button></p>}
    </div>
    <nav className="law-document-picker" aria-label="Выбор нормативного документа">{documents.map(d=><button type="button" key={d.id} aria-pressed={selected===d.id} onClick={()=>choose(d.id)}><BookOpen size={19}/><span><strong>{d.shortTitle}</strong><small>{d.articleCount} {d.unit==='point'?pointWord(d.articleCount):articleWord(d.articleCount)}</small></span></button>)}</nav>
    {resultMode?<div className="law-results" aria-live="polite">
      {scope==='favorites'&&!signedIn?<div className="portal-empty"><BookmarkIcon size={27}/><h2>Избранное доступно в аккаунте</h2><p>Сохранённые статьи будут доступны после входа с любого устройства.</p><a className="button outline" href="#account">Войти в аккаунт</a></div>:
      (needsAll?searchLoading:!content&&!error)||scope==='favorites'&&bookmarkLoading?<p className="law-loading"><Loader2 className="spin" size={20}/>Загружаем документы…</p>:<>
        {failed.length>0&&needsAll&&<div className="error-banner" role="alert"><span>Поиск выполнен по {Object.keys(loaded).length} из {documents.length} документов. Не загрузились: {failed.join(', ')}.</span><button type="button" className="text-button" onClick={()=>setRetry(n=>n+1)}>Повторить</button></div>}
        {scope==='document'&&error&&<div className="error-banner" role="alert">{error}<button type="button" className="text-button" onClick={()=>setRetry(n=>n+1)}>Повторить</button></div>}
        <div className="law-result-heading"><h2>{scope==='favorites'?'Избранные статьи':'Результаты поиска'} <span>{results.length}</span></h2>{query&&<button type="button" className="text-button" onClick={()=>setQuery('')}>Сбросить поиск</button>}</div>
        {results.length===0?<p className="law-no-results">{scope==='favorites'&&!query?'Сохраняйте нужные статьи кнопкой «В избранное».':'Совпадений нет. Попробуйте другой номер статьи или фразу.'}</p>:results.slice(0,limit).map(({document:doc,entry})=><article className="law-result-card" key={`${doc}/${entry.id}`}>
          <div className="law-result-meta"><span>{documents.find(d=>d.id===doc)?.shortTitle}</span>{bookmarkButton(doc,entry)}</div>
          <a className="law-result-title" href={`#laws?document=${doc}&article=${entry.id}`}>{entry.title}<ArrowUpRight size={17}/></a>
          {entry.chapter&&<p className="law-result-chapter">{entry.chapter}</p>}<p>{lawExcerpt(entry,query)}</p>
        </article>)}
        {results.length>limit&&<button type="button" className="button outline" onClick={()=>setLimit(n=>n+24)}>Показать ещё · осталось {results.length-limit}</button>}
      </>}
    </div>:<>
      <div className="law-reading-heading"><h2>{meta.title}</h2><p>{meta.description}</p></div>
      <div className="law-tools"><button type="button" className="button outline" disabled={!content} onClick={()=>setExpanded(v=>!v)}>{expanded?'Свернуть':'Развернуть'} {meta.unit==='point'?'пункты':'статьи'}</button></div>
      <p className="law-edition">Сервер: {meta.server}. Проверка официального источника — каждые 6 часов.<br/>
        {content?.checkedAt?<>Проверено: {formatSiteDate(content.checkedAt)}.{content.sourceEditedAt&&<> Последняя правка на форуме: {formatSiteDate(content.sourceEditedAt)}.</>} <a href={meta.sourceUrl} target="_blank" rel="noopener noreferrer">Официальный источник</a></>:<>Сохранённая копия от {meta.date}. Загружаем сведения о проверке.</>}<br/>
        Нумерация, части и примечания сохранены. Иллюстрации доступны в официальной теме.</p>
      {updateError&&<p className="law-feedback" role="status">{updateError}</p>}
      {meta.editorialNotes.length>0&&<details className="law-edition-notes"><summary>Замечания к копии от {meta.date}</summary><p>В исходной копии обнаружены несогласованные ссылки. Сверьте их с текущим текстом официальной темы; перед применением спорной нормы уточните её у уполномоченного руководства.</p><ul>{meta.editorialNotes.map(note=><li key={note}>{note}</li>)}</ul></details>}
      {error?<div className="error-banner" role="alert"><span>{error}</span><button type="button" className="text-button" onClick={()=>setRetry(n=>n+1)}>Повторить</button></div>:!content?<p className="law-loading" role="status"><Loader2 className="spin" size={20}/>Загружаем статьи…</p>:<div className="law-reading-layout">
        <aside className="law-toc"><h3>Оглавление</h3><nav aria-label="Главы выбранного документа">{chapters.map(c=><button type="button" key={c.id} onClick={()=>{setQuery('');setExpanded(true);setJump(c.id);}}>{c.title}</button>)}</nav></aside>
        <div className="law-text" aria-label="Текст выбранного документа">{content.entries.map(entry=>entry.kind==='article'?<details key={`${selected}-${entry.id}-${expanded}`} id={`law-${selected}-${entry.id}`} className="law-article" open={expanded}>
          <summary><span>{entry.title}</span><ChevronDown size={19}/></summary><div className="law-article-tools">{bookmarkButton(selected,entry)}</div>
          <div className="law-article-body">{entry.paragraphs.map((text,i)=><p key={i}>{text}</p>)}</div>
        </details>:<div key={entry.id} id={`law-${selected}-${entry.id}`} className={entry.kind==='section'?'law-chapter':'law-introduction'}>{entry.title&&<h3>{entry.title}</h3>}{entry.paragraphs.map((text,i)=><p key={i}>{text}</p>)}</div>)}</div>
      </div>}
    </>}
  </section>;
}

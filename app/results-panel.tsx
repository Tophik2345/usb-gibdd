import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, SlidersHorizontal } from 'lucide-react';
import { resultsApi, exportResults, emptyResultsFilters, type ResultScope, type ResultsFilters, type ResultCursor, type ResultsPage } from '@/lib/results-api';
import { resultStatus, resultPassed } from '@/lib/results-export';
import { formatSiteDate } from '@/lib/date-time';
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from '@/components/ui/table';
export default function ResultsPanel({scope,onOpen}:{scope:ResultScope;onOpen?:(id:string)=>void}) {
  const [draft,setDraft]=useState({...emptyResultsFilters}),[filters,setFilters]=useState({...emptyResultsFilters});
  const [page,setPage]=useState<ResultsPage|null>(null),[history,setHistory]=useState<(ResultCursor|null)[]>([null]);
  const [snapshot,setSnapshot]=useState<string|undefined>(),[revision,setRevision]=useState(0);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[exporting,setExporting]=useState(false),[progress,setProgress]=useState('');
  const exportId=useRef(0);
  const [tests,setTests]=useState<{id:string;title:string}[]>([]);
  useEffect(()=>()=>{exportId.current++;},[]);
  const cursor=history[history.length-1];
  useEffect(()=>{
    let active=true;setLoading(true);setError('');setPage(null);
    resultsApi(scope,filters,cursor,snapshot).then(next=>{if(active){setPage(next);setTests(next.tests);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[scope,filters,cursor,snapshot,revision]);
  function apply(next:ResultsFilters){
    if(next.from && next.to && next.from>next.to){setError('Начальная дата должна быть не позже конечной.');return;}
    if(next.minScore!=='' && next.maxScore!=='' && Number(next.minScore)>Number(next.maxScore)){setError('Минимальная оценка должна быть не больше максимальной.');return;}
    setFilters({...next});setHistory([null]);setSnapshot(undefined);setError('');
  }
  async function download(){
    if(exporting||loading||!page?.total)return;
    const id=++exportId.current;setExporting(true);setError('');setProgress('Готовим отчёт…');
    try {
      const csv=await exportResults(scope,filters,()=>id!==exportId.current,(loaded,total)=>setProgress(`Подготовлено ${loaded} из ${total}`));
      if(id!==exportId.current)return;
      const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download=`results-${scope}.csv`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);setProgress('Отчёт готов.');
    }catch(e){if(id===exportId.current){setError(e instanceof Error?e.message:'Не удалось выгрузить отчёт.');setProgress('');}}
    finally{if(id===exportId.current)setExporting(false);}
  }
  const change=(key:keyof ResultsFilters,value:string)=>setDraft(current=>({...current,[key]:value}));
  const employees=scope==='team'||scope==='all';
  return <section className="results-panel" aria-label="Фильтры и результаты">
    <form className="results-filters" onSubmit={e=>{e.preventDefault();apply(draft);}}>
      <label className="field">Тест<select aria-label="Тест" value={draft.testId} onChange={e=>change('testId',e.target.value)} disabled={exporting}><option value="">Все тесты</option>{tests.map(test=><option key={test.id} value={test.id}>{test.title}</option>)}</select></label>
      <label className="field">Сотрудник<input maxLength={100} value={draft.employee} onChange={e=>change('employee',e.target.value)} placeholder="Имя или часть имени" disabled={exporting}/></label>
      <label className="field">Дата с (МСК)<input type="date" value={draft.from} onChange={e=>change('from',e.target.value)} disabled={exporting}/></label>
      <label className="field">Дата по (МСК)<input type="date" value={draft.to} onChange={e=>change('to',e.target.value)} disabled={exporting}/></label>
      <label className="field">Оценка от, %<input type="number" min={0} max={100} step={1} value={draft.minScore} onChange={e=>change('minScore',e.target.value)} disabled={exporting}/></label>
      <label className="field">Оценка до, %<input type="number" min={0} max={100} step={1} value={draft.maxScore} onChange={e=>change('maxScore',e.target.value)} disabled={exporting}/></label>
      <label className="field">Статус<select aria-label="Статус" value={draft.status} onChange={e=>change('status',e.target.value)} disabled={exporting}><option value="all">Все результаты</option><option value="passed">{scope==='practice'?'Без ошибок':'Зачёт'}</option><option value="failed">{scope==='practice'?'Есть ошибки':'Не зачтено'}</option></select></label>
      <div className="results-filter-actions"><button className="button outline" disabled={exporting} type="submit"><SlidersHorizontal size={17}/>Применить</button><button className="text-button" disabled={exporting} type="button" onClick={()=>{setDraft({...emptyResultsFilters});apply(emptyResultsFilters);}}>Сбросить</button></div>
    </form>
    <div className="results-toolbar"><p role="status">{loading?'Загружаем результаты…':page?`Найдено результатов: ${page.total}`:''}</p><div><button className="text-button" type="button" disabled={exporting||loading} onClick={()=>{setHistory([null]);setSnapshot(undefined);setRevision(v=>v+1);}}>Обновить</button><button className="button outline" type="button" disabled={exporting||loading||!page?.total} onClick={download}>{exporting?<Loader2 size={17} className="spin"/>:<Download size={17}/>}Скачать CSV для Excel</button>{exporting&&<button className="text-button" type="button" onClick={()=>{exportId.current++;setExporting(false);setProgress('Экспорт отменён.');}}>Отменить экспорт</button>}</div></div>
    {progress&&<p className="table-caption" role="status">{progress}</p>}
    {error&&<p className="inline-error" role="alert">{error}</p>}
    {!loading&&page&&!page.rows.length&&<p className="results-empty">Нет результатов по выбранным фильтрам.</p>}
    {page&&page.rows.length>0&&<><div className="results-table"><Table containerLabel="Результаты проверок — прокрутка таблицы"><TableHeader><TableRow>{employees&&<TableHead>Сотрудник</TableHead>}<TableHead>Тест</TableHead><TableHead>Дата (МСК)</TableHead><TableHead>Верно</TableHead><TableHead>Результат</TableHead><TableHead>Статус</TableHead>{onOpen&&<TableHead><span className="sr-only">Действия</span></TableHead>}</TableRow></TableHeader><TableBody>{page.rows.map(row=><TableRow key={row.id}>{employees&&<TableCell>{row.employeeName}</TableCell>}<TableCell className="test-name-cell">{row.testTitle}{row.mode==='practice'&&<small>Работа над ошибками</small>}{row.assignmentId&&<small>{row.assignmentReset?'Обнулённое назначение':row.assignmentCancelled?'Отменённое назначение':'По назначению'}</small>}{row.demo&&<small>Демонстрация</small>}</TableCell><TableCell>{formatSiteDate(row.finishedAt!,{month:'short',year:undefined})}</TableCell><TableCell>{row.score} из {row.total}</TableCell><TableCell><strong>{Number((row.score!*100/row.total).toFixed(1)).toLocaleString('ru-RU')}%</strong></TableCell><TableCell><span className={'badge '+(resultPassed(row)?'green-badge':'orange-badge')}>{resultStatus(row)}</span></TableCell>{onOpen&&<TableCell><button className="text-button" type="button" onClick={()=>onOpen(row.id)}>Разбор</button></TableCell>}</TableRow>)}</TableBody></Table></div><div className="account-pagination"><button type="button" className="button outline" disabled={exporting||history.length===1} onClick={()=>setHistory(v=>v.slice(0,-1))}>Назад</button><span>Страница {history.length}</span><button type="button" className="button outline" disabled={exporting||!page.nextCursor} onClick={()=>{setSnapshot(page.snapshot);setHistory(v=>[...v,page.nextCursor]);}}>Далее</button></div></>}
  </section>;
}

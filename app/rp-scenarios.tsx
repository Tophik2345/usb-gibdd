import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Route, RotateCcw, AlertCircle } from 'lucide-react';
import { trainingApi, useTraining, type RPRun } from '@/lib/training-api';
import { TrainingLoad } from './training-center';
import CurrentNorm from './current-norm';
type Scenario={id:string;title:string;description:string;activeRunId:string|null;completed:number};
export default function Scenarios(){
  const query=useTraining<{scenarios:Scenario[]}>({op:'scenarios'});
  const [run,setRun]=useState<RPRun|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{setError('');},[run?.id]);
  const start=async(id:string)=>{setBusy(true);setError('');try{setRun(await trainingApi({action:'startScenario',scenarioId:id}));}catch(e:any){setError(e.message);}finally{setBusy(false);}};
  const choose=async(id:string)=>{if(!run?.node)return;setBusy(true);setError('');try{setRun(await trainingApi({action:'chooseScenario',id:run.id,nodeId:run.node.id,choiceId:id}));}catch(e:any){setError(e.message);}finally{setBusy(false);}};
  const refreshRun=async()=>{if(!run)return;setBusy(true);setError('');try{setRun(await trainingApi({op:'scenarioRun',id:run.id}));}catch(e:any){setError(e.message);}finally{setBusy(false);}};
  if(run){
    const last=run.history.at(-1),correct=run.history.filter(h=>h.correct).length;
    return <div className="scenario-run"><button className="text-button" disabled={busy} onClick={()=>{setRun(null);query.refresh();}}>← Все ситуации</button><div className="training-section-heading"><div><span className="eyebrow">ПРАКТИКА · РЕШЕНИЕ ЗА РЕШЕНИЕМ</span><h2>{run.title}</h2><p>Прогресс сохраняется после каждого выбранного действия.</p></div><span className="badge">{run.finishedAt?'Завершено':`Шаг ${run.history.length+1}`}</span></div>
      {last&&!run.finishedAt&&<div className={'scenario-feedback '+(last.correct?'correct':'incorrect')} role="status">{last.correct?<CheckCircle2 size={23}/>:<AlertCircle size={23}/>}<div><strong>{last.correct?'Решение обосновано':'Разберём это решение'}</strong><p>{last.feedback}</p>{last.reference&&<a className="text-button" href={last.reference.href} target="_blank" rel="noopener noreferrer">{last.reference.label} ↗</a>}</div></div>}
      {run.node?<article className="training-panel scenario-question"><h3>{run.node.text}</h3><div className="scenario-choices">{run.node.choices.map((c,i)=><button disabled={busy} key={c.id} onClick={()=>choose(c.id)}><span>{i+1}</span><strong>{c.text}</strong><ArrowRight size={18}/></button>)}</div></article>:<div className="training-panel scenario-result"><CheckCircle2 size={40}/><span className="eyebrow">СИТУАЦИЯ ЗАВЕРШЕНА</span><h3>{correct} из {run.history.length}</h3><p>Обоснованных решений. Тренажёр помогает разобрать порядок действий и не заменяет обязательные тесты.</p><button className="button primary" disabled={busy} onClick={()=>start(run.scenarioId)}><RotateCcw size={17}/>Пройти заново</button></div>}
      {run.history.length>0&&<details className="training-panel scenario-history" open={!!run.finishedAt}><summary>Разбор решений · {run.history.length}</summary>{run.history.map((h,i)=><article key={i}><span className={h.correct?'correct-text':'incorrect-text'}>{h.correct?'✓':'!'} Шаг {i+1}</span><h3>{h.question}</h3><p>Выбрано: {h.choice}</p><p>{h.feedback}</p>{h.reference&&<><a className="text-button" href={h.reference.href} target="_blank" rel="noopener noreferrer">{h.reference.label} ↗</a><CurrentNorm href={h.reference.href}/></>}</article>)}</details>}
      {error&&<div className="error-banner" role="alert">{error}<button className="button outline" disabled={busy} onClick={refreshRun}>Обновить шаг</button></div>}
    </div>;
  }
  return <><div className="training-section-heading"><div><h2>Пошаговые RP-ситуации</h2><p>Выбирай действие, получай разбор и наблюдай, как меняется ситуация.</p></div></div>{query.loading||!query.data?<TrainingLoad error={query.error} refresh={query.refresh}/>:<div className="training-grid">{query.data.scenarios.map((s,i)=><article key={s.id} className="training-panel scenario-card"><div className="scenario-card-top"><Route size={26}/><span>{String(i+1).padStart(2,'0')}</span></div><h3>{s.title}</h3><p>{s.description}</p><small>{s.completed?`Завершено прохождений: ${s.completed}`:'Практика без влияния на оценки'}</small><button className="button primary" disabled={busy} onClick={()=>start(s.id)}>{s.activeRunId?'Продолжить ситуацию':'Начать ситуацию'}<ArrowRight size={17}/></button></article>)}{!query.data.scenarios.length&&<p className="training-panel">Ситуации готовятся к публикации.</p>}</div>}{error&&<p className="inline-error" role="alert">{error}</p>}</>;
}

import { useEffect, useRef, useState } from 'react';
import { Clock3 } from 'lucide-react';
import type { Attempt } from '@/lib/types';
export default function AttemptTimer({attempt,busy,onExpired}:{attempt:Attempt;busy:boolean;onExpired:()=>Promise<void>}){
  const [tick,setTick]=useState(Date.now());
  const offset=useRef(attempt.serverNow?Date.parse(attempt.serverNow)-Date.now():0);
  const submitted=useRef(false);
  useEffect(()=>{if(attempt.serverNow)offset.current=Date.parse(attempt.serverNow)-Date.now();},[attempt.serverNow]);
  useEffect(()=>{const interval=setInterval(()=>setTick(Date.now()),500);return()=>clearInterval(interval);},[]);
  const remaining=attempt.deadlineAt?Math.max(0,Math.ceil((Date.parse(attempt.deadlineAt)-tick-offset.current)/1000)):null;
  useEffect(()=>{if(remaining===0&&!attempt.finishedAt&&!attempt.readOnly&&!busy&&!submitted.current){submitted.current=true;void onExpired();}},[remaining,attempt.finishedAt,attempt.readOnly,busy,onExpired]);
  if(remaining===null||attempt.finishedAt||attempt.readOnly)return null;
  return <div className={'attempt-timer '+(remaining<=60?'is-urgent':'')}><span><Clock3 size={19}/><strong role="timer" aria-label="Оставшееся время">{String(Math.floor(remaining/60)).padStart(2,'0')}:{String(remaining%60).padStart(2,'0')}</strong><small>{remaining?'Осталось до завершения':'Время истекло — учитываются сохранённые ответы'}</small></span>{remaining===0&&<button className="button outline" disabled={busy} onClick={onExpired}>Получить результат</button>}</div>;
}

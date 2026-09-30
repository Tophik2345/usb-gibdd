import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { WorkspaceError } from './workspace-api';

export type ClearanceStatus = 'preparing'|'pending'|'approved'|'rejected'|'revoked'|'outdated';
export type Clearance = {
  programVersion:number; ready:boolean; status:ClearanceStatus; note:string|null;
  requestedAt:string|null; decidedAt:string|null; decidedBy:string|null; canManage?:boolean;
  materials:{id:string;title:string;description:string;href:string;readAt:string|null}[];
  tests:{id:string;title:string;version:number;published:boolean;passed:boolean;passedAt:string|null}[];
  availableTests?:{id:string;title:string}[];
};
export type RPHistory = {nodeId:string;question:string;choice:string;correct:boolean;feedback:string;reference?:{label:string;href:string}};
export type RPRun = {id:string;scenarioId:string;title:string;finishedAt:string|null;history:RPHistory[];node:{id:string;text:string;choices:{id:string;text:string}[]}|null};
export async function trainingApi<T>(payload:Record<string,unknown>):Promise<T>{
  const {data,error}=await supabase().rpc('knowledge_training',{payload});
  if(error){
    if(/^PT4\d\d$/.test(error.code))throw new WorkspaceError(error.message,Number(error.code.slice(2)));
    throw new WorkspaceError('Не удалось выполнить действие. Проверьте соединение и повторите.');
  }
  return data as T;
}
export function useTraining<T>(payload:Record<string,unknown>){
  const key=JSON.stringify(payload);
  const [data,setData]=useState<T|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{let active=true;setLoading(true);setError('');setData(null);
    trainingApi<T>(JSON.parse(key)).then(next=>{if(active)setData(next);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[key,revision]);
  return {data,loading,error,refresh:()=>setRevision(n=>n+1)};
}

import { useEffect, useState } from 'react';
import { portalApi } from '@/lib/portal-api';
export function usePortalList<T>(op:string){
  const [data,setData]=useState<T|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [revision,setRevision]=useState(0);
  useEffect(()=>{let active=true;setLoading(true);setData(null);setError('');
    portalApi<T>({op}).then(next=>{if(active)setData(next);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[op,revision]);
  return {data,loading,error,refresh:()=>setRevision(n=>n+1)};
}

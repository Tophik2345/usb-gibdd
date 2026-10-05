import { useCallback,useEffect,useState } from 'react';
import { serviceApi } from '@/lib/service-api';
import { errorMessage } from '@/lib/department-api';
export function useServiceData<T>(payload: Record<string,unknown>) {
  const key=JSON.stringify(payload),[revision,setRevision]=useState(0),[data,setData]=useState<T|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{let active=true;setData(null);setLoading(true);setError('');
    void serviceApi<T>(JSON.parse(key)).then(value=>{if(active)setData(value);}).catch(cause=>{if(active)setError(errorMessage(cause));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[key,revision]);
  const refresh=useCallback(()=>setRevision(value=>value+1),[]);
  return {data,loading,error,refresh};
}

import { useEffect, useState } from 'react';
import { departmentApi, errorMessage } from '@/lib/department-api';

export function useDepartmentData<T>(payload: Record<string, unknown>) {
  const key = JSON.stringify(payload);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setLoading(true); setError(''); setData(null);
    departmentApi<T>(JSON.parse(key)).then(result => { if (current) setData(result); })
      .catch(cause => { if (current) setError(errorMessage(cause)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [key, revision]);
  return { data, loading, error, refresh: () => setRevision(value => value + 1) };
}

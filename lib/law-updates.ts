import { useEffect, useState } from 'react';
import initial from './law-documents.json';
import { loadLawManifest, lawRefreshInterval } from './law-loader';

export function useLawDocuments() {
  const [documents, setDocuments] = useState(initial);
  const [updateError, setUpdateError] = useState('');
  useEffect(() => {
    let active = true;
    const update = () => loadLawManifest().then(data => { if (active) { setDocuments(data); setUpdateError(''); } })
      .catch(() => { if (active) setUpdateError('Обновления сейчас проверить не удалось. Доступна последняя сохранённая редакция.'); });
    void update();
    const timer = window.setInterval(() => { void update(); }, lawRefreshInterval);
    const visible = () => { if (document.visibilityState === 'visible') void update(); };
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, []);
  return { documents, updateError };
}

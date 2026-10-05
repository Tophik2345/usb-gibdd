import { useEffect, useState } from 'react';
import { useLawDocuments } from '@/lib/law-updates';
import { loadDocument } from '@/lib/law-loader';
import type { LawText } from '@/lib/law-search';
import { splitExplanation, joinExplanation } from '@/lib/question-reference';
import './site-improvements.css';
export default function QuestionReferencePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const parts = splitExplanation(value), { documents } = useLawDocuments();
  const [document, setDocument] = useState(parts.reference?.document || ''), [data, setData] = useState<LawText | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => { if (parts.reference) setDocument(parts.reference.document); }, [parts.reference?.document]);
  useEffect(() => { if (!document) { setData(null); return; } let active = true; setData(null); setError(''); void loadDocument(document).then(next => { if (active) setData(next); }).catch(() => { if (active) setError('Не удалось загрузить статьи.'); }); return () => { active = false; }; }, [document, retry]);
  const setReference = (article: string) => {
    const next = joinExplanation(parts.text, article ? { document, article, href: `#laws?document=${document}&article=${article}` } : null);
    if (next.length > 1000) { setError('Пояснение и ссылка вместе должны занимать не более 1000 символов.'); return; }
    setError(''); onChange(next);
  };
  return <div className="norm-picker"><label className="field">Норма для разбора ответа<select value={document} onChange={event => { const next = event.target.value; setDocument(next); onChange(joinExplanation(parts.text, null)); }}><option value="">Без ссылки на норму</option>{documents.map(doc => <option key={doc.id} value={doc.id}>{doc.shortTitle}</option>)}</select></label>
    {document && <label className="field">Статья или пункт<select value={parts.reference?.article || ''} disabled={!data} onChange={event => setReference(event.target.value)}><option value="">{data ? 'Выберите статью или пункт' : 'Загружаем статьи…'}</option>{data?.entries.filter(entry => entry.kind === 'article').map(entry => <option key={entry.id} value={entry.id}>{entry.chapter ? entry.chapter + ' · ' : ''}{entry.title.slice(0, 240)}</option>)}</select></label>}
    {error && <p role="alert" className="inline-error">{error} <button type="button" className="text-button" onClick={() => setRetry(value => value + 1)}>Повторить</button></p>}<p className="helper">Ссылка и пояснение появятся после завершения теста. Текст нормы открывается в текущей редакции.</p>
  </div>;
}

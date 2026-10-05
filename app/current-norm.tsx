import { useEffect, useState } from 'react';
import { loadDocument } from '@/lib/law-loader';
import type { LawText } from '@/lib/law-search';
import { useLawDocuments } from '@/lib/law-updates';
import { formatSiteDate } from '@/lib/date-time';
import { splitExplanation } from '@/lib/question-reference';
import './site-improvements.css';
export default function CurrentNorm({ href }: { href: string }) {
  const reference = splitExplanation('Открыть статью: ' + href).reference;
  const { documents } = useLawDocuments();
  const [data, setData] = useState<LawText | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0), [open, setOpen] = useState(false);
  const document = reference?.document, article = reference?.article;
  useEffect(() => { if (!document || !open) return; let active = true; setData(null); setError(''); void loadDocument(document).then(next => { if (active) setData(next); }).catch(() => { if (active) setError('Не удалось загрузить действующую норму.'); }); return () => { active = false; }; }, [document, open, retry, documents]);
  if (!reference) return null;
  const entry = data?.entries.find(entry => entry.id === article);
  return <details className="current-norm" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>Действующая норма · показать текст</summary>{error ? <p role="alert">{error} <button type="button" className="text-button" onClick={() => setRetry(value => value + 1)}>Повторить</button></p> : !data ? <p role="status">Загружаем норму…</p> : !entry ? <p>Статья отсутствует в текущей редакции. <a href={reference.href} target="_blank" rel="noopener noreferrer">Открыть документ ↗</a></p> : <><p className="helper">{data.checkedAt && <>Проверено: {formatSiteDate(data.checkedAt)}. </>}Этот текст обновляется из официального источника. Пояснение к ответу относится к сохранённой редакции теста.</p><h4>{entry.title}</h4>{entry.paragraphs.map((text, index) => <p key={index}>{text}</p>)}<a href={reference.href} target="_blank" rel="noopener noreferrer" className="text-button">Открыть в библиотеке ↗</a></>}</details>;
}

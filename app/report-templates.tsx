import { useState } from 'react';
import { Copy, Download, FileText, Check } from 'lucide-react';
import { toast } from 'sonner';
import { reportKinds, buildReport, type ReportDraft, type ReportKind } from '@/lib/report-templates';
import { toSiteDateTimeInput } from '@/lib/date-time';

export default function ReportTemplates({ displayName }: { displayName: string }) {
  const [kind, setKind] = useState<ReportKind>('check');
  const [draft, setDraft] = useState<ReportDraft>({ author: displayName, recipient: 'Руководству УСБ ГИБДД', date: toSiteDateTimeInput(new Date()).slice(0, 10), period: '', place: '', basis: '', participants: '', actions: '', findings: '', evidence: '', conclusion: '' });
  const [copied, setCopied] = useState(false);
  const text = buildReport(kind, draft);
  const update = (field: keyof ReportDraft, value: string) => { setDraft(old => ({ ...old, [field]: value })); setCopied(false); };
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); toast.success('Текст скопирован'); } catch { toast.error('Не удалось скопировать. Выделите текст в предпросмотре или скачайте файл.'); } };
  const download = () => { const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `usb-${kind}-${draft.date || 'report'}.txt`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const field = (name: keyof ReportDraft, label: string, placeholder = '', rows = 3) => <label className="field">{label}<textarea value={draft[name]} maxLength={6000} rows={rows} placeholder={placeholder} onChange={e => update(name, e.target.value)} /></label>;
  return <div className="department-content"><div className="portal-heading"><div><h2><FileText size={24} />Рапорты и отчёты</h2><p className="portal-note">Выберите шаблон, заполните данные и скопируйте или скачайте готовый текст.</p></div></div>
    <div className="report-kinds" role="group" aria-label="Тип документа">{Object.entries(reportKinds).map(([id, item]) => <button key={id} type="button" aria-pressed={kind === id} onClick={() => { setKind(id as ReportKind); setCopied(false); }}><FileText size={22} /><strong>{item.label}</strong><span>{item.description}</span></button>)}</div>
    <p className="department-notice">Шаблоны предназначены для игрового проекта «Россия Онлайн». Заполняйте их подтверждёнными фактами. Документ не отправляется автоматически.</p>
    <div className="report-layout"><form className="portal-form department-card report-form" onSubmit={e => e.preventDefault()}>
      <h3>Данные документа</h3><label className="field">Автор · Имя Фамилия Статик<input maxLength={100} value={draft.author} onChange={e => update('author', e.target.value)} placeholder="Имя Фамилия Статик" /></label><label className="field">Кому<input maxLength={200} value={draft.recipient} onChange={e => update('recipient', e.target.value)} /></label>
      <div className="portal-form-row"><label className="field">Дата<input type="date" value={draft.date} onChange={e => update('date', e.target.value)} /></label><label className="field">Время / период · МСК<input maxLength={120} value={draft.period} onChange={e => update('period', e.target.value)} placeholder="Например: 18:00–20:00" /></label></div>
      <label className="field">Место<input maxLength={300} value={draft.place} onChange={e => update('place', e.target.value)} placeholder="Локация проведения" /></label>
      {field('basis', kind === 'check' ? 'Основание проверки' : kind === 'event' ? 'Цель и основание мероприятия' : 'Задачи на смену', 'Номер обращения, поручение или поставленные задачи')}
      {field('participants', 'Участники', 'Имена, статики, роль каждого участника')}
      {field('actions', 'Выполненные действия', 'Последовательность действий и время', 4)}
      {field('findings', kind === 'check' ? 'Установленные факты' : 'Результаты и происшествия', 'Что установлено и чем подтверждается', 4)}
      {field('evidence', 'Материалы и доказательства', 'Ссылки на скриншоты, видео, логи и пояснения к ним')}
      {field('conclusion', kind === 'shift' ? 'Передача дел и замечания' : 'Выводы и предложения', 'Итог, предложения и дальнейшие действия')}
    </form><aside className="report-preview department-card"><div className="portal-heading"><h3>Предпросмотр</h3><span className="badge">TXT</span></div><p className="portal-note">Поля в квадратных скобках ещё нужно заполнить.</p><textarea aria-label="Готовый текст документа" readOnly value={text} spellCheck={false} /><div className="portal-actions"><button className="button primary" onClick={copy}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? 'Скопировано' : 'Копировать'}</button><button className="button outline" onClick={download}><Download size={17} />Скачать .txt</button></div></aside></div>
  </div>;
}

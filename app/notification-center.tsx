import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CalendarClock, Check, CheckCheck, ClipboardCheck, GraduationCap, Loader2, MessageSquare, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { notificationsApi, type NotificationCounts, type NotificationCursor, type NotificationPage, type PersonalNotification } from '@/lib/notifications-api';
import { formatSiteDate } from '@/lib/date-time';
import './notification-center.css';

const icons = { assignment: ClipboardCheck, deadline: CalendarClock, overdue: CalendarClock, appeal: MessageSquare, clearance: GraduationCap };
const message = (error: unknown) => error instanceof Error ? error.message : 'Не удалось обновить уведомления.';
export default function NotificationCenter({ userId, onOpen }: { userId: string; onOpen: (item: PersonalNotification) => void }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationPage | null>(null);
  const [loading, setLoading] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  const revision = useRef(0), cursor = useRef<NotificationCursor | null>(null);
  const openRef = useRef(false), marking = useRef(false);
  const load = useCallback(async (more = false) => {
    if (marking.current) return;
    const current = ++revision.current;
    setLoading(true); setError('');
    try {
      const next = await notificationsApi<NotificationPage>({ action: 'list', cursor: more ? cursor.current : null });
      if (current !== revision.current) return;
      cursor.current = next.nextCursor;
      setData(previous => more && previous ? { ...next, items: [...new Map([...previous.items, ...next.items].map(item => [item.id, item])).values()] } : next);
    } catch (cause) { if (current === revision.current) setError(message(cause)); }
    finally { if (current === revision.current) setLoading(false); }
  }, [userId]);
  useEffect(() => {
    void load();
    const refreshVisible = () => { if (!document.hidden && !openRef.current) void load(); };
    const timer = setInterval(refreshVisible, 60_000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      revision.current++; clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [load]);
  const changeOpen = (next: boolean) => {
    openRef.current = next; setOpen(next);
    if (next) void load();
  };
  const mark = async (item?: PersonalNotification, navigate = false) => {
    if (marking.current) return;
    const current = ++revision.current;
    marking.current = true; setPending(true); setLoading(false); setError('');
    try {
      const counts = await notificationsApi<NotificationCounts>(item ? { action: 'markRead', ids: [item.id] } : { action: 'markAll' });
      if (current !== revision.current) return;
      setData(previous => previous && { ...previous, ...counts, items: previous.items.map(row => !item || row.id === item.id ? { ...row, read: true } : row) });
    } catch (cause) {
      if (current !== revision.current) return;
      setError(message(cause));
      if (navigate) toast.error('Не удалось отметить уведомление прочитанным. Можно повторить позже.');
    } finally {
      marking.current = false;
      if (current === revision.current) setPending(false);
    }
    if (current === revision.current && item && navigate) {
      openRef.current = false; setOpen(false); onOpen(item);
    }
  };
  const unread = data?.unreadCount;
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><button type="button" className="icon-button notification-bell"
      aria-label={'Уведомления' + (unread !== undefined ? ', непрочитанных: ' + unread : '') + (error ? ', ошибка обновления' : '')}>
      <Bell size={21} aria-hidden="true" />
      {unread !== undefined && unread > 0 && <span className="notification-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      {error && <span className="notification-warning" aria-hidden="true">!</span>}
    </button></DialogTrigger>
    <DialogContent className="notifications-dialog" showCloseButton={false}>
      <DialogHeader className="notifications-heading"><DialogTitle>Уведомления</DialogTitle><DialogDescription>Ваши задания, обращения и решения по допуску.</DialogDescription></DialogHeader>
      <DialogClose asChild><button type="button" className="icon-button notifications-close" aria-label="Закрыть уведомления"><X size={21} /></button></DialogClose>
      <div className="notifications-toolbar">
        <span>{unread === undefined ? 'Загружаем уведомления…' : 'Непрочитанных: ' + unread}</span>
        <div><button type="button" className="button outline" disabled={loading || pending} onClick={() => void load()} aria-label="Обновить уведомления"><RefreshCw size={16} aria-hidden="true" /></button>
          <button type="button" className="button outline" disabled={loading || pending || !unread} onClick={() => void mark()}><CheckCheck size={16} aria-hidden="true" />Прочитать все</button></div>
      </div>
      {error && <div className="notifications-error" role="alert"><p>{error}</p><button type="button" className="button outline" disabled={loading || pending} onClick={() => void load()}>Повторить</button></div>}
      {loading && <p className="notifications-loading" role="status"><Loader2 size={18} className="spin" aria-hidden="true" />Обновляем уведомления…</p>}
      <div className="notifications-scroll">
        {data && !data.items.length && !loading && !error ? <div className="notifications-empty"><Bell size={30} aria-hidden="true" /><h3>Уведомлений пока нет</h3><p>Здесь появятся новые задания, напоминания о сроках и ответы руководства.</p></div> : null}
        {data && data.items.length > 0 && <ul className="notifications-list">{data.items.map(item => {
          const Icon = icons[item.kind] || Bell;
          return <li className={item.read ? 'is-read' : 'is-unread'} key={item.id}>
            <button type="button" className="notification-open" disabled={pending} onClick={() => item.read ? (changeOpen(false), onOpen(item)) : void mark(item, true)}>
              <Icon size={21} className="notification-kind" aria-hidden="true" /><span className="notification-body"><strong>{item.title}</strong><span>{item.summary}</span><time dateTime={item.createdAt}>{formatSiteDate(item.createdAt)}</time></span>
            </button>
            <div className="notification-state"><span>{item.read ? 'Прочитано' : 'Новое'}</span>{!item.read && <button type="button" className="text-button" disabled={pending} aria-label={'Отметить прочитанным: ' + item.title + ' — ' + item.summary} onClick={() => void mark(item)}><Check size={14} aria-hidden="true" />Прочитано</button>}</div>
          </li>;
        })}</ul>}
        {data?.nextCursor && <button type="button" className="button outline notifications-more" disabled={loading || pending} onClick={() => void load(true)}>Показать ещё</button>}
      </div>
    </DialogContent>
  </Dialog>;
}

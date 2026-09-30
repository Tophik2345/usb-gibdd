import { useState } from 'react';
import { CheckCheck, Users } from 'lucide-react';
import { portalApi, type Announcement } from '@/lib/portal-api';
import { formatSiteDate } from '@/lib/date-time';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
type Readers={title:string;version:number;readers:{login:string;readAt:string|null}[]};
export default function AnnouncementAck({item,signedIn,canManage,onSaved}:{item:Announcement;signedIn:boolean;canManage:boolean;onSaved:()=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[report,setReport]=useState<Readers|null>(null),[onlyPending,setOnlyPending]=useState(false);
  const act=async(reports=false)=>{setBusy(true);setError('');try{if(reports)setReport(await portalApi({op:'announcementReaders',id:item.id}));else{await portalApi({action:'ackAnnouncement',id:item.id,version:item.version});onSaved();}}catch(e:any){setError(e.message);}finally{setBusy(false);}};
  if(!item.requiresAck||!item.published)return null;
  return <div className="announcement-ack"><div className="announcement-ack-actions">{signedIn?<button className={'button '+(item.readAt?'outline':'primary')} disabled={busy||!!item.readAt} onClick={()=>act()}><CheckCheck size={17}/>{item.readAt?'Ознакомлен':'Подтвердить ознакомление'}</button>:<a className="button outline" href="#account">Войти и подтвердить ознакомление</a>}{canManage&&<button className="button outline" disabled={busy} onClick={()=>act(true)}><Users size={17}/>Кто ознакомлен</button>}</div><small>{item.readAt?`Подтверждено: ${formatSiteDate(item.readAt)}`:`Требуется ознакомление · версия ${item.version}`}</small>{error&&<p className="inline-error" role="alert">{error}</p>}
    <Dialog open={!!report} onOpenChange={v=>{if(!v)setReport(null);}}><DialogContent className="portal-editor"><DialogHeader><DialogTitle>Ознакомление сотрудников</DialogTitle><DialogDescription>{report?.title} · версия {report?.version}</DialogDescription></DialogHeader>{report&&<><p>{report.readers.filter(r=>r.readAt).length} из {report.readers.length} подтверждённых аккаунтов ознакомлены.</p><label className="portal-checkbox"><input type="checkbox" checked={onlyPending} onChange={e=>setOnlyPending(e.target.checked)}/>Только неознакомленные</label><div className="ack-readers">{report.readers.filter(r=>!onlyPending||!r.readAt).map(r=><div key={r.login}><strong>{r.login}</strong><span>{r.readAt?formatSiteDate(r.readAt):'Ожидается ознакомление'}</span></div>)}</div></>}</DialogContent></Dialog>
  </div>;
}

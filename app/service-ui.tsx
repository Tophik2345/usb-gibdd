import type {ReactNode} from 'react';
import {Loader2,RefreshCw} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import './service-tools.css';
export function ServiceHeading({title,description,actions}:{title:string;description:string;actions?:ReactNode}) {
 return <div className="portal-heading service-heading"><div><h2>{title}</h2><p className="portal-note">{description}</p></div><div className="portal-actions">{actions}</div></div>;
}
export function ServiceLoad({loading,error,refresh}:{loading:boolean;error:string;refresh:()=>void}) {
 return error?<p className="inline-error" role="alert">{error} <button type="button" className="button outline" onClick={refresh}>Повторить</button></p>:loading?<p className="portal-loading" role="status"><Loader2 size={18} className="spin"/>Загружаем данные…</p>:null;
}
export function ServiceRefresh({refresh,busy=false}:{refresh:()=>void;busy?:boolean}) {return <button type="button" className="button outline" disabled={busy} onClick={refresh}><RefreshCw size={16}/>Обновить</button>;}
export function ServiceDialog({title,description,children,busy,onClose}:{title:string;description:string;children:ReactNode;busy:boolean;onClose:()=>void}) {
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="service-dialog" onEscapeKeyDown={e=>{if(busy)e.preventDefault();}}><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>{children}</DialogContent></Dialog>;
}
export function ServicePagination({offset,total,onChange}:{offset:number;total:number;onChange:(value:number)=>void}) {return total>20?<div className="appeal-pagination"><button type="button" className="button outline" disabled={!offset} onClick={()=>onChange(Math.max(0,offset-20))}>Назад</button><span>{offset+1}–{Math.min(offset+20,total)} из {total}</span><button type="button" className="button outline" disabled={offset+20>=total} onClick={()=>onChange(offset+20)}>Далее</button></div>:null;}
export function MemberSelect({members,value,onChange,label='Ответственный сотрудник'}:{members:{id:string;name:string}[];value:string;onChange:(value:string)=>void;label?:string}) {
 return <label className="field">{label}<select aria-label={label} required value={value} onChange={e=>onChange(e.target.value)}><option value="">Выберите сотрудника</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>;
}
export function ServiceFormError({message}:{message:string}) {return message?<p className="inline-error" role="alert">{message}</p>:null;}

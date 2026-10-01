import { useState } from 'react';
import { History } from 'lucide-react';
import { useTraining } from '@/lib/training-api';
import { formatSiteDate } from '@/lib/date-time';
import { TrainingLoad } from './training-center';
type Event={id:string;createdAt:string;actor:string;area:string;operation:string;title:string;details:{published?:boolean;version?:number;questionsChanged?:boolean;previousRole?:string;role?:string;employee?:string;dueAt?:string;cancelled?:boolean;status?:string;note?:string;previousRank?:string;rank?:string;actorRank?:string}};
const areas:Record<string,string>={tests:'Тесты',test_creators:'Права доступа',assignments:'Назначения тестов',announcements:'Объявления',service_clearances:'Допуски к службе',training_program:'Программа подготовки',department_members:'Звания сотрудников'};
const roles:Record<string,string>={owner:'Владелец',deputy:'Заместитель',author:'Автор'};
const statuses:Record<string,string>={pending:'Заявка подана',approved:'Допуск подтверждён',rejected:'Возвращено на доработку',revoked:'Допуск отозван'};
function describe(e:Event){const d=e.details;return [d.published!==undefined?(d.published?'Опубликовано':'Черновик'):null,d.role?`Роль: ${roles[d.role]||d.role}`:e.area==='test_creators'&&e.operation==='delete'?'Доступ отозван':null,d.employee?`Сотрудник: ${d.employee}`:null,d.dueAt?`Срок: ${formatSiteDate(d.dueAt)}`:null,d.cancelled?'Назначение отменено':null,d.status?statuses[d.status]||d.status:null,d.note,d.rank?`${d.previousRank} → ${d.rank}`:null,d.actorRank?`Звание повысившего: ${d.actorRank}`:null,d.version?`Версия ${d.version}`:null].filter(Boolean).join(' · ');}
export default function AuditLog(){
  const [area,setArea]=useState(''),[pages,setPages]=useState<(string|null)[]>([null]);
  const query=useTraining<{events:Event[]}>({op:'audit',area,before:pages.at(-1)});
  const events=query.data?.events||[];
  return <><div className="training-section-heading"><div><h2>Журнал действий</h2><p>Изменения записываются с момента включения журнала. Редактировать записи на сайте нельзя.</p></div><History size={28}/></div><label className="field audit-filter">Раздел<select aria-label="Раздел" value={area} onChange={e=>{setArea(e.target.value);setPages([null]);}}><option value="">Все действия</option>{Object.entries(areas).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
    {query.loading||!query.data?<TrainingLoad error={query.error} refresh={query.refresh}/>:<><div className="audit-list">{events.map(e=><article key={e.id} className="training-panel audit-event"><div><span className="badge">{areas[e.area]||e.area}</span><time>{formatSiteDate(e.createdAt)}</time></div><h3>{e.title}</h3><p><strong>{e.actor}</strong> · {e.operation==='insert'?'Создание':e.operation==='delete'?'Удаление':'Изменение'}</p><small>{describe(e)}</small></article>)}{!events.length&&<p className="training-panel">Записей в этом разделе пока нет.</p>}</div><div className="training-pagination"><button className="button outline" disabled={pages.length===1} onClick={()=>setPages(p=>p.slice(0,-1))}>Назад</button><span>Страница {pages.length}</span><button className="button outline" disabled={events.length<50} onClick={()=>setPages(p=>[...p,events.at(-1)!.id])}>Далее</button></div></>}
  </>;
}

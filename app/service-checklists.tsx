import {useState} from 'react';
import {ClipboardCheck,RotateCcw} from 'lucide-react';
import {serviceApi,type ChecklistProgress} from '@/lib/service-api';
import definitions from '@/lib/service-checklists.json';
import {errorMessage} from '@/lib/department-api';
import {formatSiteDate} from '@/lib/date-time';
import {useServiceData} from './use-service-data';
import CurrentNorm from './current-norm';
import {ServiceHeading,ServiceLoad,ServiceRefresh,ServiceFormError} from './service-ui';
export default function ServiceChecklists() {
 const [id,setId]=useState(definitions[0].id);const def=definitions.find(item=>item.id===id)!;
 return <div className="service-tools"><ServiceHeading title="Пошаговые чек-листы" description="Проверяйте последовательность действий и открывайте действующие статьи. Отметки сохраняются только в вашем аккаунте."/><nav className="service-checklist-tabs" aria-label="Выбор чек-листа">{definitions.map(item=><button type="button" className="button outline" aria-pressed={item.id===id} key={item.id} onClick={()=>setId(item.id)}><ClipboardCheck size={17}/>{item.title}</button>)}</nav><Checklist key={id} definition={def}/></div>;
}
function Checklist({definition}:{definition:typeof definitions[number]}) {
 const {data,loading,error,refresh}=useServiceData<ChecklistProgress>({action:'checklist',id:definition.id});
 const [saved,setSaved]=useState<ChecklistProgress|null>(null),[busy,setBusy]=useState(false),[saveError,setSaveError]=useState('');const progress=saved||data;
 const save=async(checked:string[])=>{if(!progress||busy)return;const previous=progress;setSaved({...progress,checked});setBusy(true);setSaveError('');try{setSaved(await serviceApi({action:'checklistSave',id:definition.id,version:progress.version,checked}));}catch(e){setSaved(previous);setSaveError(errorMessage(e));}finally{setBusy(false);}};
 const reload=()=>{setSaved(null);refresh();};
 return <section className="service-checklist"><div className="portal-heading"><div><h3>{definition.title}</h3><p className="portal-note">{definition.description}</p></div><ServiceRefresh refresh={reload} busy={busy}/></div><p className="portal-note">Памятка помогает проверить порядок действий. Полная действующая норма доступна у каждого пункта.</p><ServiceLoad loading={loading} error={error} refresh={reload}/><ServiceFormError message={saveError}/>{progress&&!loading&&!error&&<><div className="service-checklist-summary" role="status">Отмечено {progress.checked.length} из {definition.steps.length}{busy?' · сохраняем…':progress.updatedAt?' · сохранено '+formatSiteDate(progress.updatedAt):''}</div><ol className="service-checklist-steps">{definition.steps.map((step,index)=><li key={step.id} className={progress.checked.includes(step.id)?'is-done':''}><label><input type="checkbox" disabled={busy} checked={progress.checked.includes(step.id)} onChange={e=>void save(e.target.checked?[...progress.checked,step.id]:progress.checked.filter(id=>id!==step.id))}/><span><strong>{index+1}. {step.title}</strong><small>{step.hint}</small></span></label><CurrentNorm href={`#laws?document=${step.document}&article=${step.article}`} showTestContext={false}/></li>)}</ol><button type="button" className="button outline" disabled={busy||!progress.checked.length} onClick={()=>void save([])}><RotateCcw size={17}/>Начать заново</button></>}</section>;
}

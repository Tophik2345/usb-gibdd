import {useServiceData} from './use-service-data';
import type {ServiceContext} from '@/lib/service-api';
import {ServiceLoad} from './service-ui';
import ServiceMap from './service-map';
import ServiceCases from './service-cases';
import ServiceShifts from './service-shifts';
import GalleryManagement from './gallery-management';
export default function ServiceSection({tab,caseId}:{tab:'map'|'cases'|'shifts'|'gallery';caseId:string|null}) {
 const {data,loading,error,refresh}=useServiceData<ServiceContext>({action:'context'});
 if(loading||error)return <ServiceLoad loading={loading} error={error} refresh={refresh}/>;
 if(!data)return null;
 if(tab==='gallery')return data.canManage?<GalleryManagement/>:<div className="department-empty"><h2>Публикация фотографий доступна руководству</h2><p>Опубликованные кадры можно посмотреть в галерее главной страницы.</p><a className="button outline" href="#home">Открыть галерею</a></div>;
 if(!data.isMember&&!data.canManage)return <div className="department-empty"><h2>Раздел доступен действующему составу</h2><p>Попросите руководство добавить ваш профиль в состав подразделения.</p></div>;
 return tab==='map'?<ServiceMap canManage={data.canManage}/>:tab==='cases'?<ServiceCases context={data} caseId={caseId}/>:<ServiceShifts context={data}/>;
}

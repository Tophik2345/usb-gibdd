import EmployeeGuide from './employee-guide';
import LawsSection from './laws-section';
import UsefulLinks from './useful-links';
import DepartmentSection from './department-section';
import type { SitePage } from './site-header';
export default function InformationSection({page,signedIn,canManageContent,displayName=''}:{page:SitePage;signedIn:boolean;canManageContent:boolean;displayName?:string}) {
  if(page==='department')return <DepartmentSection signedIn={signedIn} canManage={canManageContent} displayName={displayName}/>;
  if(page==='new-employees'||page==='duties')return <EmployeeGuide kind={page}/>;
  if(page==='laws')return <LawsSection signedIn={signedIn}/>;
  if(page==='links')return <UsefulLinks canManage={canManageContent}/>;
  return null;
}

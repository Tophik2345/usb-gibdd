import EmployeeGuide from './employee-guide';
import LawsSection from './laws-section';
import UsefulLinks from './useful-links';
import type { SitePage } from './site-header';
export default function InformationSection({page,signedIn,canManageContent}:{page:SitePage;signedIn:boolean;canManageContent:boolean}) {
  if(page==='new-employees'||page==='duties')return <EmployeeGuide kind={page}/>;
  if(page==='laws')return <LawsSection signedIn={signedIn}/>;
  if(page==='links')return <UsefulLinks canManage={canManageContent}/>;
  return null;
}

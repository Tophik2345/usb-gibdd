import EmployeeGuide from './employee-guide';
import LawsSection from './laws-section';
import { BookOpen, Scale, ShieldCheck, Link } from 'lucide-react';
import { siteSections, type SitePage } from './site-header';

const sections = {
  laws: { icon: Scale, description: 'Законы и нормативные материалы игрового проекта «Россия Онлайн».', empty: 'Документы пока не добавлены.' },
  'new-employees': { icon: BookOpen, description: 'Материалы для знакомства с работой подразделения.', empty: 'Памятка для новых сотрудников пока не опубликована.' },
  duties: { icon: ShieldCheck, description: 'Служебные обязанности и порядок работы сотрудников УСБ.', empty: 'Регламент обязанностей пока не опубликован.' },
  links: { icon: Link, description: 'Ресурсы и каналы связи подразделения.', empty: 'Полезные ссылки пока не добавлены.' },
};



export default function InformationSection({page}:{page:SitePage}) {
  if (page==='new-employees'||page==='duties') return <EmployeeGuide kind={page}/>;
  if (page==='laws') return <LawsSection/>;
  if (!(page in sections)) return null;
  const section=sections[page as keyof typeof sections]; const Icon=section.icon;
  return <section className="information-section" aria-labelledby="information-title">
    <div className="eyebrow">УСБ ГИБДД · РОССИЯ ОНЛАЙН</div>
    <h1 id="information-title">{siteSections.find(item=>item.id===page)?.title}</h1>
    <p className="information-description">{section.description}</p>
    <div className="information-empty"><Icon size={32} strokeWidth={1.5}/><h2>{section.empty}</h2></div>
  </section>;
}

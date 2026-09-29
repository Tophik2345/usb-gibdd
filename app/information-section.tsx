import { BookOpen, Scale, ShieldCheck, Link } from 'lucide-react';
import { siteSections, type SitePage } from './site-header';

const sections = {
  laws: { icon: Scale, description: 'Законы и нормативные материалы игрового проекта «Россия Онлайн».', empty: 'Документы пока не добавлены.' },
  'new-employees': { icon: BookOpen, description: 'Материалы для знакомства с работой подразделения.', empty: 'Памятка для новых сотрудников пока не опубликована.' },
  duties: { icon: ShieldCheck, description: 'Служебные обязанности и порядок работы сотрудников УСБ.', empty: 'Регламент обязанностей пока не опубликован.' },
  links: { icon: Link, description: 'Ресурсы и каналы связи подразделения.', empty: 'Полезные ссылки пока не добавлены.' },
};

const lawDocuments = [
  {title:'Устав ГИБДД',url:'https://forum.russia.online/threads/vnutrennii-ustav-gibdd.5291/'},
  {title:'Уголовный кодекс РО',url:'https://forum.russia.online/threads/ugolovnyi-kodeks-ro.4805/'},
  {title:'Трудовой кодекс РО',url:'https://forum.russia.online/threads/trudovoi-kodeks-ro.4943/'},
];

export default function InformationSection({page}:{page:SitePage}) {
  if (!(page in sections)) return null;
  const section=sections[page as keyof typeof sections]; const Icon=section.icon;
  return <section className="information-section" aria-labelledby="information-title">
    <div className="eyebrow">УСБ ГИБДД · РОССИЯ ОНЛАЙН</div>
    <h1 id="information-title">{siteSections.find(item=>item.id===page)?.title}</h1>
    <p className="information-description">{section.description}</p>
    {page==='laws'?<div className="law-documents">{lawDocuments.map((document,index)=><article className="law-document" key={document.url}><span className="eyebrow">ДОКУМЕНТ {String(index+1).padStart(2,'0')}</span><h2>{document.title}</h2><a className="button outline" href={document.url} target="_blank" rel="noopener noreferrer"><BookOpen size={18}/>Открыть на форуме РО<span className="sr-only"> (в новой вкладке)</span></a></article>)}</div>:<div className="information-empty"><Icon size={32} strokeWidth={1.5}/><h2>{section.empty}</h2></div>}
  </section>;
}

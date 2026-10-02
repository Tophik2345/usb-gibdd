import { siteSections } from './site-header';
import './section-links.css';

type SectionPage = typeof siteSections[number]['id'];
type SectionLink = { label: string; href: string; external?: boolean; title?: string };

const department: SectionLink = { label: 'УСБ ГИБДД', href: '#department?tab=staff', title: 'Состав подразделения УСБ' };
const forum: SectionLink = { label: 'РОССИЯ ОНЛАЙН', href: 'https://forum.russia.online/', external: true, title: 'Форум «Россия Онлайн» — в новой вкладке' };
const sections: Record<SectionPage, readonly [SectionLink, SectionLink]> = {
  home: [forum, department],
  training: [department, { label: 'ПОДГОТОВКА К СЛУЖБЕ', href: '#training?tab=admission' }],
  laws: [forum, { label: 'ЗАКОНЫ И ПДД', href: '#laws' }],
  tests: [department, { label: 'ПРОВЕРКА ЗНАНИЙ', href: '#tests' }],
  'new-employees': [department, { label: 'ПАМЯТКА НОВИЧКА', href: '#new-employees' }],
  duties: [department, { label: 'СЛУЖЕБНЫЕ ОБЯЗАННОСТИ', href: '#duties' }],
  department: [forum, { label: 'ПОДРАЗДЕЛЕНИЕ УСБ', href: department.href, title: department.title }],
  links: [department, { label: 'ПОЛЕЗНЫЕ ССЫЛКИ', href: '#links' }],
};

export default function SectionLinks({ section }: { section: SectionPage }) {
  return <nav className="eyebrow section-links" aria-label="Связанные разделы">
    {sections[section].map((link, index) => <span className="section-links-item" key={link.href}>
      {index > 0 && <span className="section-links-separator" aria-hidden="true">·</span>}
      <a href={link.href} title={link.title} target={link.external ? '_blank' : undefined} rel={link.external ? 'noopener noreferrer' : undefined}>{link.label}</a>
    </span>)}
  </nav>;
}

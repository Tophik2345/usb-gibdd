import type { ReactNode } from 'react';
import WorkGallery from './work-gallery';
import { ArrowUpRight, BookOpen, ClipboardCheck, GraduationCap } from 'lucide-react';
import { departmentTabs, departmentLink } from './department-section';
import SectionLinks from './section-links';
import gibddCharacter from './assets/gibdd-character.webp';
import './home-introduction.css';
export default function HomeIntroduction({children}:{children?:ReactNode}) {
  return <section className="home-introduction" aria-labelledby="home-welcome">
    <div className="home-hero"><div className="hero-content"><SectionLinks section="home"/><h1 id="home-welcome">Приветствую вас на сайте <span>УСБ ГибДД</span></h1><p>Знания. Дисциплина. Доверие.</p><div className="hero-actions"><a className="button primary" href="#training">Перейти к подготовке <ArrowUpRight size={18}/></a><a className="button outline" href="#laws">Законы РО</a></div></div><aside className="hero-visual"><div className="hero-motto"><span>Наш девиз</span><blockquote>«Мы следим за теми,<br/>кто следит за порядком».</blockquote><span className="hero-motto-line"/></div><img className="hero-character" src={gibddCharacter} alt="Персонаж в форме ГИБДД из игрового проекта «Россия Онлайн»." width={568} height={794} decoding="async" /></aside></div>
    <nav className="home-paths" aria-label="Обучение и служба"><a href="#training"><GraduationCap size={25}/><span><strong>Подготовка и допуск</strong><small>Твой путь к самостоятельной службе</small></span><ArrowUpRight size={18}/></a><a href="#tests"><ClipboardCheck size={25}/><span><strong>Проверка знаний</strong><small>Тесты, задания и работа над ошибками</small></span><ArrowUpRight size={18}/></a><a href="#laws"><BookOpen size={25}/><span><strong>Нормативная база</strong><small>Законы, правила и быстрый поиск</small></span><ArrowUpRight size={18}/></a></nav>
    {children}
    <nav className="department-quick-links" aria-label="Сервисы подразделения">{departmentTabs.map(({id,label,description,icon:Icon})=><a key={id} href={departmentLink(id)}><Icon size={24}/><strong>{label}</strong><span>{description}</span></a>)}</nav>
    <WorkGallery />
    <article>
      <h2>Управление собственной безопасности ГИБДД</h2>
      <p>УСБ ГИБДД — структурное подразделение, обеспечивающее законность, дисциплину и защиту репутации службы на сервере «Кутузовский» игрового проекта «Россия Онлайн».</p>
      <h3>Основные задачи:</h3>
      <ul>
        <li>Контроль соблюдения устава и служебной этики сотрудниками ГИБДД.</li>
        <li>Служебные проверки сведений о превышении полномочий, коррупции и нарушениях внутреннего распорядка; передача материалов с признаками преступления компетентному органу.</li>
        <li>Защита сотрудников от провокаций и неправомерных действий со стороны третьих лиц.</li>
        <li>Проведение внутренних проверок и служебных расследований.</li>
      </ul>
      <p><strong>Принципы работы:</strong> беспристрастность, объективность, конфиденциальность.</p>
      <p>Если вы располагаете достоверными сведениями о нарушении, вы можете подать внутреннее обращение руководству УСБ в разделе «Подразделение → Обращения». Оно не заменяет обращение в прокуратуру, суд или к администрации проекта.</p>
    </article>
    <article>
      <h2>УСБ ГИБДД: кто мы и зачем нужны</h2>
      <p>Мы следим за тем, чтобы сотрудники ГИБДД действовали строго по правилам сервера и не нарушали RP-этику.</p>
      <h3>Что мы делаем:</h3>
      <ul>
        <li>Проверяем жалобы на сотрудников ГИБДД: необоснованные штрафы, оскорбления, превышение полномочий.</li>
        <li>Разбираем спорные ситуации и выносим объективное решение.</li>
        <li>Проводим внутренние рейды и скрытые проверки.</li>
        <li>Помогаем поддерживать честный и интересный RP для всех.</li>
      </ul>
      <p><strong>Порядок приёма обращений на сайте:</strong> жалобы подаются из аккаунта с указанием заявителя и ссылками на доказательства: скриншоты, видео или логи. Это внутренние условия приёма обращений подразделением.</p>
    </article>
    <article>
      <h2>УСБ ГИБДД — щит репутации Госавтоинспекции</h2>
      <p>Наша работа не видна большинству, но именно она удерживает систему в равновесии. Основное направление работы УСБ — внутренний контроль и служебные проверки. Все действия сотрудники выполняют в пределах полномочий, установленных законом и уставом.</p>
      <p>В условиях постоянного напряжения и сложных ситуаций легко переступить черту. Наша задача — вовремя заметить это, пресечь и помочь подразделению оставаться профессиональным.</p>
      <p><strong>Мы работаем тихо. Мы работаем точно.</strong></p>
    </article>
  </section>;
}

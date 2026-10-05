import { BookOpen, ClipboardCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { newcomerCards, dutyCards } from '@/lib/employee-guides';
import { roadCards, gameplayCards } from '@/lib/road-guides';
import { useProjectRules } from '@/lib/project-rules';
import SectionLinks from './section-links';
import RuleHistoryPanel from './rule-history';
import ReportError from './report-error';

const newcomerTopics = [
  { label: 'Перед выходом на службу', card: 1 },
  { label: 'Остановка и проверка', card: 4 },
  { label: 'Задержание', card: 6 },
  { label: 'Сила и помощь при ДТП', card: 7 },
  { label: 'Запись и доказательства', card: 9 },
  { label: 'Отчёты и защита прав', card: 12 },
  { label: 'КоАП и ПДД', card: 13 },
  { label: 'Правила проекта', card: 'project-rules' },
  { label: 'Управление в игре', card: 'gameplay' },
];

function openTopic(card: number | string) {
  const target = document.getElementById(`newcomer-card-${card}`);
  if (!target) return;
  target.focus({ preventScroll: true });
  target.scrollIntoView({
    block: 'start',
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
}

export default function EmployeeGuide({ kind, signedIn=false }: { kind: 'new-employees' | 'duties'; signedIn?:boolean }) {
  const newcomer = kind === 'new-employees';
  const cards = newcomer ? [...newcomerCards, ...roadCards] : dutyCards;
  const { rules, cards: projectRuleCards, error: ruleError, source } = useProjectRules();
  useEffect(() => {
    const open = () => {
      const topic = new URLSearchParams(window.location.hash.split('?')[1] || '').get('topic');
      if(topic==='project-rules'){document.getElementById('newcomer-card-project-rules')?.scrollIntoView({block:'start',behavior:'instant'});return;}
      if (!topic || !/^(?:newcomer-card|duties-card|guide-project|guide-gameplay)-\d+$/.test(topic)) return;
      const target = document.getElementById(topic); target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'start', behavior: 'instant' });
    };
    const frame = requestAnimationFrame(open); window.addEventListener('hashchange', open);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('hashchange', open); };
  }, [kind]);

  return (
    <section className="employee-guide">
      <SectionLinks section={kind}/>
      <h1>{newcomer ? 'Для новых сотрудников' : 'Обязанности сотрудников УСБ'}</h1>
      <p className="information-description">
        {newcomer
          ? 'Памятка новичка: от подготовки к первой смене до дорожной проверки, задержания и защиты своих прав.'
          : 'Проверки, работа с материалами и пределы полномочий Управления собственной безопасности.'}
      </p>
      <p className="guide-source-note">
        Сервер «Кутузовский». Учебная памятка обновлена 30.09.2026 по предоставленным документам и проверенным материалам проекта.
        Карточки с законами содержат переходы к полному тексту нормы.
      </p>

      {newcomer && (
        <>
          <aside className="newcomer-reminder" aria-labelledby="newcomer-reminder-title">
            <h2 id="newcomer-reminder-title">Перед любым действием проверь себя</h2>
            <ol>
              <li><strong>Основание</strong><span>Какая норма разрешает это действие в данной ситуации?</span></li>
              <li><strong>Полномочия</strong><span>Вправе ли я выполнять его с учётом своей подготовки и должности?</span></li>
              <li><strong>Порядок</strong><span>Какие права, этапы и требования к записи нужно соблюсти?</span></li>
            </ol>
          </aside>
          <nav className="newcomer-topics" aria-label="Быстрый переход по памятке">
            <span>Быстрый переход</span>
            <div>{newcomerTopics.map(topic => (
              <button type="button" key={topic.card} onClick={() => openTopic(topic.card)}>
                {topic.label}
              </button>
            ))}</div>
          </nav>
        </>
      )}

      <div className="employee-guide-grid">
        {cards.map((card, index) => (
          <article
            className="employee-guide-card"
            key={card.title}
            id={`${newcomer ? 'newcomer' : 'duties'}-card-${index + 1}`}
            tabIndex={-1}
          >
            <h2>{card.title}</h2>
            <ul>{card.items.map(item => <li key={item}>{item}</li>)}</ul>
            <div className="guide-references">
              {card.sources.map(source => (
                <a key={source.label} href={`#laws?document=${source.document}&article=${source.article}`}>
                  <BookOpen size={15} />{source.label}
                </a>
              ))}
            </div>
          </article>
        ))}
      </div>

      <section className="guide-supplement" id="newcomer-card-project-rules" tabIndex={-1} aria-labelledby="project-rules-title">
        <h2 id="project-rules-title">Правила проекта для госслужащих</h2>
        <p className="guide-source-note">Проверка обновлений на официальном форуме — каждые 6 часов. Последняя успешная проверка: {new Date(source.checkedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Kiev' })}. <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">Открыть источник</a>.</p>
        {ruleError && <p className="guide-source-note" role="status">{ruleError}</p>}
        <div className="employee-guide-grid">{projectRuleCards.map((card,index)=><article className="employee-guide-card" key={card.title} id={`guide-project-${index + 1}`} tabIndex={-1}><h3>{card.title}</h3><ul>{card.items.map(item=><li key={item}>{item}</li>)}</ul><p className="guide-source-note">{card.reference}</p></article>)}</div>
        {rules && <details className="law-edition-notes"><summary>Все правила госорганизаций · {rules.points.length} пунктов</summary><div className="law-article-body">{rules.lines.map((line, index) => <p key={index}>{line}</p>)}<div className="norm-picker"><p>Нашли неточность? Выберите пункт для сообщения.</p><ProjectRuleReport rules={rules} signedIn={signedIn}/></div></div></details>}
        <RuleHistoryPanel document="state-organizations"/>
      </section>
      {newcomer&&<section className="guide-supplement" id="newcomer-card-gameplay" tabIndex={-1} aria-labelledby="gameplay-title">
        <h2 id="gameplay-title">Практика в игре</h2>
        <p className="guide-source-note">Общие механики ГИБДД из вики проекта. Если назначение клавиш изменено, проверь настройки своего клиента.</p>
        <div className="employee-guide-grid">{gameplayCards.map((card,index)=><article className="employee-guide-card" key={card.title} id={`guide-gameplay-${index + 1}`} tabIndex={-1}><h3>{card.title}</h3><ul>{card.items.map(item=><li key={item}>{item}</li>)}</ul></article>)}</div>
      </section>}

      <div className="guide-test-cta">
        <div>
          <h2>Проверь себя</h2>
          <p>
            {newcomer
              ? 'Начни с теста «Начальная подготовка сотрудника ГИБДД». Затем пройди тесты по уставу, УК и «КоАП и ПДД — практические ситуации».'
              : 'Пройди тест «УСБ: полномочия и ответственность».'}
            {' '}После завершения доступны пояснения и переходы к статьям.
          </p>
        </div>
        <a href="#tests" className="button primary"><ClipboardCheck size={18} />Перейти к тестам</a>
      </div>
    </section>
  );
}
function ProjectRuleReport({rules,signedIn}:{rules:import('@/lib/project-rules').ProjectRules;signedIn:boolean}){
  const [number,setNumber]=useState(rules.points[0]?.number||'');
  return <><label className="field">Пункт правил<select value={number} onChange={event=>setNumber(event.target.value)}>{rules.points.map(point=><option value={point.number} key={point.number}>Пункт {point.number}</option>)}</select></label>{number&&<ReportError key={number} signedIn={signedIn} target={{kind:'law',document:'state-organizations',article:'point-'+number,label:'Правила госорганизаций · пункт '+number}}/>}</>;
}

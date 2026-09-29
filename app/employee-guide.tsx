import { BookOpen, ClipboardCheck } from 'lucide-react';
import { newcomerCards, dutyCards } from '@/lib/employee-guides';

const newcomerTopics = [
  { label: 'Перед выходом на службу', card: 1 },
  { label: 'Остановка и проверка', card: 4 },
  { label: 'Задержание', card: 6 },
  { label: 'Сила и помощь при ДТП', card: 7 },
  { label: 'Запись и доказательства', card: 9 },
  { label: 'Отчёты и защита прав', card: 12 },
];

function openTopic(card: number) {
  const target = document.getElementById(`newcomer-card-${card}`);
  if (!target) return;
  target.focus({ preventScroll: true });
  target.scrollIntoView({
    block: 'start',
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
}

export default function EmployeeGuide({ kind }: { kind: 'new-employees' | 'duties' }) {
  const newcomer = kind === 'new-employees';
  const cards = newcomer ? newcomerCards : dutyCards;

  return (
    <section className="employee-guide">
      <div className="eyebrow">УСБ ГИБДД · ПОДГОТОВКА СОТРУДНИКОВ</div>
      <h1>{newcomer ? 'Для новых сотрудников' : 'Обязанности сотрудников УСБ'}</h1>
      <p className="information-description">
        {newcomer
          ? 'Памятка новичка: от подготовки к первой смене до дорожной проверки, задержания и защиты своих прав.'
          : 'Проверки, работа с материалами и пределы полномочий Управления собственной безопасности.'}
      </p>
      <p className="guide-source-note">
        Памятка по документам игрового проекта «Россия Онлайн», предоставленным 29.09.2026.
        В каждой карточке можно открыть полный текст нормы.
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
            id={newcomer ? `newcomer-card-${index + 1}` : undefined}
            tabIndex={newcomer ? -1 : undefined}
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

      <div className="guide-test-cta">
        <div>
          <h2>Проверь себя</h2>
          <p>
            {newcomer
              ? 'Начни с теста «Начальная подготовка сотрудника ГИБДД». Затем пройди тесты по уставу и правилам ГИБДД и по Уголовному кодексу РО.'
              : 'Пройди тест «УСБ: полномочия и ответственность».'}
            {' '}После завершения доступны пояснения и переходы к статьям.
          </p>
        </div>
        <a href="#tests" className="button primary"><ClipboardCheck size={18} />Перейти к тестам</a>
      </div>
    </section>
  );
}

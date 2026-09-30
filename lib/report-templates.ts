export const reportKinds = {
  check: { label: 'Служебная проверка', title: 'РАПОРТ О ПРОВЕДЕНИИ СЛУЖЕБНОЙ ПРОВЕРКИ', description: 'Основание, обстоятельства, доказательства и выводы.' },
  event: { label: 'Служебное мероприятие', title: 'ОТЧЁТ О СЛУЖЕБНОМ МЕРОПРИЯТИИ', description: 'Цель, участники, ход мероприятия и результат.' },
  shift: { label: 'Отчёт за смену', title: 'ОТЧЁТ О СЛУЖЕБНОЙ СМЕНЕ', description: 'Выполненные задачи, происшествия и передача дел.' },
} as const;
export type ReportKind = keyof typeof reportKinds;
export type ReportDraft = { author: string; recipient: string; date: string; period: string; place: string; basis: string; participants: string; actions: string; findings: string; evidence: string; conclusion: string };
export function buildReport(kind: ReportKind, draft: ReportDraft) {
  const value = (field: keyof ReportDraft, placeholder: string) => draft[field].trim() || `[${placeholder}]`;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(draft.date) ? draft.date.split('-').reverse().join('.') : '[дата]';
  const labels = kind === 'check' ? ['Основание проверки', 'Обстоятельства и установленные факты', 'Выводы и предложения']
    : kind === 'event' ? ['Цель и основание мероприятия', 'Результаты мероприятия', 'Итоги и предложения']
    : ['Задачи на смену', 'Результаты и происшествия', 'Передача дел и замечания'];
  return `Кому: ${value('recipient', 'должность и имя адресата')}\nОт: ${value('author', 'Имя Фамилия Статик')}\nПодразделение: УСБ ГИБДД · Россия Онлайн\n\n${reportKinds[kind].title}\n\nДата: ${date}\nВремя / период (МСК): ${value('period', 'время по МСК')}\nМесто: ${value('place', 'место')}\n\n1. ${labels[0]}\n${value('basis', 'укажите основание или задачи')}\n\n2. Участники\n${value('participants', 'перечислите участников и статики')}\n\n3. Выполненные действия\n${value('actions', 'опишите действия по порядку')}\n\n4. ${labels[1]}\n${value('findings', 'изложите подтверждённые факты')}\n\n5. Материалы и доказательства\n${value('evidence', 'ссылки на скриншоты, видео, логи или отметка об их отсутствии')}\n\n6. ${labels[2]}\n${value('conclusion', 'сформулируйте выводы')}\n\nПодпись: ${value('author', 'Имя Фамилия Статик')}\nДата: ${date}`;
}

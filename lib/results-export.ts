import type { Attempt } from './types';
import { formatSiteDate } from './date-time';
export function resultPassed(row: Attempt) { return row.score !== null && row.total > 0 && row.score * 100 >= row.total * row.passMark; }
export function resultStatus(row: Attempt) { return row.mode === 'practice' ? (resultPassed(row) ? 'Без ошибок' : 'Есть ошибки') : (resultPassed(row) ? 'Зачёт' : 'Не зачтено'); }
function cell(value: string | number) {
  let text = String(value);
  // Spreadsheet programs may execute formula-looking user names and test titles.
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function resultsCsv(rows: Attempt[]) {
  const header = ['Сотрудник','Тест','Дата завершения (МСК)','Верно','Всего','Результат, %','Проходной балл, %','Статус','Вид попытки','Ограничение времени','ID результата'];
  const lines = rows.filter(row => row.finishedAt && row.score !== null).map(row => [
    row.employeeName, row.testTitle, formatSiteDate(row.finishedAt!), row.score!, row.total,
    (row.score! * 100 / row.total).toFixed(1).replace('.', ','), row.passMark, resultStatus(row),
    row.mode === 'practice' ? 'Работа над ошибками' : row.assignmentId ? (row.assignmentCancelled ? 'Отменённое назначение' : 'По назначению') : row.demo ? 'Демонстрация' : 'Проверка',
    row.timedOut ? 'Время истекло' : '', row.id,
  ]);
  return '\uFEFF' + [header, ...lines].map(line => line.map(cell).join(';')).join('\r\n') + '\r\n';
}

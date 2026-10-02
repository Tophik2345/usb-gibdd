/** Calendar arithmetic uses UTC wall dates, so device daylight-saving time cannot shift a day. */
export function calendarDays(month: string): string[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Некорректный месяц.');
  const first = new Date(month + '-01T00:00:00Z');
  const start = first.getTime() - ((first.getUTCDay() + 6) % 7) * 86400000;
  return Array.from({ length: 42 }, (_, index) => new Date(start + index * 86400000).toISOString().slice(0, 10));
}
export function shiftMonth(month: string, delta: number): string {
  const first = new Date(month + '-01T00:00:00Z');
  first.setUTCMonth(first.getUTCMonth() + delta);
  return first.toISOString().slice(0, 7);
}

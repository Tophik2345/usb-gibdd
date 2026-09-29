/** All service dates use Moscow time, independently of the visitor's device. */
export const SITE_TIME_ZONE = 'Europe/Moscow';
export const SITE_TIME_LABEL = 'Московское время · МСК (UTC+3)';

const inputFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SITE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function toSiteDateTimeInput(value: string | number | Date): string {
  const parts = Object.fromEntries(inputFormatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** A datetime-local field has no offset: interpret its wall time in Moscow. */
export function fromSiteDateTimeInput(value: string): string {
  const invalid = () => new Error('Укажите корректную дату и время по МСК.');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw invalid();
  const wallTime = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(wallTime)) throw invalid();
  const moscowWallTime = Date.parse(`${toSiteDateTimeInput(wallTime)}:00Z`);
  const instant = wallTime - (moscowWallTime - wallTime);
  // Round-trip validation rejects nonexistent dates and normalized overflows.
  if (toSiteDateTimeInput(instant) !== value) throw invalid();
  return new Date(instant).toISOString();
}

export function formatSiteDate(value: string, options: Intl.DateTimeFormatOptions = {}): string {
  return `${new Date(value).toLocaleString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    ...options, timeZone: SITE_TIME_ZONE,
  })} МСК`;
}

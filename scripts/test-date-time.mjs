import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

if (!process.argv.includes('--worker')) {
  for (const timezone of ['UTC', 'Europe/Kyiv', 'America/Los_Angeles', 'Asia/Vladivostok']) {
    execFileSync(process.execPath, [new URL(import.meta.url).pathname, '--worker'], {
      env: { ...process.env, TZ: timezone }, stdio: 'inherit',
    });
  }
} else {
  const source = fs.readFileSync(new URL('../lib/date-time.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const { fromSiteDateTimeInput, toSiteDateTimeInput, formatSiteDate } = await import(
    'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
  );
  // The deadline from the user's screenshot, plus midnight/year/leap-day boundaries.
  for (const [input, utc] of [
    ['2026-10-01T01:46', '2026-09-30T22:46:00.000Z'],
    ['2026-01-01T00:00', '2025-12-31T21:00:00.000Z'],
    ['2028-02-29T23:59', '2028-02-29T20:59:00.000Z'],
    ['2026-12-25T18:30', '2026-12-25T15:30:00.000Z'],
  ]) {
    assert.equal(fromSiteDateTimeInput(input), utc);
    assert.equal(toSiteDateTimeInput(utc), input);
    assert.match(formatSiteDate(utc), new RegExp(input.slice(-5) + ' МСК$'));
  }
  // Kyiv's winter offset and a US DST change must not change Moscow deadlines.
  assert.equal(fromSiteDateTimeInput('2026-11-01T02:30'), '2026-10-31T23:30:00.000Z');
  assert.equal(formatSiteDate('2026-09-30T22:46:00Z'), '1 октября 2026 г. в 01:46 МСК');
  for (const invalid of ['', '2026-02-29T12:00', '2026-04-31T12:00', '2026-13-01T00:00', '2026-10-01T24:00', '2026-10-01T01:60', '2026-10-01', '2026-10-01T01:46Z']) {
    assert.throws(() => fromSiteDateTimeInput(invalid), /корректную дату/);
  }
  const calendarJs = ts.transpileModule(fs.readFileSync(new URL('../lib/personal-calendar.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const { calendarDays, shiftMonth } = await import('data:text/javascript;base64,' + Buffer.from(calendarJs).toString('base64'));
  const leap = calendarDays('2028-02');
  assert.equal(leap.length, 42); assert.equal(new Set(leap).size, 42); assert(leap.includes('2028-02-29'));
  assert.equal(new Date(leap[0] + 'T00:00:00Z').getUTCDay(), 1);
  assert(!calendarDays('2026-02').includes('2026-02-29'));
  assert.equal(shiftMonth('2026-12', 1), '2027-01'); assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(toSiteDateTimeInput('2026-09-30T23:30:00Z').slice(0, 10), '2026-10-01');
  assert.throws(() => calendarDays('2026-13'), /Некорректный/);
  console.log(`Moscow date entry, display and validation pass with device TZ=${process.env.TZ}`);
}

/**
 * Official holidays.
 *
 * The source is Google's public "Indian Holidays" calendar, fetched as iCal.
 * It is free and needs no key, but it lists every observance in the country —
 * 58 dated entries for 2026 — where a company closes on perhaps a dozen. So an
 * import writes them all and marks only the nationally gazetted ones (plus the
 * configured state's) as observed; an administrator curates the rest.
 *
 * Re-importing a year is deliberately non-destructive: it inserts anything new
 * and leaves every existing row's `observed` flag exactly as the company set it.
 */
import { query } from '../lib/db.js';
import { badRequest } from '../lib/errors.js';

const ICS_URL =
  'https://calendar.google.com/calendar/ical/en.indian%23holiday%40group.v.calendar.google.com/public/basic.ics';

/**
 * Days a company in Karnataka would normally close. Matched case-insensitively
 * against the source's names, which vary ("Diwali/Deepavali", "Dussehra").
 * Everything else imports unobserved and can be ticked on.
 */
const DEFAULT_OBSERVED = [
  'republic day', 'independence day', 'gandhi jayanti',
  'holi', 'diwali', 'deepavali', 'dussehra', 'vijaya dashami',
  'good friday', 'christmas day',
  'eid', 'ramzan', 'bakrid', 'muharram', 'milad',
  'janmashtami', 'ganesh chaturthi', 'mahavir jayanti', 'buddha purnima',
  'guru nanak', 'ugadi', 'kannada rajyotsava', 'may day', 'labour day',
];

const isDefaultObserved = (name: string) => {
  const n = name.toLowerCase();
  // "Christmas Eve" and "Diwali Holiday (regional)" should not sneak in via a
  // loose match, so require the phrase to stand on a word boundary.
  return DEFAULT_OBSERVED.some((k) => new RegExp(`\\b${k}\\b`, 'i').test(n));
};

export interface ParsedHoliday { date: string; name: string }

/** Minimal iCal reader: all we need is DTSTART;VALUE=DATE and SUMMARY. */
export function parseIcs(ics: string, year: number): ParsedHoliday[] {
  // Unfold RFC 5545 continuation lines before matching.
  const text = ics.replace(/\r\n[ \t]/g, '');
  const out = new Map<string, ParsedHoliday>();

  for (const block of text.split('BEGIN:VEVENT').slice(1)) {
    const d = /DTSTART;VALUE=DATE:(\d{4})(\d{2})(\d{2})/.exec(block);
    const s = /\nSUMMARY:([^\r\n]+)/.exec(block);
    if (!d || !s) continue;
    if (Number(d[1]) !== year) continue;
    const date = `${d[1]}-${d[2]}-${d[3]}`;
    const name = s[1]!.replace(/\\,/g, ',').replace(/\\;/g, ';').trim();
    out.set(`${date}|${name}`, { date, name });
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchHolidays(year: number): Promise<ParsedHoliday[]> {
  let res: Response;
  try {
    res = await fetch(ICS_URL, { signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    throw badRequest(
      'Could not reach the public holiday calendar. Check the server\'s internet access, '
      + 'or add the holidays manually.');
  }
  if (!res.ok) throw badRequest(`The holiday calendar returned ${res.status}.`);
  const holidays = parseIcs(await res.text(), year);
  if (!holidays.length) throw badRequest(`The holiday calendar had no entries for ${year}.`);
  return holidays;
}

export interface ImportResult { year: number; found: number; added: number; observed: number; existing: number }

export async function importYear(year: number, region = 'IN-KA'): Promise<ImportResult> {
  const found = await fetchHolidays(year);

  let added = 0;
  for (const h of found) {
    // ON CONFLICT DO NOTHING: an existing row keeps whatever the company chose.
    const rows = await query<{ id: string }>(
      `INSERT INTO holidays (holiday_date, name, region, source, observed)
       VALUES ($1,$2,$3,'imported',$4)
       ON CONFLICT (holiday_date, name, region) DO NOTHING
       RETURNING id`,
      [h.date, h.name, region, isDefaultObserved(h.name)]);
    if (rows.length) added++;
  }

  const counts = await query<{ observed: number; total: number }>(
    `SELECT COUNT(*) FILTER (WHERE observed)::int AS observed, COUNT(*)::int AS total
       FROM holidays WHERE EXTRACT(YEAR FROM holiday_date) = $1 AND region = $2`,
    [year, region]);

  return {
    year, found: found.length, added,
    observed: counts[0]?.observed ?? 0,
    existing: (counts[0]?.total ?? 0) - added,
  };
}

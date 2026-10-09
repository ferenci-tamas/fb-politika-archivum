// Hungarian date/time formatting and date-range conversions.
//
// posts.time holds true UNIX instants (SQLite-converter.R stored the scrape's UTC
// epoch). Readers expect Hungarian wall-clock times, so we format and filter in the
// Europe/Budapest zone (CET/CEST, DST-aware) via Intl. All functions here are pure.

const HU_TZ = 'Europe/Budapest';

// Date/time fields of a UNIX-seconds instant, in Hungarian local time. Intl zero-pads
// the 2-digit fields; hourCycle 'h23' keeps midnight as 00 (not 24). The en-GB locale
// just guarantees Latin digits — we read fields by type, so ordering is irrelevant.
function huParts(unixSeconds) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: HU_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(new Date(unixSeconds * 1000));
  const g = (type) => parts.find((p) => p.type === type).value;
  return { y: g('year'), m: g('month'), d: g('day'), hh: g('hour'), mm: g('minute') };
}

/** Format UNIX seconds as "YYYY. MM. DD. HH:MM" in Hungarian local time. */
export function formatHuDateTime(unixSeconds) {
  if (!Number.isFinite(unixSeconds)) return '';
  const { y, m, d, hh, mm } = huParts(unixSeconds);
  return `${y}. ${m}. ${d}. ${hh}:${mm}`;
}

/** Format UNIX seconds as "YYYY. MM. DD." (Hungarian local time) — date only. */
export function formatHuDate(unixSeconds) {
  if (!Number.isFinite(unixSeconds)) return '';
  const { y, m, d } = huParts(unixSeconds);
  return `${y}. ${m}. ${d}.`;
}

// Europe/Budapest offset from UTC (ms) at a given instant: render the instant in the
// zone, read it back as if it were UTC, and diff. Positive means the zone leads UTC.
function huOffsetMs(utcMs) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: HU_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(utcMs));
  const g = (type) => Number(parts.find((p) => p.type === type).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - utcMs;
}

// UNIX seconds for a Hungarian-local midnight of year/month/day. `d` may overflow (e.g.
// 32) — Date.UTC normalizes it. The offset is resolved twice so a DST change on that
// day is handled correctly.
function huMidnightToUnix(y, m, d) {
  const guessMs = Date.UTC(y, m - 1, d, 0, 0, 0);
  const off1 = huOffsetMs(guessMs);
  let tsMs = guessMs - off1;
  const off2 = huOffsetMs(tsMs);
  if (off2 !== off1) tsMs = guessMs - off2;
  return Math.floor(tsMs / 1000);
}

/** 'YYYY-MM-DD' (from <input type="date">) -> inclusive Budapest-midnight UNIX seconds. */
export function dateInputToUnixStart(value) {
  const parts = parseDateInput(value);
  if (!parts) return null;
  return huMidnightToUnix(parts.y, parts.m, parts.d);
}

/** 'YYYY-MM-DD' -> exclusive upper bound: Budapest midnight of the *next* day. */
export function dateInputToUnixEndExclusive(value) {
  const parts = parseDateInput(value);
  if (!parts) return null;
  return huMidnightToUnix(parts.y, parts.m, parts.d + 1);
}

/** UNIX seconds -> 'YYYY-MM-DD' (Budapest local), for pre-filling <input type="date">. */
export function unixToDateInput(unixSeconds) {
  if (!Number.isFinite(unixSeconds)) return '';
  const { y, m, d } = huParts(unixSeconds);
  return `${y}-${m}-${d}`;
}

function parseDateInput(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

/** Group a number with thin spaces for Hungarian display (e.g. 654375 -> "654 375"). */
export function formatCount(n) {
  if (!Number.isFinite(n)) return '';
  return Math.trunc(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
}

/**
 * The Hungarian definite article for a word: "Az" before a vowel, "A" before a
 * consonant, decided by the first actual letter (leading quotes/operators/spaces
 * are skipped). This covers ordinary search terms; the phonetic exceptions —
 * letter-by-letter acronyms ("az FBI") and digits ("a 2" vs "az 5") — are not
 * handled, as they practically never occur as search phrases.
 * @param {string} term
 * @returns {'A'|'Az'}
 */
export function hungarianArticle(term) {
  const first = (String(term).match(/\p{L}/u) || [''])[0].toLowerCase();
  return first !== '' && 'aáeéiíoóöőuúüű'.includes(first) ? 'Az' : 'A';
}

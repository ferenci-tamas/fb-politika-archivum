// Hungarian date/time formatting and date-range conversions.
//
// posts.time holds UNIX seconds that SQLite-converter.R produced by interpreting
// the scraped timestamps as UTC (as.POSIXct(..., tz = "UTC")). To reproduce the
// original wall-clock time we therefore format and filter in UTC; using the
// browser's local zone would shift every timestamp. All functions here are pure.

const pad = (n, width = 2) => String(n).padStart(width, '0');

/** Format UNIX seconds as "YYYY. MM. DD. HH:MM" (UTC). */
export function formatHuDateTime(unixSeconds) {
  if (!Number.isFinite(unixSeconds)) return '';
  const d = new Date(unixSeconds * 1000);
  return (
    `${d.getUTCFullYear()}. ${pad(d.getUTCMonth() + 1)}. ${pad(d.getUTCDate())}. ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}

/** Format UNIX seconds as "YYYY. MM. DD." (UTC) — date only. */
export function formatHuDate(unixSeconds) {
  if (!Number.isFinite(unixSeconds)) return '';
  const d = new Date(unixSeconds * 1000);
  return `${d.getUTCFullYear()}. ${pad(d.getUTCMonth() + 1)}. ${pad(d.getUTCDate())}.`;
}

/** 'YYYY-MM-DD' (from <input type="date">) -> inclusive UTC-midnight UNIX seconds. */
export function dateInputToUnixStart(value) {
  const parts = parseDateInput(value);
  if (!parts) return null;
  return Math.floor(Date.UTC(parts.y, parts.m - 1, parts.d, 0, 0, 0) / 1000);
}

/** 'YYYY-MM-DD' -> exclusive upper bound: UTC midnight of the *next* day. */
export function dateInputToUnixEndExclusive(value) {
  const parts = parseDateInput(value);
  if (!parts) return null;
  return Math.floor(Date.UTC(parts.y, parts.m - 1, parts.d + 1, 0, 0, 0) / 1000);
}

/** UNIX seconds -> 'YYYY-MM-DD' (UTC), for pre-filling <input type="date">. */
export function unixToDateInput(unixSeconds) {
  if (!Number.isFinite(unixSeconds)) return '';
  const d = new Date(unixSeconds * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
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

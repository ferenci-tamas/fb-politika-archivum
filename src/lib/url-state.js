// Pure (DOM-free) serialization of the query view to/from a URL hash fragment.
// Deep links carry the query only — filters, search, sort, page size — never the
// pagination position (shared links reopen on the first page). Authors are carried
// by NAME (stable across rebuilds, unlike the build-local authorId); the caller
// maps names <-> ids. Dates are the YYYY-MM-DD input strings.

function isDateInput(s) {
  if (typeof s !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
}

/**
 * @param {{search:string, accentSensitive:boolean, authorNames:string[], dateFrom:string, dateTo:string, sort:string, pageSize:number}} view
 * @param {{defaultSort:string, defaultPageSize:number}} opts
 * @returns {string} the hash body (without a leading '#'); '' when all defaults
 */
export function encodeViewToHash(view, opts) {
  const p = new URLSearchParams();
  if (view.search && view.search.trim() !== '') p.set('q', view.search);
  if (view.accentSensitive) p.set('accent', '1');
  for (const name of view.authorNames || []) if (name) p.append('author', name);
  if (isDateInput(view.dateFrom)) p.set('from', view.dateFrom);
  if (isDateInput(view.dateTo)) p.set('to', view.dateTo);
  if (view.sort && view.sort !== opts.defaultSort) p.set('sort', view.sort);
  if (view.pageSize && view.pageSize !== opts.defaultPageSize) p.set('size', String(view.pageSize));
  return p.toString();
}

/**
 * @param {string} hash the location hash (leading '#' optional)
 * @param {{validSorts:string[], pageSizes:number[], defaultSort:string, defaultPageSize:number}} opts
 * @returns {{search:string, accentSensitive:boolean, authorNames:string[], dateFrom:string, dateTo:string, sort:string, pageSize:number}}
 */
export function decodeHashToView(hash, opts) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const sort = p.get('sort');
  const size = Number(p.get('size'));
  const from = p.get('from');
  const to = p.get('to');
  return {
    search: p.get('q') || '',
    accentSensitive: p.get('accent') === '1',
    authorNames: p.getAll('author').filter((n) => n && n.trim() !== ''),
    dateFrom: isDateInput(from) ? from : '',
    dateTo: isDateInput(to) ? to : '',
    sort: opts.validSorts.includes(sort) ? sort : opts.defaultSort,
    pageSize: opts.pageSizes.includes(size) ? size : opts.defaultPageSize
  };
}

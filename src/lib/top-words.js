// Shape one author's stored monthly top words into stacked-area series for the
// "Leggyakoribb szavak" (most frequent words) view. Pure (no DOM/ECharts), so it
// stays unit-testable in Node.
//
// The archive stores, per author and year-month, that month's top words with raw
// counts (see word_monthly in SQLite-converter.R). For one author this picks the
// `limit` words with the highest total across all months and returns one series per
// word, with a 0-filled point for every month the author was active — so the stacked
// areas share a common, gap-free time axis and each month's stack sums to the stored
// top words of that month.

/**
 * @param {{ym:string, word:string, n:number}[]} rows one author's word_monthly rows
 * @param {Map<string,number>|null} [totalsByYm] ym -> that month's total content-word
 *   tokens (word_month_totals); sets each point's `total` so ratio mode can show the
 *   word's share of content words. When null, `total` falls back to the stack sum.
 * @param {number} [limit] how many words (series) to keep, by total count
 * @returns {{series:{label:string,total:number,points:{ym:string,n:number,total:number}[]}[], months:string[]}}
 */
export function shapeTopWords(rows, totalsByYm = null, limit = 10) {
  if (!rows || rows.length === 0) return { series: [], months: [] };

  const months = [...new Set(rows.map((r) => r.ym))].sort();
  const monthIndex = new Map(months.map((ym, i) => [ym, i]));

  // Total per word, and each word's count in each month (0 where absent).
  const totals = new Map();
  const byWord = new Map();
  for (const r of rows) {
    const n = Number(r.n) || 0;
    totals.set(r.word, (totals.get(r.word) || 0) + n);
    let arr = byWord.get(r.word);
    if (!arr) {
      arr = new Array(months.length).fill(0);
      byWord.set(r.word, arr);
    }
    arr[monthIndex.get(r.ym)] += n;
  }

  // The `limit` highest-total words; ties broken by word for a stable order.
  const topWords = [...totals.keys()]
    .sort((a, b) => totals.get(b) - totals.get(a) || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, limit);

  // Per-month stacked total over the kept words (fallback denominator).
  const monthStackTotal = new Array(months.length).fill(0);
  for (const word of topWords) {
    const arr = byWord.get(word);
    for (let i = 0; i < months.length; i++) monthStackTotal[i] += arr[i];
  }

  // Ratio-mode denominator per month: the cell's total content-word tokens when
  // available (word_month_totals), else the displayed stack sum (absolute-only).
  const denom = months.map((ym, i) => {
    const t = totalsByYm && totalsByYm.get ? totalsByYm.get(ym) : null;
    return t && t > 0 ? t : monthStackTotal[i];
  });

  const series = topWords.map((word) => {
    const arr = byWord.get(word);
    return {
      label: word,
      total: totals.get(word),
      points: months.map((ym, i) => ({ ym, n: arr[i], total: denom[i] }))
    };
  });

  return { series, months };
}

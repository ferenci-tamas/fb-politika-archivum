// Turn free-form user input into a syntactically valid FTS5 MATCH expression.
//
// The result is always passed to SQLite as a bound parameter, so this is not
// about SQL injection — it is about never handing FTS5 a string it will reject
// with a syntax error. Every user token is wrapped in a double-quoted FTS5
// string, which makes characters like * ( ) : ^ - and stray quotes literal, so
// malformed input cannot break the query.
//
// Supported, deliberately small, feature set:
//   alma körte      -> "alma" AND "körte"      (implicit AND between terms)
//   "orbán viktor"  -> "orbán viktor"          (quoted phrase)
//   alma OR körte   -> "alma" OR "körte"        (explicit OR)
//   kormány*        -> "kormány"*               (prefix search)
//   alma -körte     -> ("alma") NOT ("körte")   (exclusion)
// Diacritics are preserved; the caller picks the sensitive or folded index.

export function buildFtsMatch(input) {
  if (typeof input !== 'string') return '';
  const text = input.normalize('NFC');
  const tokens = tokenize(text);

  const positives = [];
  const negatives = [];
  let useOr = false;

  for (const t of tokens) {
    if (t.kind === 'or') {
      useOr = true;
      continue;
    }
    const expr = ftsString(t.value) + (t.prefix ? '*' : '');
    if (t.neg) negatives.push(expr);
    else positives.push(expr);
  }

  if (positives.length === 0) return '';
  const joiner = useOr ? ' OR ' : ' AND ';
  let out = positives.length === 1 ? positives[0] : positives.join(joiner);
  if (negatives.length > 0) {
    out = `(${out}) NOT (${negatives.join(' OR ')})`;
  }
  return out;
}

function tokenize(text) {
  const tokens = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    while (i < n && isSpace(text[i])) i++;
    if (i >= n) break;

    let neg = false;
    if (text[i] === '-') {
      if (i + 1 < n && !isSpace(text[i + 1])) {
        neg = true;
        i++;
      } else {
        i++;
        continue;
      }
    }

    if (text[i] === '"') {
      i++;
      let val = '';
      while (i < n && text[i] !== '"') {
        val += text[i];
        i++;
      }
      if (i < n && text[i] === '"') i++;
      val = val.trim();
      if (val) tokens.push({ kind: 'phrase', value: val, neg, prefix: false });
      continue;
    }

    let val = '';
    while (i < n && !isSpace(text[i]) && text[i] !== '"') {
      val += text[i];
      i++;
    }
    let prefix = false;
    if (val.endsWith('*')) {
      prefix = true;
      val = val.replace(/\*+$/, '');
    }
    if (!neg && !prefix && (val === 'OR' || val === 'VAGY')) {
      tokens.push({ kind: 'or' });
      continue;
    }
    if (!neg && !prefix && (val === 'AND' || val === 'NOT' || val === 'ÉS')) {
      // Ignore dangling/unsupported binary operators; AND is already implicit.
      continue;
    }
    if (val) tokens.push({ kind: 'term', value: val, neg, prefix });
  }
  return tokens;
}

function isSpace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}

function ftsString(s) {
  return '"' + s.replace(/"/g, '""') + '"';
}

// Security utilities for turning untrusted database values into safe URLs.
// Text itself is never turned into HTML anywhere in the app — it is always
// written with textContent — so this module only has to guard URLs.

const SAFE_SCHEMES = new Set(['http:', 'https:']);

/**
 * Validate an external URL. Returns a normalized absolute http(s) URL string, or
 * null if the input is not a safe, absolute http/https URL. This rejects
 * javascript:, data:, vbscript:, file:, mailto:, relative URLs, and anything the
 * URL parser cannot make sense of (including smuggled newlines/tabs).
 */
export function safeExternalUrl(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!SAFE_SCHEMES.has(url.protocol.toLowerCase())) return null;
  return url.href;
}

/**
 * Build a safe absolute URL for an image filename under the R2 /images/ prefix.
 * Filenames are plain basenames in the archive; encodeURIComponent neutralizes
 * any stray path separators or unusual characters, preventing traversal.
 */
export function imageUrl(filename, imagesBaseUrl) {
  if (typeof filename !== 'string') return null;
  const name = filename.trim();
  if (name === '') return null;
  return safeExternalUrl(imagesBaseUrl + encodeURIComponent(name));
}

/**
 * Parse the embedded images JSON (`["name", ...]`) defensively. Always returns
 * an array of non-empty strings.
 */
export function parseImages(json) {
  const arr = safeJsonArray(json);
  const out = [];
  for (const v of arr) {
    if (typeof v === 'string' && v.trim() !== '') out.push(v);
  }
  return out;
}

/**
 * Parse the embedded links JSON (`[["url", 0|1], ...]`) defensively. Always
 * returns an array of { url: string, available: boolean }.
 */
export function parseLinks(json) {
  const arr = safeJsonArray(json);
  const out = [];
  for (const v of arr) {
    if (Array.isArray(v) && typeof v[0] === 'string') {
      out.push({ url: v[0], available: v[1] === 1 || v[1] === true });
    }
  }
  return out;
}

function safeJsonArray(json) {
  if (json == null) return [];
  if (Array.isArray(json)) return json;
  if (typeof json !== 'string') return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

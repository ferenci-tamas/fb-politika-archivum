// Asynchronous multi-range transport: fetch many byte ranges in one
// multipart/byteranges HTTP request (confirmed supported by R2, 200+ ranges) and
// seed them into the VFS block cache. Used by the hydration prefetch so a page's
// scattered leaf/overflow reads cost ~one request per b-tree level instead of one
// serialized read each. parseMultipart is pure and unit-tested.

function indexOfBytes(hay, needle, from) {
  const last = hay.length - needle.length;
  outer: for (let i = from; i <= last; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Parse a multipart/byteranges body into [{ start, bytes }] where `start` is the
 * absolute byte offset from each part's Content-Range header.
 */
export function parseMultipart(buf, boundary) {
  const delim = new TextEncoder().encode('--' + boundary);
  const headerSep = [13, 10, 13, 10]; // CRLF CRLF
  const out = [];
  let pos = indexOfBytes(buf, delim, 0);
  while (pos !== -1) {
    pos += delim.length;
    if (buf[pos] === 45 && buf[pos + 1] === 45) break; // closing "--"
    if (buf[pos] === 13 && buf[pos + 1] === 10) pos += 2; // CRLF after boundary
    const headerEnd = indexOfBytes(buf, headerSep, pos);
    if (headerEnd === -1) break;
    const headerText = new TextDecoder('latin1').decode(buf.subarray(pos, headerEnd));
    const m = /content-range:\s*bytes\s+(\d+)-/i.exec(headerText);
    const bodyStart = headerEnd + 4;
    const nextDelim = indexOfBytes(buf, delim, bodyStart);
    if (nextDelim === -1) break;
    let bodyEnd = nextDelim;
    if (bodyEnd >= 2 && buf[bodyEnd - 2] === 13 && buf[bodyEnd - 1] === 10) bodyEnd -= 2;
    if (m) out.push({ start: Number(m[1]), bytes: buf.subarray(bodyStart, bodyEnd).slice() });
    pos = nextDelim;
  }
  return out;
}

/**
 * Build an async block fetcher.
 * @param {object} o
 * @param {import('../lib/parts.js').PartMap} o.partMap
 * @param {string} o.partsBaseUrl absolute URL ending in '/'
 * @param {number} o.fileSize
 * @param {number} o.blockSize
 * @param {(blockIndex:number, bytes:Uint8Array)=>void} o.store seed a block into the cache
 * @returns {(blockIndices:number[])=>Promise<void>}
 */
export function makeMultiRangeFetcher({ partMap, partsBaseUrl, fileSize, blockSize, store }) {
  return async function fetchBlocks(blockIndices) {
    // Blocks never straddle a part boundary (partSize is a multiple of blockSize),
    // so each block maps to exactly one part.
    const byPart = new Map();
    for (const bi of blockIndices) {
      const offset = bi * blockSize;
      const length = Math.min(blockSize, fileSize - offset);
      const part = partMap.partForOffset(offset);
      let arr = byPart.get(part.name);
      if (!arr) {
        arr = [];
        byPart.set(part.name, arr);
      }
      arr.push({ bi, partStart: offset - part.offset, length });
    }

    for (const [name, items] of byPart) {
      const header = 'bytes=' + items.map((it) => `${it.partStart}-${it.partStart + it.length - 1}`).join(', ');
      const resp = await fetch(partsBaseUrl + name, { headers: { Range: header }, signal: AbortSignal.timeout(10000) });
      if (resp.status === 206) {
        const ct = resp.headers.get('Content-Type') || '';
        const body = new Uint8Array(await resp.arrayBuffer());
        if (/multipart\/byteranges/i.test(ct)) {
          const bm = /boundary=("?)([^";\r\n]+)\1/i.exec(ct);
          const byStart = new Map(items.map((it) => [it.partStart, it]));
          for (const pr of parseMultipart(body, bm[2])) {
            const it = byStart.get(pr.start);
            if (it) store(it.bi, pr.bytes);
          }
        } else {
          const cr = resp.headers.get('Content-Range') || '';
          const mm = /bytes\s+(\d+)-/i.exec(cr);
          const start = mm ? Number(mm[1]) : items[0].partStart;
          const it = items.find((x) => x.partStart === start) || items[0];
          store(it.bi, body.slice());
        }
      } else if (resp.status === 200) {
        // Range ignored; whole part returned — slice out each block.
        const whole = new Uint8Array(await resp.arrayBuffer());
        for (const it of items) store(it.bi, whole.subarray(it.partStart, it.partStart + it.length).slice());
      } else {
        throw new Error(`multi-range HTTP ${resp.status} for ${name}`);
      }
    }
  };
}

// A minimal, read-only SQLite b-tree reader used ONLY to warm the VFS cache
// before a (synchronous) hydrate query. Given the page's rowids it discovers,
// breadth-first, the leaf pages — and any overflow-page chains — that the hydrate
// will read, fetching each b-tree level in one batch (one multi-range request) so
// the network sees ~tree-depth round-trips instead of one per scattered row.
//
// It is a cache WARMER only: the synchronous VFS remains the source of truth, so
// anything this misses just costs one ordinary read. All parsing is defensive;
// on anything unexpected it returns early and lets the normal path take over.

export const be16 = (b, o) => b[o] * 256 + b[o + 1];
export const be32 = (b, o) => b[o] * 0x1000000 + b[o + 1] * 0x10000 + b[o + 2] * 0x100 + b[o + 3];

/** Read a SQLite varint. Returns [value, byteLength]. Values here (rowids,
 * payload lengths) are well within 2^53, so a Number is safe. */
export function readVarint(b, o) {
  let v = 0;
  for (let i = 0; i < 9; i++) {
    const byte = b[o + i];
    if (i === 8) return [v * 256 + byte, 9];
    v = v * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return [v, i + 1];
  }
  return [v, 9];
}

/** Interior table page: the child page pointer to follow for `rowid`. */
export function interiorChild(buf, h, rowid) {
  const nCells = be16(buf, h + 3);
  const ptrBase = h + 12;
  let child = be32(buf, h + 8); // right-most pointer
  for (let i = 0; i < nCells; i++) {
    const cellOff = be16(buf, ptrBase + i * 2);
    const [key] = readVarint(buf, cellOff + 4);
    if (rowid <= key) {
      child = be32(buf, cellOff);
      break;
    }
  }
  return child;
}

/** Leaf table page: the first overflow page number for each cell whose payload
 * spills off the page. `usable` is the usable page size (page size − reserved). */
export function leafOverflowHeads(buf, h, usable) {
  const heads = [];
  const nCells = be16(buf, h + 3);
  const ptrBase = h + 8; // leaf page header is 8 bytes (interior is 12)
  const X = usable - 35; // max payload kept on a table-leaf page
  const M = Math.floor(((usable - 12) * 32) / 255) - 23;
  for (let i = 0; i < nCells; i++) {
    const cellOff = be16(buf, ptrBase + i * 2);
    const [payloadLen, n1] = readVarint(buf, cellOff);
    if (payloadLen <= X) continue; // fits locally, no overflow
    const [, n2] = readVarint(buf, cellOff + n1); // rowid varint (skip)
    const K = M + ((payloadLen - M) % (usable - 4));
    const local = K <= X ? K : M;
    heads.push(be32(buf, cellOff + n1 + n2 + local));
  }
  return heads;
}

/**
 * Warm the cache with the pages a hydrate of `rowids` will read.
 * @param {object} o
 * @param {{has:(bi:number)=>boolean, readInto:(dest:Uint8Array,off:number,len:number)=>void}} o.cache
 * @param {(blockIndices:number[])=>Promise<void>} o.fetchBlocks seeds blocks into the cache
 * @param {number} o.rootPage posts table root page
 * @param {number[]} o.rowids
 * @param {number} o.pageSize
 * @param {number} o.usableSize page size − reserved bytes
 * @param {number} o.fileSize
 * @param {number} o.blockSize cache block size
 * @returns {Promise<{requests:number}>} number of multi-range requests issued
 */
export async function prefetchHydrationPages(o) {
  const { cache, fetchBlocks, rootPage, rowids, pageSize, usableSize, fileSize, blockSize } = o;
  const maxDepth = o.maxDepth ?? 24;
  if (!rowids || rowids.length === 0) return { requests: 0 };

  const pageOffset = (p) => (p - 1) * pageSize;
  const blockOf = (p) => Math.floor(pageOffset(p) / blockSize);
  const headerOffset = (p) => (p === 1 ? 100 : 0);
  let requests = 0;

  const ensure = async (pages) => {
    const blocks = [...new Set(pages.map(blockOf))].filter((bi) => !cache.has(bi));
    if (blocks.length === 0) return;
    await fetchBlocks(blocks);
    requests += 1;
  };
  const readPage = (p) => {
    const dest = new Uint8Array(pageSize);
    const off = pageOffset(p);
    cache.readInto(dest, off, Math.min(pageSize, fileSize - off));
    return dest;
  };

  // Breadth-first descent to the leaves: one batch fetch per level.
  let frontier = new Map([[rootPage, rowids.slice()]]);
  let leaves = [];
  for (let depth = 0; depth < maxDepth; depth++) {
    const pages = [...frontier.keys()];
    await ensure(pages);
    const next = new Map();
    let reachedLeaf = false;
    for (const page of pages) {
      const buf = readPage(page);
      const h = headerOffset(page);
      const type = buf[h];
      if (type === 13) {
        reachedLeaf = true;
        continue;
      }
      if (type !== 5) return { requests }; // unexpected layout; bail
      for (const rid of frontier.get(page)) {
        const child = interiorChild(buf, h, rid);
        let arr = next.get(child);
        if (!arr) {
          arr = [];
          next.set(child, arr);
        }
        arr.push(rid);
      }
    }
    if (reachedLeaf) {
      leaves = pages;
      break;
    }
    frontier = next;
  }

  // Follow overflow-page chains for any long rows (e.g. long post text).
  let chain = [];
  for (const page of leaves) {
    const buf = readPage(page);
    for (const head of leafOverflowHeads(buf, headerOffset(page), usableSize)) {
      if (head > 0) chain.push(head);
    }
  }
  chain = [...new Set(chain)];
  for (let i = 0; i < maxDepth && chain.length > 0; i++) {
    await ensure(chain);
    const nextChain = [];
    for (const page of chain) {
      const nextPage = be32(readPage(page), 0); // overflow page: first 4 bytes = next page
      if (nextPage > 0) nextChain.push(nextPage);
    }
    chain = [...new Set(nextChain)];
  }

  return { requests };
}

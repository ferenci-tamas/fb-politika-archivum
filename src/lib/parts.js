// Maps an absolute byte range of the logical SQLite file onto the "parts" the
// archive is split into for Cloudflare's edge cache (see section 15 of
// SQLite-converter.R). Each part is a consecutive, page-aligned byte range; the
// parts concatenate back to the whole archive. A single read may, in principle,
// straddle a part boundary, so slices() can return more than one piece.

export class PartMap {
  /**
   * @param {{parts: Array<{name:string,offset:number,size:number}>, pageSize:number, size:number}} manifest
   */
  constructor(manifest) {
    if (!manifest || !Array.isArray(manifest.parts) || manifest.parts.length === 0) {
      throw new Error('Invalid manifest: no parts');
    }
    this.pageSize = manifest.pageSize;
    this.fileSize = manifest.size;
    this.parts = manifest.parts
      .map((p) => ({ name: p.name, offset: p.offset, size: p.size, end: p.offset + p.size }))
      .sort((a, b) => a.offset - b.offset);

    // Sanity: parts must tile [0, fileSize) with no gaps/overlaps.
    let expected = 0;
    for (const p of this.parts) {
      if (p.offset !== expected) {
        throw new Error(`Part ${p.name} starts at ${p.offset}, expected ${expected}`);
      }
      expected = p.end;
    }
    if (expected !== this.fileSize) {
      throw new Error(`Parts cover ${expected} bytes, manifest size is ${this.fileSize}`);
    }
  }

  /**
   * Split an absolute read into per-part slices.
   * @param {number} offset absolute byte offset into the logical file
   * @param {number} length number of bytes to read
   * @returns {Array<{name:string, partStart:number, length:number, bufOffset:number}>}
   */
  slices(offset, length) {
    if (!Number.isFinite(offset) || !Number.isFinite(length)) {
      throw new RangeError('offset/length must be finite numbers');
    }
    if (offset < 0 || length < 0) throw new RangeError('negative offset/length');
    if (length === 0) return [];
    const end = offset + length;
    if (end > this.fileSize) {
      throw new RangeError(`read past EOF: ${offset}+${length} > ${this.fileSize}`);
    }
    const out = [];
    for (const part of this.parts) {
      if (part.end <= offset) continue;
      if (part.offset >= end) break;
      const from = Math.max(offset, part.offset);
      const to = Math.min(end, part.end);
      out.push({
        name: part.name,
        partStart: from - part.offset,
        length: to - from,
        bufOffset: from - offset
      });
    }
    return out;
  }
}

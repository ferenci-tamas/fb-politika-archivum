// A read-only SQLite VFS for @sqlite.org/sqlite-wasm that serves database pages
// from a flat, immutable byte source via a caller-supplied *synchronous* reader.
// The reader abstracts the transport: synchronous HTTP range requests in the
// browser worker, or plain file reads in the Node test harness. This module is
// therefore transport-agnostic and fully exercised by the Node test suite.
//
// SQLite's VFS interface is synchronous, which is exactly why all of this must
// run in a Web Worker: the synchronous reads block the worker thread, never the
// UI thread.
//
// The database is immutable (built once, never written), so:
//   * cached blocks never need invalidation,
//   * the file is opened read-only and reports SQLITE_IOCAP_IMMUTABLE, which
//     lets SQLite skip all locking and journal/WAL probing,
//   * write-side VFS methods are implemented as hard errors; they must never be
//     reached.

import { BLOCK_SIZE, PREFETCH_BYTES, MAX_CACHE_BYTES } from './constants.js';

/**
 * A fixed-block LRU cache in front of a synchronous range reader. Blocks are
 * BLOCK_SIZE bytes (the last one may be shorter). Because the data is immutable,
 * eviction is safe: an evicted block is simply refetched if needed again.
 */
class BlockCache {
  constructor({ read, fileSize, blockSize, maxBytes }) {
    this.read = read; // (offset, length) => Uint8Array of exactly length bytes
    this.fileSize = fileSize;
    this.blockSize = blockSize;
    this.maxBytes = maxBytes;
    this.blocks = new Map(); // blockIndex -> Uint8Array (Map preserves LRU order)
    this.bytes = 0;
    this.stats = { requests: 0, bytesFetched: 0, hits: 0, misses: 0 };
  }

  has(index) {
    return this.blocks.has(index);
  }

  get(index) {
    const b = this.blocks.get(index);
    if (b !== undefined) {
      // Move to the most-recently-used end.
      this.blocks.delete(index);
      this.blocks.set(index, b);
    }
    return b;
  }

  store(index, data) {
    if (this.blocks.has(index)) return;
    this.blocks.set(index, data);
    this.bytes += data.byteLength;
    while (this.bytes > this.maxBytes && this.blocks.size > 1) {
      const oldest = this.blocks.keys().next().value;
      const evicted = this.blocks.get(oldest);
      this.blocks.delete(oldest);
      this.bytes -= evicted.byteLength;
    }
  }

  /** Fetch [startBlock, endBlock) in a single range request and store them. */
  fetchRun(startBlock, endBlock) {
    const runStart = startBlock * this.blockSize;
    const runEnd = Math.min(endBlock * this.blockSize, this.fileSize);
    const buf = this.read(runStart, runEnd - runStart);
    this.stats.requests += 1;
    this.stats.bytesFetched += buf.byteLength;
    for (let b = startBlock; b < endBlock; b++) {
      const from = (b - startBlock) * this.blockSize;
      if (from >= buf.byteLength) break;
      const to = Math.min(from + this.blockSize, buf.byteLength);
      this.store(b, buf.subarray(from, to));
    }
  }

  /** Copy [offset, offset+length) into dest (a heap view of exactly length bytes). */
  readInto(dest, offset, length) {
    if (length === 0) return;
    const first = Math.floor(offset / this.blockSize);
    const last = Math.floor((offset + length - 1) / this.blockSize);

    // Fetch missing blocks, coalescing consecutive misses into one request.
    let i = first;
    while (i <= last) {
      if (this.has(i)) {
        this.stats.hits += 1;
        i += 1;
        continue;
      }
      let j = i;
      while (j <= last && !this.has(j)) {
        this.stats.misses += 1;
        j += 1;
      }
      this.fetchRun(i, j);
      i = j;
    }

    // Assemble the requested range from cached blocks.
    for (let b = first; b <= last; b++) {
      const block = this.get(b);
      const blockStart = b * this.blockSize;
      const from = Math.max(offset, blockStart);
      const to = Math.min(offset + length, blockStart + block.byteLength);
      if (to <= from) continue;
      dest.set(block.subarray(from - blockStart, to - blockStart), from - offset);
    }
  }

  prefetch(nbytes) {
    if (nbytes <= 0) return;
    const endBlock = Math.ceil(Math.min(nbytes, this.fileSize) / this.blockSize);
    if (endBlock > 0) this.fetchRun(0, endBlock);
  }
}

/**
 * Install and register a read-only range VFS.
 * @param {object} sqlite3 result of sqlite3InitModule()
 * @param {object} options
 * @param {string} options.vfsName unique VFS name
 * @param {number} options.fileSize total logical size of the database file
 * @param {(offset:number,length:number)=>Uint8Array} options.read synchronous reader
 * @param {number} [options.blockSize]
 * @param {number} [options.maxCacheBytes]
 * @param {number} [options.prefetchBytes]
 * @returns {{vfsName:string, cache:BlockCache, getStats:()=>object}}
 */
export function installRangeVfs(sqlite3, options) {
  const capi = sqlite3.capi;
  const wasm = sqlite3.wasm;
  const vfsName = options.vfsName;

  if (capi.sqlite3_vfs_find(vfsName)) {
    throw new Error(`VFS name already registered: ${vfsName}`);
  }

  const cache = new BlockCache({
    read: options.read,
    fileSize: options.fileSize,
    blockSize: options.blockSize ?? BLOCK_SIZE,
    maxBytes: options.maxCacheBytes ?? MAX_CACHE_BYTES
  });

  const prefetch = options.prefetchBytes ?? PREFETCH_BYTES;
  if (prefetch > 0) cache.prefetch(prefetch);

  const fileSize = options.fileSize;
  const openFiles = new Set(); // pFile pointers opened through this VFS
  let lastError = null;

  const SQLITE_OK = capi.SQLITE_OK;

  const ioMethods = {
    xClose(pFile) {
      openFiles.delete(Number(pFile));
      return SQLITE_OK;
    },
    xRead(pFile, pBuf, iAmt, iOfst) {
      const offset = Number(iOfst);
      const n = Number(iAmt);
      const ptr = Number(pBuf);
      let dest;
      try {
        dest = wasm.heap8u().subarray(ptr, ptr + n);
        if (offset >= fileSize) {
          dest.fill(0);
          return capi.SQLITE_IOERR_SHORT_READ;
        }
        const avail = Math.min(n, fileSize - offset);
        cache.readInto(dest.subarray(0, avail), offset, avail);
        if (avail < n) {
          dest.fill(0, avail);
          return capi.SQLITE_IOERR_SHORT_READ;
        }
        return SQLITE_OK;
      } catch (e) {
        lastError = e;
        if (dest) dest.fill(0);
        return capi.SQLITE_IOERR_READ;
      }
    },
    // Immutable database: writes must never happen.
    xWrite(_pFile, _pBuf, _iAmt, _iOfst) {
      lastError = new Error('xWrite called on a read-only VFS');
      return capi.SQLITE_IOERR_WRITE;
    },
    xTruncate(_pFile, _size) {
      return capi.SQLITE_IOERR_TRUNCATE;
    },
    xSync(_pFile, _flags) {
      return SQLITE_OK;
    },
    xFileSize(pFile, pSize) {
      wasm.poke(pSize, BigInt(fileSize), 'i64');
      return SQLITE_OK;
    },
    // No real locking is needed for an immutable, read-only file.
    xLock(_pFile, _lockType) {
      return SQLITE_OK;
    },
    xUnlock(_pFile, _lockType) {
      return SQLITE_OK;
    },
    xCheckReservedLock(_pFile, pResOut) {
      wasm.poke32(pResOut, 0);
      return SQLITE_OK;
    },
    xFileControl(_pFile, _op, _pArg) {
      return capi.SQLITE_NOTFOUND;
    },
    xSectorSize(_pFile) {
      return 4096;
    },
    xDeviceCharacteristics(_pFile) {
      return capi.SQLITE_IOCAP_IMMUTABLE;
    }
  };

  const vfsMethods = {
    xOpen(_pVfs, zName, pFile, flags, pOutFlags) {
      try {
        // This VFS only ever opens the main database file. Temp storage is kept
        // in memory (PRAGMA temp_store = MEMORY), so no other file is expected.
        if (!(flags & capi.SQLITE_OPEN_MAIN_DB)) {
          return capi.SQLITE_CANTOPEN;
        }
        const sq3File = new capi.sqlite3_file(pFile);
        sq3File.$pMethods = ioStruct.pointer;
        sq3File.dispose();
        openFiles.add(Number(pFile));
        if (pOutFlags) wasm.poke32(pOutFlags, flags | capi.SQLITE_OPEN_READONLY);
        return SQLITE_OK;
      } catch (e) {
        lastError = e;
        return capi.SQLITE_CANTOPEN;
      }
    },
    xDelete(_pVfs, _zName, _syncDir) {
      return capi.SQLITE_IOERR_DELETE; // read-only: nothing to delete
    },
    xAccess(_pVfs, _zName, _flags, pResOut) {
      // No journal/WAL/side files exist for an immutable read-only database.
      wasm.poke32(pResOut, 0);
      return SQLITE_OK;
    },
    xFullPathname(_pVfs, zName, nOut, pOut) {
      return wasm.cstrncpy(pOut, zName, nOut) < nOut ? SQLITE_OK : capi.SQLITE_CANTOPEN;
    },
    xGetLastError(_pVfs, nOut, pOut) {
      const msg = lastError ? String(lastError.message || lastError) : '';
      if (msg && nOut > 0) {
        const bytes = new TextEncoder().encode(msg).subarray(0, nOut - 1);
        const heap = wasm.heap8u();
        heap.set(bytes, Number(pOut));
        heap[Number(pOut) + bytes.length] = 0;
      }
      return SQLITE_OK;
    },
    xCurrentTime(_pVfs, pOut) {
      wasm.poke(pOut, 2440587.5 + Date.now() / 86400000, 'double');
      return SQLITE_OK;
    },
    xCurrentTimeInt64(_pVfs, pOut) {
      wasm.poke(pOut, BigInt(Math.floor(2440587.5 * 86400000)) + BigInt(Date.now()), 'i64');
      return SQLITE_OK;
    },
    xRandomness(_pVfs, nByte, pOut) {
      const heap = wasm.heap8u();
      const base = Number(pOut);
      for (let i = 0; i < nByte; i++) heap[base + i] = (Math.random() * 256) & 0xff;
      return nByte;
    },
    xSleep(_pVfs, _microseconds) {
      return SQLITE_OK;
    }
  };

  const ioStruct = new capi.sqlite3_io_methods();
  ioStruct.$iVersion = 1;

  const vfsStruct = new capi.sqlite3_vfs();
  vfsStruct.$iVersion = 2;
  vfsStruct.$szOsFile = capi.sqlite3_file.structInfo.sizeof;
  vfsStruct.$mxPathname = 1024;

  sqlite3.vfs.installVfs({
    io: { struct: ioStruct, methods: ioMethods },
    vfs: { struct: vfsStruct, methods: vfsMethods, name: vfsName, asDefault: false }
  });

  return {
    vfsName,
    cache,
    getStats: () => ({ ...cache.stats, cachedBytes: cache.bytes, cachedBlocks: cache.blocks.size }),
    getLastError: () => lastError,
    clearLastError: () => {
      lastError = null;
    }
  };
}

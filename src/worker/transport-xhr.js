// Synchronous HTTP range transport for the database Web Worker. SQLite's VFS is
// synchronous, so the reads must be synchronous too; synchronous XMLHttpRequest
// is permitted inside a Worker (it is not on the main thread). Each read is
// mapped to one or more parts and issued as a `Range` request.
//
// Primary path: responseType='arraybuffer' (allowed for sync XHR in a Worker).
// Fallback: the classic 'x-user-defined' text trick, in case an engine ignores
// responseType on a synchronous request.

export class RangeNotSupportedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RangeNotSupportedError';
    this.kind = 'range-not-supported';
  }
}

export class TransportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TransportError';
    this.kind = 'network';
  }
}

/**
 * @param {import('../lib/parts.js').PartMap} partMap
 * @param {string} partsBaseUrl absolute URL ending in '/', e.g. https://host/database/1790843311/
 * @returns {(offset:number,length:number)=>Uint8Array}
 */
export function makeXhrReader(partMap, partsBaseUrl) {
  let mode = null; // 'arraybuffer' | 'text' — detected on the first successful read

  const requestSlice = (name, start, length, forceText) => {
    const url = partsBaseUrl + name;
    const end = start + length - 1;
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, false); // synchronous
    xhr.setRequestHeader('Range', `bytes=${start}-${end}`);
    const useText = forceText || mode === 'text';
    if (useText) {
      xhr.overrideMimeType('text/plain; charset=x-user-defined');
    } else {
      try {
        xhr.responseType = 'arraybuffer';
      } catch {
        // Ignore: fall back to text decoding below.
      }
    }

    try {
      xhr.send(null);
    } catch (e) {
      throw new TransportError(`Network error requesting ${name} bytes ${start}-${end}: ${e && e.message}`);
    }

    const status = xhr.status;
    if (status === 200) {
      // The server ignored the Range header and returned the whole object.
      throw new RangeNotSupportedError(
        `Server returned 200 OK instead of 206 Partial Content for ${name}; HTTP range requests are required.`
      );
    }
    if (status !== 206) {
      throw new TransportError(`Unexpected HTTP ${status} for ${name} bytes ${start}-${end}.`);
    }

    if (!useText && xhr.response instanceof ArrayBuffer) {
      mode = 'arraybuffer';
      const bytes = new Uint8Array(xhr.response);
      if (bytes.byteLength !== length) {
        throw new TransportError(`Short range response for ${name}: got ${bytes.byteLength}, expected ${length}.`);
      }
      return bytes;
    }

    // Text fallback (bytes smuggled through x-user-defined encoding).
    if (!useText) {
      // responseType was ignored — retry this slice in text mode.
      return requestSlice(name, start, length, true);
    }
    mode = 'text';
    const text = xhr.responseText;
    if (text.length !== length) {
      throw new TransportError(`Short range response for ${name}: got ${text.length}, expected ${length}.`);
    }
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = text.charCodeAt(i) & 0xff;
    return out;
  };

  return (offset, length) => {
    const out = new Uint8Array(length);
    for (const slice of partMap.slices(offset, length)) {
      const bytes = requestSlice(slice.name, slice.partStart, slice.length, false);
      out.set(bytes, slice.bufOffset);
    }
    return out;
  };
}

import { defineConfig } from 'vite';

// The site is served from https://ferenci-tamas.github.io/fb-politika-archivum/,
// so every asset URL (JS, CSS, the Web Worker, and the SQLite .wasm) must be
// built relative to that sub-path.
const BASE = '/fb-politika-archivum/';

export default defineConfig({
  base: BASE,
  worker: {
    // The database Web Worker uses ES module imports (@sqlite.org/sqlite-wasm).
    format: 'es'
  },
  optimizeDeps: {
    // @sqlite.org/sqlite-wasm ships its own .wasm and must not be pre-bundled by
    // esbuild, otherwise the wasm asset URL is not rewritten for the worker.
    exclude: ['@sqlite.org/sqlite-wasm']
  },
  build: {
    target: 'es2022',
    sourcemap: true
  }
});

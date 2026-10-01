// Build-time configuration for the browser app. The R2 base URL is injected by
// Vite from VITE_R2_BASE_URL (see .env); it is a public, read-only CDN endpoint,
// never a secret. Keeping it here means the URL is defined once, not scattered
// through the source.

import {
  FEED_PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  SORTS,
  FTS_TABLE,
  BLOCK_SIZE,
  PREFETCH_BYTES,
  MAX_CACHE_BYTES,
  SQLITE_CACHE_KIB
} from './lib/constants.js';

const RAW_BASE =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_R2_BASE_URL) ||
  'https://fb-politika-archivum.medstat.hu';

export const R2_BASE_URL = String(RAW_BASE).replace(/\/+$/, '');
export const MANIFEST_URL = `${R2_BASE_URL}/database/latest.json`;
export const DATABASE_BASE_URL = `${R2_BASE_URL}/database/`;
export const IMAGES_BASE_URL = `${R2_BASE_URL}/images/`;

export {
  FEED_PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  SORTS,
  FTS_TABLE,
  BLOCK_SIZE,
  PREFETCH_BYTES,
  MAX_CACHE_BYTES,
  SQLITE_CACHE_KIB
};

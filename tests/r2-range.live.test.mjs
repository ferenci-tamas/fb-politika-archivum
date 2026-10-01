// Opt-in live test: verifies the deployed Cloudflare R2 endpoint actually serves
// HTTP range requests (206 Partial Content) and that PartMap maps byte ranges —
// including across the part boundary — to the correct bytes. Compared against the
// local archive.sqlite.
//
// Only runs when R2_LIVE_TEST=1 and a local archive.sqlite is present, so the
// default `npm test` never depends on the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PartMap } from '../src/lib/parts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archivePath = path.join(ROOT, 'archive.sqlite');
const manifestPath = path.join(ROOT, 'latest.json');
const enabled = process.env.R2_LIVE_TEST === '1' && fs.existsSync(archivePath) && fs.existsSync(manifestPath);

if (!enabled) {
  test('R2 live range requests', { skip: 'set R2_LIVE_TEST=1 and provide local archive.sqlite to run' }, () => {});
} else {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const base = `https://fb-politika-archivum.medstat.hu/database/${manifest.base}`;
  const pm = new PartMap(manifest);
  const fd = fs.openSync(archivePath, 'r');

  const localAbs = (offset, length) => {
    const b = Buffer.alloc(length);
    fs.readSync(fd, b, 0, length, offset);
    return b;
  };

  const fetchAbs = async (offset, length) => {
    const out = Buffer.alloc(length);
    for (const s of pm.slices(offset, length)) {
      const end = s.partStart + s.length - 1;
      const resp = await fetch(base + s.name, { headers: { Range: `bytes=${s.partStart}-${end}` } });
      assert.equal(resp.status, 206, `expected 206 for ${s.name}, got ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      assert.equal(buf.length, s.length);
      buf.copy(out, s.bufOffset);
    }
    return out;
  };

  const boundary = manifest.parts[0].size;
  const cases = [
    ['header', 0, 100],
    ['mid part 0', 123456789, 8192],
    ['spanning the part boundary', boundary - 2000, 4096],
    ['start of part 1', boundary, 4096],
    ['last page', manifest.size - 4096, 4096]
  ];

  for (const [label, off, len] of cases) {
    test(`R2 range read: ${label}`, async () => {
      const remote = await fetchAbs(off, len);
      const local = localAbs(off, len);
      assert.ok(remote.equals(local), `bytes differ for ${label}`);
    });
  }
}

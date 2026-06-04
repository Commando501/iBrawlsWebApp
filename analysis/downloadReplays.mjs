// Offline: download the replay corpus from R2 (via the admin Worker endpoints) to
// local disk for behavior-cloning training, verifying integrity on the way in.
//
// Usage:
//   WORKER_URL=https://<your-worker> ADMIN_TOKEN=<token> \
//     node analysis/downloadReplays.mjs --out=./replays --limit=2000
//
// For each replay it GETs the gzipped blob, gunzips it, recomputes the SHA-256 of the
// decompressed JSON, and compares it to the manifest hash — so a corrupted blob is
// caught, never silently trained on. Files are written as <id>.json (decompressed).
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const base = (process.env.WORKER_URL || '').replace(/\/$/, '');
const token = process.env.ADMIN_TOKEN || '';
const outDir = args.out || './replays';
const limit = Number(args.limit) || 2000;

if (!base || !token) {
  console.error('Set WORKER_URL and ADMIN_TOKEN. See analysis/README.md.');
  process.exit(1);
}

const authHeaders = { Authorization: `Bearer ${token}` };

async function main() {
  const listRes = await fetch(`${base}/api/replay/list?limit=${limit}`, { headers: authHeaders });
  if (!listRes.ok) {
    console.error(`List failed (${listRes.status}): ${await listRes.text().catch(() => '')}`);
    process.exit(1);
  }
  const { replays = [] } = await listRes.json();
  console.log(`Manifest: ${replays.length} replay(s). Downloading to ${outDir} ...`);
  mkdirSync(outDir, { recursive: true });

  let ok = 0;
  let bad = 0;
  for (const r of replays) {
    try {
      const res = await fetch(`${base}/api/replay/object?id=${encodeURIComponent(r.id)}`, {
        headers: authHeaders,
      });
      if (!res.ok) {
        console.warn(`  ✗ ${r.id}: fetch ${res.status}`);
        bad += 1;
        continue;
      }
      const gz = Buffer.from(await res.arrayBuffer());
      const json = gunzipSync(gz).toString('utf8');
      const hash = createHash('sha256').update(json, 'utf8').digest('hex');
      if (hash !== r.sha256) {
        console.warn(`  ✗ ${r.id}: sha256 mismatch (manifest ${r.sha256?.slice(0, 12)}… got ${hash.slice(0, 12)}…)`);
        bad += 1;
        continue;
      }
      writeFileSync(join(outDir, `${r.id}.json`), json);
      ok += 1;
    } catch (err) {
      console.warn(`  ✗ ${r.id}: ${err.message}`);
      bad += 1;
    }
  }
  console.log(`\nDone. Verified+written: ${ok}, failed: ${bad}.`);
  if (bad > 0) process.exit(2);
}

main();

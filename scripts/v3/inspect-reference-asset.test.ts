import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { inspectV3ReferenceAssetForCli } from './inspect-reference-asset';

const tmp = join(process.cwd(), '.tmp-v3-inspect-test');
const removeTmp = () => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });

describe('inspectV3ReferenceAssetForCli', () => {
  it('writes sanitized review JSON without absolute source paths', () => {
    removeTmp();
    mkdirSync(tmp, { recursive: true });
    try {
      const objPath = join(tmp, 'synthetic.obj');
      const mtlPath = join(tmp, 'synthetic.mtl');
      const outPath = join(tmp, 'review.json');

      writeFileSync(objPath, [
        'mtllib synthetic.mtl',
        'o Helmet_Primary',
        'g Helmet',
        'usemtl armor_primary',
        'v 0 0 0',
        'v 1 0 0',
        'v 0 1 0',
        'f 1 2 3',
      ].join('\n'));
      writeFileSync(mtlPath, 'newmtl armor_primary\nKd 0.2 0.4 0.6\nmap_Kd private.png\n');

      const result = inspectV3ReferenceAssetForCli([
        '--obj', objPath,
        '--mtl', mtlPath,
        '--review-json',
        '--preview-resolution', '5',
        '--out', outPath,
      ]);

      const saved = readFileSync(outPath, 'utf8');
      assert.equal(result.mode, 'review-json');
      assert.equal(saved.includes(objPath), false);
      assert.equal(saved.includes('private.png'), false);
      assert.equal(JSON.parse(saved).source.baseName, 'synthetic.obj');
      assert.equal(JSON.parse(saved).parts[0].preview.resolution, 5);
    } finally {
      removeTmp();
    }
  });
});

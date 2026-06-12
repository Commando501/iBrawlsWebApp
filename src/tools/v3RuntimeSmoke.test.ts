import assert from 'node:assert/strict';
import test from 'node:test';
import {
  V3_RUNTIME_SMOKE_VIEWPORTS,
  buildV3RuntimeSmokeChecklist,
} from './v3RuntimeSmoke';

test('buildV3RuntimeSmokeChecklist includes desktop and mobile viewports', () => {
  assert.deepEqual(V3_RUNTIME_SMOKE_VIEWPORTS.map((viewport) => viewport.id), ['desktop', 'mobile']);
});

test('buildV3RuntimeSmokeChecklist covers every required Phase 13 browser surface', () => {
  const checklist = buildV3RuntimeSmokeChecklist();
  const routes = checklist.map((item) => item.path);

  assert.ok(routes.includes('/'));
  assert.ok(routes.includes('/armor-model-editor.html'));
  assert.ok(routes.includes('/v3-asset-preview.html'));
  assert.ok(routes.includes('/v3-performance-smoke.html?tier=mobileLow'));
  assert.ok(routes.includes('/v3-performance-smoke.html?tier=desktop'));
  assert.ok(checklist.every((item) => item.expectedText.length > 0));
  assert.ok(checklist.every((item) => item.viewports.length > 0));
});

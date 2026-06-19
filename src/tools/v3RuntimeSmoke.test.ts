import assert from 'node:assert/strict';
import test from 'node:test';
import {
  V3_RUNTIME_SMOKE_VIEWPORTS,
  buildV3RuntimeSmokeReport,
  buildV3RuntimeSmokeChecklist,
  type V3RuntimeSmokeObservation,
} from './v3RuntimeSmoke';

test('buildV3RuntimeSmokeChecklist includes desktop and mobile viewports', () => {
  assert.deepEqual(V3_RUNTIME_SMOKE_VIEWPORTS.map((viewport) => viewport.id), ['desktop', 'mobile']);
});

test('buildV3RuntimeSmokeChecklist covers every required Phase 31 browser surface', () => {
  const checklist = buildV3RuntimeSmokeChecklist();
  const routes = checklist.map((item) => item.path);
  const performanceItems = checklist.filter((item) => item.path.startsWith('/v3-performance-smoke.html'));
  const editorItem = checklist.find((item) => item.id === 'armor-editor-v3-validation');
  const mainMenuItem = checklist.find((item) => item.id === 'main-menu-model-policy');
  const dashboardItem = checklist.find((item) => item.id === 'readiness-dashboard-local-tooling');

  assert.ok(routes.includes('/'));
  assert.ok(routes.includes('/armor-model-editor.html'));
  assert.ok(routes.includes('/v3-asset-preview.html'));
  assert.ok(routes.includes('/v3-readiness-dashboard.html'));
  assert.ok(routes.includes('/v3-animation-atlas-smoke.html'));
  assert.ok(routes.includes('/v3-performance-smoke.html?tier=mobileLow'));
  assert.ok(routes.includes('/v3-performance-smoke.html?tier=desktop'));
  assert.ok(mainMenuItem?.expectedText.includes('V1'));
  assert.ok(mainMenuItem?.expectedText.includes('V2'));
  assert.equal(mainMenuItem?.expectedText.includes('V3'), false);
  assert.ok(dashboardItem?.expectedText.includes('V3 Readiness Dashboard'));
  assert.ok(dashboardItem?.expectedText.includes('Not Player Ready'));
  assert.ok(dashboardItem?.expectedText.includes('OBJ Canonical Reference'));
  assert.ok(dashboardItem?.expectedText.includes('Proportion Bands'));
  assert.ok(dashboardItem?.expectedText.includes('Choose Local Reference File'));
  assert.ok(dashboardItem?.expectedText.includes('Download Readiness Report'));
  assert.ok(dashboardItem?.expectedText.includes('Baseline Gaps'));
  assert.ok(dashboardItem?.expectedText.includes('Download Baseline Markdown'));
  assert.ok(dashboardItem?.expectedText.includes('Copy Baseline Markdown'));
  assert.ok(dashboardItem?.expectedText.includes('Calibration Candidates'));
  assert.ok(dashboardItem?.expectedText.includes('Download Calibration Report'));
  assert.ok(dashboardItem?.expectedText.includes('Copy Calibration Report'));
  assert.ok(dashboardItem?.expectedText.includes('Download Calibration JSON'));
  assert.ok(dashboardItem?.expectedText.includes('Copy Calibration JSON'));
  assert.ok(dashboardItem?.expectedText.includes('Rendered Gate Closure'));
  assert.ok(dashboardItem?.expectedText.includes('Reconstruction Required'));
  assert.ok(dashboardItem?.expectedText.includes('Static Body Baseline'));
  assert.ok(dashboardItem?.expectedText.includes('Reference Feature Match'));
  assert.ok(dashboardItem?.expectedText.includes('Exact OBJ Voxel Source'));
  assert.ok(dashboardItem?.expectedText.includes('Segmentation Review'));
  assert.ok(dashboardItem?.expectedText.includes('Motion Retarget'));
  const atlasItem = checklist.find((item) => item.id === 'animation-atlas-smoke-local-tooling');
  assert.ok(atlasItem?.expectedText.includes('V3 Animation Atlas Smoke'));
  assert.ok(atlasItem?.expectedText.includes('Play All'));
  assert.ok(atlasItem?.expectedText.includes('Normalized Review'));
  assert.ok(atlasItem?.expectedText.includes('Runtime Simulation'));
  assert.ok(atlasItem?.expectedText.includes('Hammer Strike'));
  assert.ok(performanceItems.every((item) => item.expectedText.includes('Phase 41 Ready')));
  assert.ok(performanceItems.every((item) => item.expectedText.includes('visual pass')));
  assert.ok(performanceItems.every((item) => item.expectedText.includes('motion pass')));
  assert.ok(performanceItems.every((item) => item.expectedText.includes('motion-retarget pass')));
  assert.ok(performanceItems.every((item) => item.expectedText.includes('LOD pass')));
  assert.ok(editorItem?.expectedText.includes('Motion QA'));
  assert.ok(editorItem?.expectedText.includes('Check Active Pose'));
  assert.ok(editorItem?.expectedText.includes('Hammer Strike'));
  assert.ok(editorItem?.expectedText.includes('Motion Fixes'));
  assert.ok(editorItem?.expectedText.includes('Apply Motion Fix'));
  assert.ok(editorItem?.expectedText.includes('Clear Limb Overlap'));
  assert.ok(editorItem?.expectedText.includes('Publish Check'));
  assert.ok(editorItem?.expectedText.includes('Review Suit'));
  assert.ok(editorItem?.expectedText.includes('Review Profile'));
  assert.ok(editorItem?.expectedText.includes('Jump to Issue'));
  assert.ok(checklist.every((item) => item.expectedText.length > 0));
  assert.ok(checklist.every((item) => item.viewports.length > 0));
});

const routeHasCanvas = (path: string): boolean =>
  path === '/v3-asset-preview.html' ||
  path === '/v3-readiness-dashboard.html' ||
  path === '/v3-animation-atlas-smoke.html' ||
  path.startsWith('/v3-performance-smoke.html');

const completeObservations = (): V3RuntimeSmokeObservation[] =>
  buildV3RuntimeSmokeChecklist().flatMap((item) => item.viewports.map((viewport) => ({
    itemId: item.id,
    viewport,
    title: item.expectedText[0],
    visibleText: item.expectedText.join(' '),
    rootChildCount: routeHasCanvas(item.path) ? 0 : 1,
    canvasCount: routeHasCanvas(item.path) ? 1 : 0,
    horizontalOverflow: false,
    performanceReady: item.path.startsWith('/v3-performance-smoke.html') ? true : undefined,
  })));

test('buildV3RuntimeSmokeReport fails when required browser observations are missing', () => {
  const report = buildV3RuntimeSmokeReport(completeObservations().slice(1));

  assert.equal(report.ready, false);
  assert.ok(report.missingObservations.some((entry) => entry.includes('main-menu-model-policy')));
});

test('buildV3RuntimeSmokeReport fails blank pages, missing expected text, overflow, and unready performance smoke', () => {
  const observations = completeObservations();
  observations[0] = {
    ...observations[0],
    visibleText: '',
    rootChildCount: 0,
    canvasCount: 0,
  };
  observations[1] = {
    ...observations[1],
    visibleText: 'Customization V1 V2',
  };
  const performanceIndex = observations.findIndex((entry) => entry.itemId === 'performance-smoke-mobile-low');
  observations[performanceIndex] = {
    ...observations[performanceIndex],
    performanceReady: false,
  };
  const editorIndex = observations.findIndex((entry) => entry.itemId === 'armor-editor-v3-validation');
  observations[editorIndex] = {
    ...observations[editorIndex],
    horizontalOverflow: true,
  };

  const report = buildV3RuntimeSmokeReport(observations);

  assert.equal(report.ready, false);
  assert.ok(report.failedObservations.some((entry) => entry.includes('blank')));
  assert.ok(report.failedObservations.some((entry) => entry.includes('missing expected text')));
  assert.ok(report.failedObservations.some((entry) => entry.includes('horizontal overflow')));
  assert.ok(report.failedObservations.some((entry) => entry.includes('performance smoke not ready')));
});

test('buildV3RuntimeSmokeReport passes only with observed desktop and mobile evidence', () => {
  const report = buildV3RuntimeSmokeReport(completeObservations());

  assert.equal(report.ready, true);
  assert.deepEqual(report.missingObservations, []);
  assert.deepEqual(report.failedObservations, []);
});

test('buildV3RuntimeSmokeReport matches visible text case-insensitively', () => {
  const observations = completeObservations().map((entry) => ({
    ...entry,
    title: entry.title.toUpperCase(),
    visibleText: entry.visibleText.toUpperCase(),
  }));

  const report = buildV3RuntimeSmokeReport(observations);

  assert.equal(report.ready, true, report.failedObservations.join(', '));
});

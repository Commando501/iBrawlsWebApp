import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REQUIRED_V3_PRODUCTION_PARITY_SURFACES,
  buildV3ProductionParityReport,
  type V3ProductionParityEvidence,
} from './v3ProductionParityAudit';

const passingEvidence = (
  surface: V3ProductionParityEvidence['surface']
): V3ProductionParityEvidence => ({
  surface,
  status: 'pass',
  modelPolicies: ['v1', 'v2', 'v3'],
  desktopCovered: true,
  mobileCovered: true,
  notes: `${surface} verified`,
});

test('buildV3ProductionParityReport fails when required surfaces are missing', () => {
  const report = buildV3ProductionParityReport([
    passingEvidence('offline'),
    passingEvidence('host'),
  ]);

  assert.equal(report.ready, false);
  assert.ok(report.missingSurfaces.includes('replay'));
  assert.ok(report.missingSurfaces.includes('firstPerson'));
});

test('buildV3ProductionParityReport requires V1 V2 and V3 policy coverage', () => {
  const entries = REQUIRED_V3_PRODUCTION_PARITY_SURFACES.map(passingEvidence);
  entries[0] = {
    ...entries[0],
    modelPolicies: ['v3'],
  };

  const report = buildV3ProductionParityReport(entries);

  assert.equal(report.ready, false);
  assert.deepEqual(report.incompleteSurfaces, ['offline']);
});

test('buildV3ProductionParityReport requires desktop and mobile coverage', () => {
  const entries = REQUIRED_V3_PRODUCTION_PARITY_SURFACES.map(passingEvidence);
  entries[1] = {
    ...entries[1],
    mobileCovered: false,
  };

  const report = buildV3ProductionParityReport(entries);

  assert.equal(report.ready, false);
  assert.deepEqual(report.incompleteSurfaces, ['host']);
});

test('buildV3ProductionParityReport passes only with every required surface covered', () => {
  const report = buildV3ProductionParityReport(
    REQUIRED_V3_PRODUCTION_PARITY_SURFACES.map(passingEvidence)
  );

  assert.equal(report.ready, true);
  assert.deepEqual(report.missingSurfaces, []);
  assert.deepEqual(report.failedSurfaces, []);
  assert.deepEqual(report.incompleteSurfaces, []);
});

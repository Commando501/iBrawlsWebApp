import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { V3LodLevel } from './v3ModelTypes';
import { validateV3AssetBudget } from './v3ModelTypes';
import { getDefaultV3WeaponManifest } from './v3AssetManifest';
import { getV3QualityTierRank, selectV3LodLevel } from './v3Lod';

const budget = {
  sourceVoxelCount: 120,
  mergedBoxCount: 40,
  materialGroupCount: 2,
  drawCallEstimate: 2,
  lodCount: 1,
  memoryEstimateKb: 24,
};

const sampleLods: V3LodLevel[] = [
  {
    id: 'sample:ultra',
    sourceId: 'sample:source-ultra',
    qualityTier: 'ultra',
    maxDistance: 8,
    budget: { ...budget, sourceVoxelCount: 420 },
  },
  {
    id: 'sample:desktop',
    sourceId: 'sample:source-desktop',
    qualityTier: 'desktop',
    maxDistance: 18,
    budget: { ...budget, sourceVoxelCount: 280 },
  },
  {
    id: 'sample:mobile',
    sourceId: 'sample:source-mobile',
    qualityTier: 'mobile',
    maxDistance: 9999,
    budget: { ...budget, sourceVoxelCount: 120 },
  },
];

describe('getV3QualityTierRank', () => {
  it('orders quality tiers from cheapest to richest', () => {
    assert.equal(getV3QualityTierRank('mobileLow') < getV3QualityTierRank('mobile'), true);
    assert.equal(getV3QualityTierRank('mobile') < getV3QualityTierRank('desktop'), true);
    assert.equal(getV3QualityTierRank('desktop') < getV3QualityTierRank('ultra'), true);
  });
});

describe('selectV3LodLevel', () => {
  it('prefers lower-detail entries on mobile tiers', () => {
    assert.equal(selectV3LodLevel({ lods: sampleLods, qualityTier: 'mobileLow', distance: 2 }).qualityTier, 'mobile');
    assert.equal(selectV3LodLevel({ lods: sampleLods, qualityTier: 'mobile', distance: 2 }).qualityTier, 'mobile');
  });

  it('uses richer entries on desktop and ultra when close enough', () => {
    assert.equal(selectV3LodLevel({ lods: sampleLods, qualityTier: 'desktop', distance: 2 }).qualityTier, 'desktop');
    assert.equal(selectV3LodLevel({ lods: sampleLods, qualityTier: 'ultra', distance: 2 }).qualityTier, 'ultra');
  });

  it('downgrades to cheaper LODs as distance increases', () => {
    assert.equal(selectV3LodLevel({ lods: sampleLods, qualityTier: 'ultra', distance: 12 }).qualityTier, 'desktop');
    assert.equal(selectV3LodLevel({ lods: sampleLods, qualityTier: 'ultra', distance: 40 }).qualityTier, 'mobile');
  });

  it('falls back to a safe lowest-detail level for missing or malformed LOD lists', () => {
    const emptyFallback = selectV3LodLevel({ lods: [], qualityTier: 'ultra', distance: 2 });
    const malformedFallback = selectV3LodLevel({
      lods: [{ ...sampleLods[0], id: '', sourceId: '', budget: { ...budget, sourceVoxelCount: 0 } }],
      qualityTier: 'ultra',
      distance: 2,
    });

    assert.equal(emptyFallback.qualityTier, 'mobileLow');
    assert.equal(malformedFallback.qualityTier, 'mobileLow');
    assert.deepEqual(validateV3AssetBudget(emptyFallback.budget), []);
    assert.equal(emptyFallback.sourceId, malformedFallback.sourceId);
  });

  it('returns selected LOD entries with stable source ids and budget metadata', () => {
    const hammer = getDefaultV3WeaponManifest('hammer');
    const lod = selectV3LodLevel({ lods: hammer.lods, qualityTier: 'ultra', distance: 2 });

    assert.equal(lod.sourceId.includes(hammer.id), true);
    assert.deepEqual(validateV3AssetBudget(lod.budget), []);
  });
});

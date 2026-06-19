import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ATMOSPHERE_SETTING_KEYS,
  SKYBOX_TEXTURE_IDS,
  SKYBOX_PRESETS,
  clampAtmosphereSettings,
  normalizeSkyboxFogColor,
  resolveSkyboxAtmosphereSettings,
  resolveSkyboxTextureId,
  resolveSkyboxTextureSize,
} from './skyboxTextures';
import { resolveCloudLayerPlan } from '../components/grifball/skyAtmosphereRuntime';

const EXPECTED_SKYBOX_IDS = [
  'cyberpunk',
  'hangar',
  'nature',
  'space',
  'fantasy',
  'forerunner',
  'synthwave',
  'rainy_streets',
  'winter_rink',
  'grifball_stadium',
  'holodeck',
  'rust',
  'toxic',
  'inferno',
  'matrix',
  'nebula',
] as const;

test('skybox presets cover every supported texture id', () => {
  assert.deepEqual(SKYBOX_TEXTURE_IDS, EXPECTED_SKYBOX_IDS);

  for (const id of SKYBOX_TEXTURE_IDS) {
    const preset = SKYBOX_PRESETS[id];
    assert.equal(preset.id, id);
    assert.equal(typeof preset.label, 'string');
    assert.ok(preset.label.length > 0);
    assert.equal(typeof preset.description, 'string');
    assert.ok(preset.description.length > 0);

    for (const value of Object.values(preset.atmosphere)) {
      assert.equal(Number.isFinite(value), true);
      assert.equal(value >= 0 && value <= 100, true);
    }
  }
});

test('unknown skybox ids fall back to cyberpunk', () => {
  assert.equal(resolveSkyboxTextureId('space'), 'space');
  assert.equal(resolveSkyboxTextureId('missing'), 'cyberpunk');
  assert.equal(resolveSkyboxTextureId(''), 'cyberpunk');
  assert.equal(resolveSkyboxTextureId(undefined), 'cyberpunk');
});

test('skybox fog color accepts runtime hsl colors for canvas gradients', () => {
  const normalized = normalizeSkyboxFogColor('hsl(224, 70%, 4%)');

  assert.match(normalized, /^#[0-9a-f]{6}$/);
  assert.notEqual(normalized, '#000000');
});

test('atmosphere settings merge with preset defaults and clamp user values', () => {
  const defaults = SKYBOX_PRESETS.space.atmosphere;
  const resolved = resolveSkyboxAtmosphereSettings('space', {
    motion: 150,
    clouds: -20,
    haze: 41.6,
    stars: Number.NaN,
    weather: 25,
  });

  assert.equal(resolved.motion, 100);
  assert.equal(resolved.clouds, 0);
  assert.equal(resolved.haze, 42);
  assert.equal(resolved.stars, defaults.stars);
  assert.equal(resolved.weather, 25);
  assert.equal(resolved.energy, defaults.energy);
});

test('atmosphere clamping rejects non-finite values without losing defaults', () => {
  const clamped = clampAtmosphereSettings({
    lightning: Number.POSITIVE_INFINITY,
    celestial: 12.2,
  }, {
    ...SKYBOX_PRESETS.inferno.atmosphere,
    lightning: 77,
  });

  assert.equal(clamped.lightning, 77);
  assert.equal(clamped.celestial, 12);
});

test('adaptive texture sizing uses hd only on capable non-mobile devices', () => {
  assert.deepEqual(resolveSkyboxTextureSize({
    maxTextureSize: 8192,
    devicePixelRatio: 2,
    isMobile: false,
  }), { width: 4096, height: 2048, quality: 'hd' });

  assert.deepEqual(resolveSkyboxTextureSize({
    maxTextureSize: 2048,
    devicePixelRatio: 2,
    isMobile: false,
  }), { width: 2048, height: 1024, quality: 'standard' });

  assert.deepEqual(resolveSkyboxTextureSize({
    maxTextureSize: 8192,
    devicePixelRatio: 3,
    isMobile: true,
  }), { width: 2048, height: 1024, quality: 'standard' });
});

test('standalone map maker skybox options match runtime ids', () => {
  const html = readFileSync('mapmaker.html', 'utf8');
  const optionValues = [...html.matchAll(/<option value="([^"]+)" \$\{skyboxTexture===/g)]
    .map((match) => match[1])
    .filter((value) => value !== 'matched');

  assert.deepEqual(optionValues, [...SKYBOX_TEXTURE_IDS]);

  for (const key of ATMOSPHERE_SETTING_KEYS) {
    assert.match(html, new RegExp(`'${key}'`));
  }
  assert.match(html, /handleAtmosphereControl\('\$\{key\}'/);
  assert.match(html, /atmosphere: resolveAtmosphereSettings/);
  assert.match(html, /data\.atmosphere/);
  assert.match(html, /pm\.atmosphere/);
  assert.match(html, /handleResetAtmosphereControls/);
  assert.match(html, /resolveMapmakerCloudLayerPlan/);
  assert.match(html, /THREE\.InstancedMesh/);
  assert.match(html, /cloud_layer/);
});

test('cloud layer plan caps high density clouds into deterministic deck layers', () => {
  const layers = resolveCloudLayerPlan(100);

  assert.equal(layers.length, 3);
  assert.deepEqual(layers.map((layer) => layer.instanceCount), [18, 14, 10]);
  assert.equal(layers.every((layer) => layer.instanceCount <= 18), true);
  assert.equal(layers.every((layer) => layer.opacity <= 0.46), true);
  assert.equal(layers.every((layer) => layer.driftSpeed > 0), true);
});

test('cloud layer plan keeps low and disabled cloud settings cheap', () => {
  assert.deepEqual(resolveCloudLayerPlan(0), []);

  const layers = resolveCloudLayerPlan(12);

  assert.equal(layers.length, 1);
  assert.equal(layers[0].instanceCount, 5);
  assert.equal(layers[0].height, 58);
});

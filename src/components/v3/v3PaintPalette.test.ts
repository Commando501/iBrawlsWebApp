import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveV3RoleColor,
  resolveV3RoleEmissive,
  sanitizeV3RolePaintPayload,
} from './v3PaintPalette';

const base = {
  primary: '#111111',
  secondary: '#222222',
  accent: '#333333',
  visor: '#444444',
  dark: '#050505',
  highlight: '#777777',
};

describe('v3PaintPalette', () => {
  it('sanitizes V3 role colors and emissive flags by manifest role', () => {
    const sanitized = sanitizeV3RolePaintPayload({
      v3RoleColors: {
        primary: '#Aa00ff',
        visor: '#00ffaa',
        invalidRole: '#ffffff',
        accent: 'not-a-color',
      },
      v3RoleEmissive: {
        visor: true,
        primary: false,
        fixed: true,
        invalidRole: true,
      },
    });

    assert.deepEqual(sanitized, {
      v3RoleColors: { primary: '#aa00ff', visor: '#00ffaa' },
      v3RoleEmissive: { primary: false, visor: true, fixed: true },
    });
  });

  it('resolves V3 role colors with paint overrides before hue defaults', () => {
    const paintJob = { v3RoleColors: { primary: '#abcdef', undersuit: '#123456' } };

    assert.equal(resolveV3RoleColor('primary', base, paintJob), '#abcdef');
    assert.equal(resolveV3RoleColor('undersuit', base, paintJob), '#123456');
    assert.equal(resolveV3RoleColor('secondary', base, paintJob), '#222222');
    assert.equal(resolveV3RoleColor('emissive', base, paintJob), '#777777');
    assert.equal(resolveV3RoleColor('decal', base, paintJob), '#f8fafc');
    assert.equal(resolveV3RoleColor('fixed', base, paintJob), '#27272a');
  });

  it('resolves emissive flags with safe defaults', () => {
    const paintJob = { v3RoleEmissive: { primary: true, visor: false } };

    assert.equal(resolveV3RoleEmissive('primary', paintJob, false), true);
    assert.equal(resolveV3RoleEmissive('visor', paintJob, true), false);
    assert.equal(resolveV3RoleEmissive('accent', paintJob, true), true);
  });
});

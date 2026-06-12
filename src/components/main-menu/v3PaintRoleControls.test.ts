import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resetV3PaintRole,
  updateV3PaintRoleColor,
  updateV3PaintRoleEmissive,
} from './v3PaintRoleControls';

test('updateV3PaintRoleColor stores lowercase hex colors without disturbing legacy paint', () => {
  const next = updateV3PaintRoleColor({
    helmet: { '0,0,0': '#ffffff' },
    v3RoleColors: { primary: '#111111' },
  }, 'visor', '#ABCDEF');

  assert.deepEqual(next.helmet, { '0,0,0': '#ffffff' });
  assert.deepEqual(next.v3RoleColors, { primary: '#111111', visor: '#abcdef' });
});

test('updateV3PaintRoleEmissive stores explicit boolean role flags', () => {
  const next = updateV3PaintRoleEmissive({ v3RoleEmissive: { visor: true } }, 'primary', true);

  assert.deepEqual(next.v3RoleEmissive, { primary: true, visor: true });
});

test('resetV3PaintRole removes both color and emissive overrides for one role', () => {
  const next = resetV3PaintRole({
    v3RoleColors: { primary: '#111111', visor: '#222222' },
    v3RoleEmissive: { primary: true, visor: false },
  }, 'primary');

  assert.deepEqual(next.v3RoleColors, { visor: '#222222' });
  assert.deepEqual(next.v3RoleEmissive, { visor: false });
});

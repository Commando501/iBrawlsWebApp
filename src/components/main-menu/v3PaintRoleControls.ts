import type { ArmorPaintJob } from '../VoxelModels';
import type { V3PaintRole } from '../v3/v3ModelTypes';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function updateV3PaintRoleColor(
  paintJob: ArmorPaintJob | undefined,
  role: V3PaintRole,
  color: string
): ArmorPaintJob {
  const normalized = HEX_COLOR.test(color) ? color.toLowerCase() : '#ffffff';
  return {
    ...(paintJob ?? {}),
    v3RoleColors: {
      ...(paintJob?.v3RoleColors ?? {}),
      [role]: normalized,
    },
  };
}

export function updateV3PaintRoleEmissive(
  paintJob: ArmorPaintJob | undefined,
  role: V3PaintRole,
  emissive: boolean
): ArmorPaintJob {
  return {
    ...(paintJob ?? {}),
    v3RoleEmissive: {
      ...(paintJob?.v3RoleEmissive ?? {}),
      [role]: emissive,
    },
  };
}

export function resetV3PaintRole(
  paintJob: ArmorPaintJob | undefined,
  role: V3PaintRole
): ArmorPaintJob {
  const v3RoleColors = { ...(paintJob?.v3RoleColors ?? {}) };
  const v3RoleEmissive = { ...(paintJob?.v3RoleEmissive ?? {}) };
  delete v3RoleColors[role];
  delete v3RoleEmissive[role];
  return {
    ...(paintJob ?? {}),
    v3RoleColors,
    v3RoleEmissive,
  };
}

import type { ArmorPaintJob } from '../VoxelModels';
import { V3_PAINT_ROLES, type V3PaintRole } from './v3ModelTypes';

export interface V3BasePaintColors {
  primary: string;
  secondary: string;
  accent: string;
  visor: string;
  dark: string;
  highlight: string;
}

export interface SanitizedV3RolePaintPayload {
  v3RoleColors?: Partial<Record<V3PaintRole, string>>;
  v3RoleEmissive?: Partial<Record<V3PaintRole, boolean>>;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const ROLE_SET = new Set<string>(V3_PAINT_ROLES);

const sanitizeColorMap = (value: unknown): Partial<Record<V3PaintRole, string>> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const output: Partial<Record<V3PaintRole, string>> = {};
  for (const [role, color] of Object.entries(value)) {
    if (!ROLE_SET.has(role) || typeof color !== 'string' || !HEX_COLOR.test(color)) continue;
    output[role as V3PaintRole] = color.toLowerCase();
  }
  return Object.keys(output).length > 0 ? output : undefined;
};

const sanitizeEmissiveMap = (value: unknown): Partial<Record<V3PaintRole, boolean>> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const output: Partial<Record<V3PaintRole, boolean>> = {};
  for (const [role, enabled] of Object.entries(value)) {
    if (!ROLE_SET.has(role) || typeof enabled !== 'boolean') continue;
    output[role as V3PaintRole] = enabled;
  }
  return Object.keys(output).length > 0 ? output : undefined;
};

export function sanitizeV3RolePaintPayload(value: unknown): SanitizedV3RolePaintPayload {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as { v3RoleColors?: unknown; v3RoleEmissive?: unknown }
    : {};
  const colors = sanitizeColorMap(raw.v3RoleColors);
  const emissive = sanitizeEmissiveMap(raw.v3RoleEmissive);
  return {
    ...(colors ? { v3RoleColors: colors } : {}),
    ...(emissive ? { v3RoleEmissive: emissive } : {}),
  };
}

export function resolveV3RoleColor(
  role: V3PaintRole | string,
  base: V3BasePaintColors,
  paintJob?: Pick<ArmorPaintJob, 'v3RoleColors'>
): string {
  const override = paintJob?.v3RoleColors?.[role as V3PaintRole];
  if (override && HEX_COLOR.test(override)) return override.toLowerCase();
  if (role === 'secondary') return base.secondary;
  if (role === 'accent') return base.accent;
  if (role === 'undersuit') return base.dark;
  if (role === 'visor') return base.visor;
  if (role === 'emissive') return base.highlight;
  if (role === 'decal') return '#f8fafc';
  if (role === 'fixed') return '#27272a';
  return base.primary;
}

export function resolveV3RoleEmissive(
  role: V3PaintRole | string,
  paintJob: Pick<ArmorPaintJob, 'v3RoleEmissive'> | undefined,
  fallback: boolean
): boolean {
  const override = paintJob?.v3RoleEmissive?.[role as V3PaintRole];
  return typeof override === 'boolean' ? override : fallback;
}

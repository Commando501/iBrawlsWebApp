import * as THREE from 'three';
import type { TeamId } from '../../game/teamScoring';

export const BLUE_TEAM_OUTLINE_COLOR = '#38bdf8';
export const RED_TEAM_OUTLINE_COLOR = '#fb7185';
export const UNKNOWN_TEAM_OUTLINE_COLOR = '#e5e7eb';
export const DEFAULT_TEAM_OUTLINE_THICKNESS = 0.08;
export const DEFAULT_TEAM_OUTLINE_BRIGHTNESS = 0.72;
export const DEFAULT_TEAM_OUTLINE_COLOR_MODE: TeamOutlineColorMode = 'team';
export const DEFAULT_TEAM_OUTLINE_COLOR = BLUE_TEAM_OUTLINE_COLOR;

const MIN_TEAM_OUTLINE_THICKNESS = 0.02;
const MAX_TEAM_OUTLINE_THICKNESS = 0.2;
const MIN_TEAM_OUTLINE_BRIGHTNESS = 0.1;
const MAX_TEAM_OUTLINE_BRIGHTNESS = 1.0;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export type TeamOutlineColorMode = 'team' | 'custom';

export interface CombatantTeamOutlineOptions {
  teamOutlineThickness?: number;
  teamOutlineBrightness?: number;
  teamOutlineColorMode?: TeamOutlineColorMode;
  teamOutlineColor?: string;
  thickness?: number;
  brightness?: number;
  colorMode?: TeamOutlineColorMode;
  customColor?: string;
}

export interface ResolvedCombatantTeamOutlineSettings {
  thickness: number;
  brightness: number;
  colorMode: TeamOutlineColorMode;
  color: string;
}

export interface CombatantTeamOutlineMesh {
  source: THREE.Mesh;
  mesh: THREE.Mesh;
}

export interface CombatantTeamOutlineState {
  team: TeamId;
  material: THREE.MeshBasicMaterial;
  meshes: CombatantTeamOutlineMesh[];
}

type CombatantTeamOutlineUserData = THREE.Object3D['userData'] & {
  teamOutlineSources?: THREE.Mesh[];
  teamOutlineState?: CombatantTeamOutlineState;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const getCombatantTeamOutlineColor = (team: TeamId | null | undefined): string => {
  if (team === 'blue') return BLUE_TEAM_OUTLINE_COLOR;
  if (team === 'red') return RED_TEAM_OUTLINE_COLOR;
  return UNKNOWN_TEAM_OUTLINE_COLOR;
};

export const resolveCombatantTeamOutlineSettings = (
  options?: CombatantTeamOutlineOptions | null
): ResolvedCombatantTeamOutlineSettings => {
  const rawThickness = options?.teamOutlineThickness ?? options?.thickness ?? DEFAULT_TEAM_OUTLINE_THICKNESS;
  const rawBrightness = options?.teamOutlineBrightness ?? options?.brightness ?? DEFAULT_TEAM_OUTLINE_BRIGHTNESS;
  const rawColorMode = options?.teamOutlineColorMode ?? options?.colorMode ?? DEFAULT_TEAM_OUTLINE_COLOR_MODE;
  const rawColor = options?.teamOutlineColor ?? options?.customColor ?? DEFAULT_TEAM_OUTLINE_COLOR;
  return {
    thickness: clamp(Number.isFinite(rawThickness) ? rawThickness : DEFAULT_TEAM_OUTLINE_THICKNESS, MIN_TEAM_OUTLINE_THICKNESS, MAX_TEAM_OUTLINE_THICKNESS),
    brightness: clamp(Number.isFinite(rawBrightness) ? rawBrightness : DEFAULT_TEAM_OUTLINE_BRIGHTNESS, MIN_TEAM_OUTLINE_BRIGHTNESS, MAX_TEAM_OUTLINE_BRIGHTNESS),
    colorMode: rawColorMode === 'custom' ? 'custom' : 'team',
    color: HEX_COLOR_PATTERN.test(rawColor) ? rawColor : DEFAULT_TEAM_OUTLINE_COLOR,
  };
};

const resolveOutlineColor = (
  team: TeamId,
  settings: ResolvedCombatantTeamOutlineSettings
): string =>
  settings.colorMode === 'custom'
    ? settings.color
    : getCombatantTeamOutlineColor(team);

const getOutlineUserData = (root: THREE.Group): CombatantTeamOutlineUserData =>
  root.userData as CombatantTeamOutlineUserData;

const isOutlineMesh = (object: THREE.Object3D): boolean =>
  object.userData?.teamOutlineMesh === true;

const collectBodyMeshes = (root: THREE.Group): THREE.Mesh[] => {
  const meshes: THREE.Mesh[] = [];
  root.traverse((child) => {
    if (child instanceof THREE.Mesh && !isOutlineMesh(child)) {
      meshes.push(child);
    }
  });
  return meshes;
};

export const registerCombatantTeamOutlineSources = (root: THREE.Group): THREE.Mesh[] => {
  const sources = collectBodyMeshes(root);
  getOutlineUserData(root).teamOutlineSources = sources;
  return sources;
};

export const getCombatantTeamOutlineState = (
  root: THREE.Group
): CombatantTeamOutlineState | null =>
  getOutlineUserData(root).teamOutlineState ?? null;

const createOutlineMaterial = (
  team: TeamId,
  settings: ResolvedCombatantTeamOutlineSettings
): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({
    color: new THREE.Color(resolveOutlineColor(team, settings)),
    transparent: true,
    opacity: settings.brightness,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

const createOutlineMesh = (
  source: THREE.Mesh,
  material: THREE.MeshBasicMaterial,
  settings: ResolvedCombatantTeamOutlineSettings
): THREE.Mesh | null => {
  const parent = source.parent;
  if (!parent) return null;

  const outline = new THREE.Mesh(source.geometry, material);
  outline.name = `${source.name || 'combatant'}_team_outline`;
  outline.position.copy(source.position);
  outline.quaternion.copy(source.quaternion);
  outline.scale.copy(source.scale).multiplyScalar(1 + settings.thickness);
  outline.renderOrder = source.renderOrder + 1;
  outline.frustumCulled = source.frustumCulled;
  outline.userData.teamOutlineMesh = true;
  outline.userData.teamOutlineSourceName = source.name;
  parent.add(outline);
  return outline;
};

export const removeCombatantTeamOutline = (root: THREE.Group): void => {
  const userData = getOutlineUserData(root);
  const state = userData.teamOutlineState;
  if (!state) return;

  state.meshes.forEach(({ mesh }) => {
    mesh.parent?.remove(mesh);
  });
  state.material.dispose();
  delete userData.teamOutlineState;
};

export const syncCombatantTeamOutline = (
  root: THREE.Group,
  team: TeamId | null | undefined,
  options?: CombatantTeamOutlineOptions | null
): CombatantTeamOutlineState | null => {
  if (!team) {
    removeCombatantTeamOutline(root);
    return null;
  }

  const settings = resolveCombatantTeamOutlineSettings(options);
  const userData = getOutlineUserData(root);
  const existing = userData.teamOutlineState;
  if (existing) {
    existing.team = team;
    existing.material.color.set(resolveOutlineColor(team, settings));
    existing.material.opacity = settings.brightness;
    existing.meshes.forEach(({ source, mesh }) => {
      mesh.scale.copy(source.scale).multiplyScalar(1 + settings.thickness);
    });
    return existing;
  }

  const sources = userData.teamOutlineSources ?? registerCombatantTeamOutlineSources(root);
  const material = createOutlineMaterial(team, settings);
  const meshes = sources.flatMap((source): CombatantTeamOutlineMesh[] => {
    const mesh = createOutlineMesh(source, material, settings);
    return mesh ? [{ source, mesh }] : [];
  });

  if (meshes.length === 0) {
    material.dispose();
    return null;
  }

  const state: CombatantTeamOutlineState = { team, material, meshes };
  userData.teamOutlineState = state;
  return state;
};

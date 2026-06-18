import * as THREE from 'three';
import type { TeamId } from '../../game/teamScoring';

export const BLUE_TEAM_OUTLINE_COLOR = '#38bdf8';
export const RED_TEAM_OUTLINE_COLOR = '#fb7185';
export const UNKNOWN_TEAM_OUTLINE_COLOR = '#e5e7eb';

const TEAM_OUTLINE_OPACITY = 0.34;
const TEAM_OUTLINE_SCALE = 1.045;

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

export const getCombatantTeamOutlineColor = (team: TeamId | null | undefined): string => {
  if (team === 'blue') return BLUE_TEAM_OUTLINE_COLOR;
  if (team === 'red') return RED_TEAM_OUTLINE_COLOR;
  return UNKNOWN_TEAM_OUTLINE_COLOR;
};

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

const createOutlineMaterial = (team: TeamId): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({
    color: new THREE.Color(getCombatantTeamOutlineColor(team)),
    transparent: true,
    opacity: TEAM_OUTLINE_OPACITY,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

const createOutlineMesh = (
  source: THREE.Mesh,
  material: THREE.MeshBasicMaterial
): THREE.Mesh | null => {
  const parent = source.parent;
  if (!parent) return null;

  const outline = new THREE.Mesh(source.geometry, material);
  outline.name = `${source.name || 'combatant'}_team_outline`;
  outline.position.copy(source.position);
  outline.quaternion.copy(source.quaternion);
  outline.scale.copy(source.scale).multiplyScalar(TEAM_OUTLINE_SCALE);
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
  team: TeamId | null | undefined
): CombatantTeamOutlineState | null => {
  if (!team) {
    removeCombatantTeamOutline(root);
    return null;
  }

  const userData = getOutlineUserData(root);
  const existing = userData.teamOutlineState;
  if (existing) {
    existing.team = team;
    existing.material.color.set(getCombatantTeamOutlineColor(team));
    return existing;
  }

  const sources = userData.teamOutlineSources ?? registerCombatantTeamOutlineSources(root);
  const material = createOutlineMaterial(team);
  const meshes = sources.flatMap((source): CombatantTeamOutlineMesh[] => {
    const mesh = createOutlineMesh(source, material);
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

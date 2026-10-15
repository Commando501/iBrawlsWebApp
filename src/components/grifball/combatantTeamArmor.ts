import * as THREE from 'three';
import type { TeamId } from '../../game/teamScoring';
import type { GrifballRuntimeState } from './runtimeState';

export const FRIENDLY_ARMOR_COLOR = '#2563eb';
export const ENEMY_ARMOR_COLOR = '#dc2626';
export const RUNNER_ARMOR_COLOR = '#fbbf24';

export interface CombatantTeamArmorState {
  team: TeamId;
  friendlyTeam: TeamId;
  carrying: boolean;
  material: THREE.MeshStandardMaterial;
  meshes: { source: THREE.Mesh; originalMaterial: THREE.Material | THREE.Material[] }[];
}

export function resolveFriendlyArmorTeam(state: Pick<GrifballRuntimeState, 'multiplayerRole' | 'observerTarget' | 'localPlayerTeam'>): TeamId {
  return state.multiplayerRole === 'observer'
    ? state.observerTarget === 'client' ? 'red' : 'blue'
    : state.localPlayerTeam;
}

/** Register the body before weapons and ball effects are attached. */
export function registerCombatantTeamArmorSources(root: THREE.Group): THREE.Mesh[] {
  const sources: THREE.Mesh[] = [];
  root.traverse(object => { if (object instanceof THREE.Mesh && !object.userData.ironVanguardWeapon) sources.push(object); });
  root.userData.teamArmorSources = sources;
  return sources;
}

export function getCombatantTeamArmorState(root: THREE.Group): CombatantTeamArmorState | null {
  return root.userData.teamArmorState ?? null;
}

export function syncCombatantTeamArmor(root: THREE.Group, team: TeamId | null | undefined, friendlyTeam: TeamId = 'blue'): CombatantTeamArmorState | null {
  let state = getCombatantTeamArmorState(root);
  if (!team) {
    if (state) {
      for (const { source, originalMaterial } of state.meshes) {
        source.material = originalMaterial;
        delete source.userData.teamArmorMesh;
      }
      state.material.dispose();
      delete root.userData.teamArmorState;
    }
    return null;
  }
  if (!state) {
    const sources: THREE.Mesh[] = root.userData.teamArmorSources ?? registerCombatantTeamArmorSources(root);
    // Model-owned material: never mutate shared palettes or geometry colors.
    const material = new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.15 });
    state = { team, friendlyTeam, carrying: false, material, meshes: sources.map(source => ({ source, originalMaterial: source.material })) };
    for (const { source } of state.meshes) {
      source.material = material;
      source.userData.teamArmorMesh = true;
    }
    root.userData.teamArmorState = state;
  }
  state.team = team;
  state.friendlyTeam = friendlyTeam;
  applyArmorColor(state);
  return state;
}

const applyArmorColor = (state: CombatantTeamArmorState): void => {
  state.material.color.set(state.carrying
    ? RUNNER_ARMOR_COLOR
    : state.team === state.friendlyTeam ? FRIENDLY_ARMOR_COLOR : ENEMY_ARMOR_COLOR);
};

/** Possession takes priority over team paint, including during perspective changes. */
export function syncCombatantRunnerArmor(root: THREE.Group, carrying: boolean): void {
  const state = getCombatantTeamArmorState(root);
  if (!state) return;
  state.carrying = carrying;
  applyArmorColor(state);
}

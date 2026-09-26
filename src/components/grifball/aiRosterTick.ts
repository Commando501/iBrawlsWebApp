import * as THREE from 'three';
import { type Combatant } from '../../types';
import { getCombatantMesh } from './combatantMeshLookup';
import { type GrifballThreeRefs } from './threeRefs';

export function updateAIRosterTick({
  refs,
  rosterAI,
  dt,
  respawnCombatant,
  updateSingleAIEntity,
  beforeUpdate,
}: {
  refs: GrifballThreeRefs;
  rosterAI: Combatant[];
  dt: number;
  respawnCombatant: (combatant: Combatant, mesh: THREE.Object3D) => void;
  updateSingleAIEntity: (combatantId: string, dt: number) => void;
  beforeUpdate?: () => void;
}): void {
  rosterAI.forEach((combatant) => {
    if (combatant.controller !== 'ai') return;
    const mesh = getCombatantMesh(refs, combatant.id);
    if (!mesh) return;
    if (combatant.hp > 0) return;

    mesh.visible = false;
    combatant.respawnTimer = Math.max(0, (combatant.respawnTimer ?? 0) - dt);
    if (combatant.respawnTimer <= 0) {
      respawnCombatant(combatant, mesh);
    }
  });

  beforeUpdate?.();

  rosterAI.forEach((combatant) => {
    if (combatant.controller !== 'ai') return;
    const mesh = getCombatantMesh(refs, combatant.id);
    if (!mesh) return;
    if (combatant.hp <= 0) return;

    mesh.visible = true;
    updateSingleAIEntity(combatant.id, dt);
  });
}

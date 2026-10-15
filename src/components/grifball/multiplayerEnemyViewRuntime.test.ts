import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { buildMultiplayerEnemyViewForRefs } from './multiplayerEnemyViewRuntime';
import { getCombatantTeamArmorState } from './combatantTeamArmor';

test('multiplayer enemy view can attach a Grifball solid team armor', () => {
  const refs = createInitialGrifballThreeRefs();
  const scene = new THREE.Scene();

  buildMultiplayerEnemyViewForRefs({
    refs,
    scene,
    mainAIHue: 0,
    teamArmorTeam: 'red',
  });

  assert.ok(refs.enemyGroup);
  assert.equal(getCombatantTeamArmorState(refs.enemyGroup)?.team, 'red');
});

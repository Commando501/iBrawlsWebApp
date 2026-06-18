import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { buildMultiplayerEnemyViewForRefs } from './multiplayerEnemyViewRuntime';
import { getCombatantTeamOutlineState } from './combatantTeamOutlines';

test('multiplayer enemy view can attach a Grifball team body outline', () => {
  const refs = createInitialGrifballThreeRefs();
  const scene = new THREE.Scene();

  buildMultiplayerEnemyViewForRefs({
    refs,
    scene,
    mainAIHue: 0,
    teamOutlineTeam: 'red',
  });

  assert.ok(refs.enemyGroup);
  assert.equal(getCombatantTeamOutlineState(refs.enemyGroup)?.team, 'red');
});

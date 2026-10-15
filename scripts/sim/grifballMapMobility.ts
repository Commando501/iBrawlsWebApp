import * as THREE from 'three';
import { PREMADE_MAPS } from '../../src/game/premadeMaps';
import { toGrifballArena } from '../../src/game/grifballMaps';
import { getRectHalfExtents } from '../../src/game/arenaDimensions';
import { createOfflineBotCombatant } from '../../src/game/roster';
import { DEFAULT_ADMIN_SETTINGS } from '../../src/settings/gameplaySettings';
import { createInitialGrifballRuntimeState } from '../../src/components/grifball/runtimeState';
import { createInitialGrifballThreeRefs } from '../../src/components/grifball/threeRefs';
import { createArenaCollisionCallbacksForState } from '../../src/components/grifball/arenaCollisionCallbacks';
import { recoverAirborneCombatantForFrame } from '../../src/components/grifball/aiAirborneRecoveryRuntime';
import { integrateTargetEngagementGravityForCombatant } from '../../src/components/grifball/aiEngagementFrameRuntime';
import { canStartAIHammerJumpForCombatant } from '../../src/components/grifball/combatantActions';
import type { CustomMapData } from '../../src/types';

// Explicit obstacle identities make map edits visible instead of silently choosing
// a different surface. These are production Grifball conversions, never flattened.
const platforms: Record<string, string> = {
  cyber_hex_arena: 'obj_pillar_nw', botanical_outpost: 'obj_nature_totem',
  vanguard_starbase: 'obj_asteroid_1', forerunner_canyon: 'barrier_w',
  synthwave_grid_arena: 'neon_pillar_cn', rainy_industrial_streets: 'rainy_crate_nw',
  winter_glacier_rink: 'board_glass_n',
};
export interface MapMobilityCase {
  map: CustomMapData; surface: 'floor' | 'boundary' | 'platform';
  owner: 'recovery' | 'engagement'; id: 'main_ai' | 'bot_2';
}
export const MAP_MOBILITY_CASES: MapMobilityCase[] = PREMADE_MAPS.map(toGrifballArena).flatMap(map =>
  (['floor', 'boundary', ...(platforms[map.id] ? ['platform'] : [])] as MapMobilityCase['surface'][]).flatMap(surface =>
    (['recovery', 'engagement'] as const).flatMap(owner => (['main_ai', 'bot_2'] as const).map(id => ({ map, surface, owner, id })))));

/** Authored airborne initial state followed by unmodified production gravity and
 * collision callbacks. This isolates terrain recovery; it is not autonomous jump selection. */
export function runMapMobilityTrace(spec: MapMobilityCase) {
  const map = structuredClone(spec.map), mapBefore = JSON.stringify(map);
  const state = createInitialGrifballRuntimeState({ debugMode: false,
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball', hammerJumpAirLimit: 1 },
    isMultiplayer: false, multiplayerRole: null });
  const refs = createInitialGrifballThreeRefs();
  state.arenaRadius = map.arenaRadius; state.otherPlayers.clear();
  const half = getRectHalfExtents(map.arenaRadius, map.arenaHalfExtents);
  const boundX = (map.mapShape === 'rectangular' ? half.x : map.arenaRadius) - .6;
  const obj = spec.surface === 'platform' ? map.objects.find(o => o.id === platforms[map.id]) : undefined;
  if (spec.surface === 'platform' && (!obj?.isCollidable || !['box', 'cylinder'].includes(obj.type))) throw new Error(`Missing landing surface on ${map.id}`);
  const top = obj ? obj.position.y + obj.scale.y / 2 : 0;
  const origin = obj ? new THREE.Vector3(obj.position.x, top + 1, Math.max(-half.z + .6, obj.position.z))
    : new THREE.Vector3(spec.surface === 'boundary' ? boundX - .9 : 10, 3, 0);
  const self = createOfflineBotCombatant({ id: spec.id, playerName: spec.id, team: 'blue', spawnPos: origin,
    yaw: 0, hue: 0, difficulty: 'normal', settings: state.settings });
  Object.assign(self, { isJumping: true, aiHammerJumpsInAir: 1, weaponState: 'ready', swapCooldownTimer: 0 });
  self.vel.set(spec.surface === 'boundary' ? 12 : 0, obj ? -1 : 6, 0);
  state.otherPlayers.set(self.id, self);
  // Sentinels catch accidental resets of another actor's air budget.
  const other = createOfflineBotCombatant({ id: spec.id === 'main_ai' ? 'bot_2' : 'main_ai', playerName: 'other', team: 'red',
    spawnPos: new THREE.Vector3(0, 10, 0), yaw: 0, hue: 0, difficulty: 'normal', settings: state.settings });
  other.isJumping = true; other.aiHammerJumpsInAir = 1; state.otherPlayers.set(other.id, other);
  state.isJumping = true; state.pHammerJumpsInAir = 1;
  const callbacks = createArenaCollisionCallbacksForState({ getState: () => state, getRefs: () => refs,
    getActiveCustomMap: () => map, getMainAI: () => state.otherPlayers.get('main_ai'),
    isMultiplayer: false, multiplayerRole: null, opponentClientId: '' });
  const failures: { tick: number; field: string; actual: unknown; expected: unknown }[] = [];
  let failureCount = 0, tick = 0, landingTick = 0, boundaryTick = 0;
  const check = (field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) { failureCount++; if (failures.length < 64) failures.push({ tick, field, actual, expected }); }
  };
  let y = origin.y, vy = self.vel.y;
  const frames = [];
  for (tick = 1; tick <= 180; tick++) {
    vy -= 18 / 60; y += vy / 60;
    // Independent expected vertical contact: floor y=0; authored box/cylinder
    // top within the documented .25m falling snap band and .1m upper tolerance.
    const contact = obj ? vy <= .05 && y >= top - .25 && y <= top + .1 : y <= 0;
    if (contact) { y = top; vy = 0; if (!landingTick) landingTick = tick; }
    const args = { self, dt: 1 / 60, gravityAcceleration: 18,
      recoverCombatantAltitude: callbacks.recoverCombatantAltitude, constrainCombatantToArena: callbacks.constrainCombatantToArena };
    if (spec.owner === 'recovery') recoverAirborneCombatantForFrame({ ...args, pos: self.pos, vel: self.vel });
    else integrateTargetEngagementGravityForCombatant({ ...args, frame: { pos: self.pos, vel: self.vel,
      aiState: 'APPROACHING', timer: 0, dashCooldownTimer: 0, slideCooldownTimer: 0, hammerJumpCooldownTimer: 0 } });
    check('vertical trajectory and contact height', Math.abs(self.pos.y - y) < 1e-8, true);
    check('vertical velocity', Math.abs(self.vel.y - vy) < 1e-8, true);
    check('airborne flag', !!self.isJumping, !landingTick);
    check('air jump budget', self.aiHammerJumpsInAir, landingTick ? 0 : 1);
    check('jump eligibility follows landing', canStartAIHammerJumpForCombatant(self, state.settings), !!landingTick);
    check('finite state', [...self.pos.toArray(), ...self.vel.toArray()].every(Number.isFinite), true);
    check('other bot remains airborne', other.isJumping, true); check('other budget untouched', other.aiHammerJumpsInAir, 1);
    check('player remains airborne', state.isJumping, true); check('player budget untouched', state.pHammerJumpsInAir, 1);
    if (map.mapShape === 'rectangular') check('inside rectangular boundary', Math.abs(self.pos.x) <= half.x - .6 + 1e-8 && Math.abs(self.pos.z) <= half.z - .6 + 1e-8, true);
    else check('inside radial boundary', Math.hypot(self.pos.x, self.pos.z) <= map.arenaRadius - .6 + 1e-8, true);
    if (spec.surface === 'boundary' && Math.abs(self.pos.x - boundX) < 1e-8) {
      if (!boundaryTick) boundaryTick = tick;
      check('boundary removes outward velocity', self.vel.x, 0);
    }
    if (obj) check('platform retains horizontal position', Math.hypot(self.pos.x - origin.x, self.pos.z - origin.z) < 1e-8, true);
    frames.push({ tick, pos: self.pos.toArray(), vel: self.vel.toArray(), jumping: !!self.isJumping, budget: self.aiHammerJumpsInAir });
  }
  tick = 180;
  check('landing and stable grounded observation', landingTick > 0 && landingTick <= 120, true);
  if (spec.surface === 'boundary') check('boundary reached before landing', boundaryTick > 0 && boundaryTick < landingTick, true);
  check('supplied map unchanged', JSON.stringify(map), mapBefore);
  return { name: `${map.id}/${spec.surface}/${spec.owner}/${spec.id}`, boundary: 'live-map-mobility' as const,
    mapId: map.id, surface: spec.surface, owner: spec.owner, actorId: spec.id, obstacleId: obj?.id ?? null,
    ticks: 180, landingTick, boundaryTick, failureCount, failures, frames };
}
export const runMapMobility = () => MAP_MOBILITY_CASES.map(runMapMobilityTrace);

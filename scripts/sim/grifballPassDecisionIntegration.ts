import * as THREE from 'three';
import { createInitialGrifballRuntimeState } from '../../src/components/grifball/runtimeState';
import { createInitialGrifballThreeRefs } from '../../src/components/grifball/threeRefs';
import { createAISingleEntityUpdaterForState } from '../../src/components/grifball/aiSingleEntityRuntime';
import { updateAIRosterTick } from '../../src/components/grifball/aiRosterTick';
import { updateGrifballTeamPlanForState } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { updateGrifballObjectiveForState, setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { createOfflineBotCombatant } from '../../src/game/roster';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { isSpaceSegmentOpen } from '../../src/game/grifballSpaceGeometry';
import { seededRandom, withSimulationRandom } from '../../src/game/simulationRandom';
import { DEFAULT_ADMIN_SETTINGS } from '../../src/settings/gameplaySettings';
import type { CustomMapData } from '../../src/types';
import { GRIFBALL_BALL_GRAVITY, GRIFBALL_THROW_ARC } from '../../src/game/grifballBall';

type SelectedPass = { receiverId: string; speed: number; chargeSeconds: number; point: { x: number; z: number } };

export interface PassDecisionCase {
  mode: 'pass' | 'short-charge' | 'disabled' | 'cancel-module' | 'cancel-receiver' | 'resume';
  team: 'blue' | 'red';
  reverse: boolean;
  carrierId: 'main_ai' | 'carrier';
}
export const PASS_DECISION_CASES: PassDecisionCase[] =
  (['pass', 'short-charge', 'disabled', 'cancel-module', 'cancel-receiver', 'resume'] as const).flatMap(mode =>
    (['blue', 'red'] as const).flatMap(team => [false, true].flatMap(reverse =>
      (['main_ai', 'carrier'] as const).map(carrierId => ({ mode, team, reverse, carrierId })))));

/** Live-only autonomous passing through the real roster, planner, updater and objective owners.
 * Initial possession and external configuration/ownership events are authored; decisions are not.
 */
export function runPassDecisionTrace(spec: PassDecisionCase) {
  const state = createInitialGrifballRuntimeState({ debugMode: false,
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball', aiDifficulty: 'normal',
      grifballChargeMax: spec.mode === 'short-charge' ? .3 : 1.2 },
    isMultiplayer: false, multiplayerRole: null });
  const refs = createInitialGrifballThreeRefs(), sign = spec.team === 'blue' ? 1 : -1;
  const map = { id: 'pass-corridor', name: 'Pass corridor', mapShape: 'rectangular', arenaRadius: 60,
    arenaHalfExtents: { x: 52, z: 23 }, objects: [] } as unknown as CustomMapData;
  state.arenaRadius = map.arenaRadius; state.isObserverMode = true;
  state.grifball.phase = 'playing'; state.grifballTactics = defaultGrifballTactics();
  state.grifballTactics.defaults.passingEnabled = spec.mode !== 'disabled';
  state.otherPlayers.clear();
  const seeds = [
    { id: spec.carrierId, x: -20, z: 0, team: spec.team, controller: 'ai' as const },
    { id: 'receiver', x: -8, z: 0, team: spec.team, controller: 'ai' as const },
    { id: 'remote', x: -45, z: 18, team: spec.team === 'blue' ? 'red' as const : 'blue' as const, controller: 'remote' as const },
  ];
  for (const s of spec.reverse ? [...seeds].reverse() : seeds) {
    const c = createOfflineBotCombatant({ id: s.id, playerName: s.id, team: s.team,
      spawnPos: new THREE.Vector3(s.x * sign, 0, s.z * sign), yaw: -sign * Math.PI / 2,
      hue: 0, difficulty: 'normal', settings: state.settings });
    Object.assign(c, { controller: s.controller, weaponState: 'ready', weaponTimer: 0,
      invulnerabilityTimer: 0, respawnTimer: 0, swapCooldownTimer: 0 });
    state.otherPlayers.set(c.id, c); refs.otherPlayerMeshes.set(c.id, { group: new THREE.Group() } as never);
  }
  const carrier = state.otherPlayers.get(spec.carrierId)!, receiver = state.otherPlayers.get('receiver')!;
  // Runtime callbacks mutate this discriminant after the fixture's initial held state.
  const ballState = () => state.grifball.ball.state;
  state.grifball.ball.state = 'held'; state.grifball.ball.holderId = carrier.id;
  state.grifball.ball.pos = { x: carrier.pos.x, y: 1.1, z: carrier.pos.z };
  setGrifballCarrierForState({ state, refs, id: carrier.id, carrying: true });
  let tick = 0, failureCount = 0;
  const failures: { tick: number; field: string; actual: unknown; expected: unknown }[] = [];
  const check = (field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) { failureCount++; if (failures.length < 64) failures.push({ tick, field, actual, expected }); }
  };
  const noop = () => {}, goal = (team: string | undefined) => ({ x: team === 'blue' ? 47 : -47, z: 0 });
  const update = createAISingleEntityUpdaterForState({ stateRef: { current: state }, threeRef: { current: refs },
    mai: () => state.otherPlayers.get('main_ai'),
    resolveBotKnobs: () => ({ difficulty: 'normal', movementComplexity: 0, weaponSwapIQ: 0,
      weaponPrioritization: 0, reactionLatency: .2, anticipationFactor: 0 }),
    resolveBotDerived: () => ({ pressureAggression: 50 }), resolveBotFlags: () => ({}),
    getMatchScoreContext: () => ({ ownScore: 0, opponentScore: 0, scoreToWin: 25 }), grifballEnemyGoalPos: goal,
    constrainCombatantToArena: (pos, vel) => constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: map, arenaRadius: map.arenaRadius }),
    getBestTacticalTarget: () => { check('unexpected combat fallback', true, false); return null; },
    triggerCombatantAttack: () => check('unexpected attack', true, false),
    playDash: noop, playJump: noop, playExplosion: noop, playDeath: noop,
  });
  const random = seededRandom(17), dt = 1 / 60;
  const ballMeshRef = { current: null }, ballChargingRef = { current: false }, ballChargeTimerRef = { current: 0 };
  const frames = [];
  let firstSelectionTick = 0, releaseTick = 0, receptionTick = 0, cancelTick = 0, resumeTick = 0, releases = 0;
  let cancelledPosition: THREE.Vector3 | null = null;
  for (tick = 1; tick <= 360; tick++) {
    const plan = state.aiMatchContext.grifballTeamPlan;
    const heldBefore = state.grifball.ball.holderId, ballBefore = ballState();
    const before = new Map([...state.otherPlayers].map(([id, c]) => [id, c.pos.clone()]));
    const chargeBefore = plan.passCharge ? { ...plan.passCharge } : null;
    let selected: SelectedPass | null = null;
    const intents: { id: string; role: string | null; pickup: boolean; receive: boolean }[] = [];
    withSimulationRandom(random, tick * dt, () => {
      // Interrupt an actual charge after planning/movement below, to exercise release-time revalidation.
      if (spec.mode === 'resume' && cancelTick && tick === cancelTick + 30) {
        state.grifballTactics.defaults.passingEnabled = true; resumeTick = tick;
      }
      updateAIRosterTick({ refs, rosterAI: [...state.otherPlayers.values()], dt,
        respawnCombatant: () => check('unexpected respawn', true, false),
        beforeUpdate: () => {
          updateGrifballTeamPlanForState(state, dt, goal, map);
          const candidate = plan.assignments.get(carrier.id)?.pass?.selected;
          if (candidate) {
            selected = { receiverId: candidate.receiverId, speed: candidate.speed, chargeSeconds: candidate.chargeSeconds,
              point: { ...candidate.point } };
            if (!firstSelectionTick) firstSelectionTick = tick;
            check('selected scripted receiver', candidate.receiverId, receiver.id);
          }
        }, updateSingleAIEntity: (id, delta) => {
          update(id, delta);
          const c = state.otherPlayers.get(id)!, assignment = plan.assignments.get(id);
          intents.push({ id, role: assignment?.role ?? null, pickup: !!c.pickupRequested, receive: !!assignment?.receive });
          check(`${id}.finite movement`, [...c.pos.toArray(), ...c.vel.toArray(), c.yaw].every(Number.isFinite), true);
          check(`${id}.open route`, isSpaceSegmentOpen(plan.snapshot!.geometry!, before.get(id)!, c.pos), true);
          if (selected && id === carrier.id) check('carrier holds while charging', c.pos.distanceTo(before.get(id)!) < 1e-9, true);
          if (ballBefore === 'thrown' && id === receiver.id) check('receiver pickup intent', !!c.pickupRequested, true);
        } });
      const pending = plan.assignments.get(carrier.id)?.pass?.selected;
      if (!cancelTick && chargeBefore && pending && chargeBefore.elapsed + dt + 1e-9 >= pending.chargeSeconds &&
        ['cancel-module', 'cancel-receiver', 'resume'].includes(spec.mode)) {
        cancelTick = tick;
        if (spec.mode === 'cancel-receiver') { receiver.controller = 'remote'; cancelledPosition = receiver.pos.clone(); }
        else state.grifballTactics.defaults.passingEnabled = false;
      }
      updateGrifballObjectiveForState({ state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt,
        isMultiplayer: false, activeCustomMap: map,
        placeCombatantsAtGrifballSpawns: () => check('unexpected reset', true, false), pushStatsUpdate: noop });
    });
    const holder = state.grifball.ball.holderId;
    const chosen = selected as SelectedPass | null;
    const continuing = chargeBefore && chosen && chargeBefore.receiverId === chosen.receiverId && chargeBefore.speed === chosen.speed;
    const elapsed = (continuing ? chargeBefore.elapsed : 0) + dt;
    if (plan.passCharge) {
      check('charge advances once', Math.abs(plan.passCharge.elapsed - elapsed) < 1e-9, true);
      check('no premature release', chosen !== null && elapsed + 1e-9 < chosen.chargeSeconds, true);
      check('charge display fraction', Math.abs((carrier.grifballPassCharge ?? 0) - elapsed / state.settings.grifballChargeMax!) < 1e-9, true);
    }
    if (heldBefore && ballState() === 'thrown') {
      releases++; if (!releaseTick) releaseTick = tick;
      check('release chosen by planner', !!selected, true);
      check('charge cleared on release', plan.passCharge, null);
      check('carrier hammer restored', carrier.activeWeapon, 'hammer');
      check('carrier health restored', carrier.maxHp, state.settings.maxHP);
      check('flight receiver retained', plan.passFlight?.receiverId, receiver.id);
      check('release reached charge threshold', chosen !== null && elapsed + 1e-9 >= chosen.chargeSeconds, true);
      // The objective advances the newly released ball exactly once on the release frame.
      check('release horizontal speed', Math.abs(Math.hypot(state.grifball.ball.vel.x, state.grifball.ball.vel.z) - chosen!.speed) < 1e-9, true);
      check('release vertical velocity', Math.abs(state.grifball.ball.vel.y - (chosen!.speed * GRIFBALL_THROW_ARC - GRIFBALL_BALL_GRAVITY * dt)) < 1e-9, true);
      check('release origin displacement', Math.abs(Math.hypot(state.grifball.ball.pos.x - carrier.pos.x, state.grifball.ball.pos.z - carrier.pos.z) - chosen!.speed * dt) < 1e-9, true);
    }
    if (releaseTick && holder === receiver.id && !receptionTick) {
      receptionTick = tick;
      check('pickup settled height', Math.abs(state.grifball.ball.pos.y - .35) < 1e-9, true);
      check('pickup in range', Math.hypot(receiver.pos.x - state.grifball.ball.pos.x, receiver.pos.z - state.grifball.ball.pos.z)
        <= (state.settings.grifballPickupRadius ?? 1.6), true);
    }
    if (tick === cancelTick) {
      check('cancel retains possession', holder, carrier.id);
      check('cancel clears charge', plan.passCharge, null);
      check('cancel clears display', carrier.grifballPassCharge, 0);
    }
    if (cancelledPosition) check('remote receiver stationary', receiver.pos.equals(cancelledPosition), true);
    if (receptionTick && tick > receptionTick) {
      check('received runner role', plan.assignments.get(receiver.id)?.role, 'runner');
      check('received flight cleared', plan.passFlight, null);
    }
    if (ballState() === 'thrown') check('no airborne catch', holder, null);
    for (const c of state.otherPlayers.values()) check(`${c.id}.pickup consumed`, !!c.pickupRequested, false);
    frames.push({ tick, selected, charge: plan.passCharge ? { ...plan.passCharge } : null,
      chargeDisplay: carrier.grifballPassCharge ?? 0, flight: plan.passFlight ? { ...plan.passFlight } : null,
      ball: structuredClone(state.grifball.ball), intents, actors: [...state.otherPlayers.values()].map(c => ({
        id: c.id, controller: c.controller, pos: c.pos.toArray(), vel: c.vel.toArray(), weapon: c.activeWeapon, hp: c.hp,
      })) });
  }
  tick = 360;
  const shouldPass = ['pass', 'short-charge', 'resume'].includes(spec.mode);
  check('release count', releases, shouldPass ? 1 : 0);
  if (shouldPass) {
    check('autonomous reception', receptionTick > releaseTick && releaseTick > 0, true);
    check('intended final holder', state.grifball.ball.holderId, receiver.id);
    check('receiver ball equipped', receiver.activeWeapon, 'ball');
    check('receiver health boosted', receiver.maxHp, state.settings.grifballRunnerHealth);
  } else check('retained carrier', state.grifball.ball.holderId, carrier.id);
  if (spec.mode === 'disabled') check('disabled no selection', firstSelectionTick, 0);
  if (spec.mode.startsWith('cancel') || spec.mode === 'resume') check('charged before cancellation', cancelTick > 1, true);
  if (spec.mode === 'resume') check('release after reenable', releaseTick > resumeTick && resumeTick > cancelTick, true);
  if (spec.mode === 'pass' || spec.mode === 'short-charge') {
    check('expected release tick', releaseTick, spec.mode === 'pass' ? 36 : 9);
    check('expected reception tick', receptionTick, spec.mode === 'pass' ? 131 : 109);
  }
  return { name: `${spec.mode}/${spec.team}/${spec.reverse ? 'reverse' : 'forward'}/${spec.carrierId}`,
    boundary: 'live-pass-decision-integration' as const, scenario: spec, ticks: 360, failureCount, failures,
    firstSelectionTick, releaseTick, receptionTick, cancelTick, resumeTick, frames };
}

export const runPassDecisionIntegration = () => PASS_DECISION_CASES.map(runPassDecisionTrace);


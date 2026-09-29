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
import { deriveAIParams, type AIResolvedKnobs } from '../../src/game/aiTuning';
import { NEUTRAL_PERSONALITY_FLAGS } from '../../src/game/aiPersonalities';
import { createTacticalTargetCallbacksForState } from '../../src/components/grifball/tacticalTargetCallbacks';
import { buildCombatantRigForModel } from '../../src/components/grifball/combatantRig';
import { triggerCombatantAttackAction } from '../../src/components/grifball/combatantActions';
import { updateRosterCombatantVisualsForState } from '../../src/components/grifball/rosterVisualSync';
import { applyBotMeleeImpactForState } from '../../src/components/grifball/botMeleeImpactRuntime';

export interface PressureDecisionCase {
  pressure: 'runner' | 'receiver' | 'withdraw';
  team: 'blue' | 'red'; reverse: boolean; main: boolean;
}
export const PRESSURE_DECISION_CASES: PressureDecisionCase[] =
  (['runner', 'receiver', 'withdraw'] as const).flatMap(pressure =>
    (['blue', 'red'] as const).flatMap(team => [false, true].flatMap(reverse =>
      [false, true].map(main => ({ pressure, team, reverse, main })))));

/** External pressure arrives after planning on the intended pass-release frame.
 * Pass rejection, tactical target choice and subsequent attacks are autonomous.
 * The opponent is stationary and does not counterattack; no headless parity claim.
 */
export function runPressureDecisionTrace(spec: PressureDecisionCase) {
  const state = createInitialGrifballRuntimeState({ debugMode: false,
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball', aiDifficulty: 'normal' },
    isMultiplayer: false, multiplayerRole: null });
  const refs = createInitialGrifballThreeRefs(), sign = spec.team === 'blue' ? 1 : -1;
  const map = { id: 'pressure-corridor', name: 'Pressure corridor', mapShape: 'rectangular', arenaRadius: 60,
    arenaHalfExtents: { x: 52, z: 23 }, objects: [] } as unknown as CustomMapData;
  state.arenaRadius = 60; state.isObserverMode = true; state.grifball.phase = 'playing';
  state.grifballTactics = defaultGrifballTactics(); state.otherPlayers.clear();
  const carrierId = spec.main && spec.pressure !== 'receiver' ? 'main_ai' : 'carrier';
  const receiverId = spec.main && spec.pressure === 'receiver' ? 'main_ai' : 'receiver';
  const seeds = [
    { id: carrierId, x: -20, z: 0, team: spec.team, controller: 'ai' as const },
    { id: receiverId, x: -8, z: 0, team: spec.team, controller: 'ai' as const },
    { id: 'threat', x: -45, z: 18, team: spec.team === 'blue' ? 'red' as const : 'blue' as const, controller: 'ai' as const },
  ];
  for (const s of spec.reverse ? [...seeds].reverse() : seeds) {
    const c = createOfflineBotCombatant({ id: s.id, playerName: s.id, team: s.team,
      spawnPos: new THREE.Vector3(s.x * sign, 0, s.z * sign), yaw: -sign * Math.PI / 2,
      hue: 0, difficulty: 'normal', settings: state.settings });
    Object.assign(c, { controller: s.controller, weaponState: 'ready', weaponTimer: 0,
      hp: 1, maxHp: 1, invulnerabilityTimer: 0, respawnTimer: 0, swapCooldownTimer: 0 });
    state.otherPlayers.set(c.id, c);
    const group = new THREE.Group(); group.userData.modelSystem = 'v2';
    refs.otherPlayerMeshes.set(c.id, { group, hammer: new THREE.Group(), sword: new THREE.Group(), rig: buildCombatantRigForModel(group) });
  }
  const carrier = state.otherPlayers.get(carrierId)!, receiver = state.otherPlayers.get(receiverId)!, threat = state.otherPlayers.get('threat')!;
  const ballState = () => state.grifball.ball.state;
  state.grifball.ball.state = 'held'; state.grifball.ball.holderId = carrierId;
  state.grifball.ball.pos = { x: carrier.pos.x, y: 1.1, z: carrier.pos.z };
  setGrifballCarrierForState({ state, refs, id: carrierId, carrying: true });
  let tick = 0, failureCount = 0;
  const failures: { tick: number; field: string; actual: unknown; expected: unknown }[] = [];
  const check = (field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) { failureCount++; if (failures.length < 64) failures.push({ tick, field, actual, expected }); }
  };
  const noop = () => {}, goal = (team: string | undefined) => ({ x: team === 'blue' ? 47 : -47, z: 0 });
  const knobs: AIResolvedKnobs = { difficulty: 'normal', movementComplexity: 0, weaponSwapIQ: 0,
    weaponPrioritization: 0, reactionLatency: .2, anticipationFactor: 0, aiPlaystyle: 50 };
  const derived = deriveAIParams(state.settings, knobs);
  const getMatchScoreContext = () => ({ scorePlayer: 0, scoreEnemy: 0, killsToWin: 25 });
  const targets = createTacticalTargetCallbacksForState({ getState: () => state, getMainAI: () => state.otherPlayers.get('main_ai'),
    getRosterAI: () => [...state.otherPlayers.values()], resolveRosterSlot: () => ({ difficulty: 'normal' } as never),
    resolveBotKnobs: () => knobs, resolveBotDerived: () => derived, getMatchScoreContext });
  const attacks: { tick: number; id: string; weapon: string; melee: boolean }[] = [];
  const targetLookups: { tick: number; id: string; target: string }[] = [];
  const update = createAISingleEntityUpdaterForState({ stateRef: { current: state }, threeRef: { current: refs },
    mai: () => state.otherPlayers.get('main_ai'), resolveBotKnobs: () => knobs, resolveBotDerived: () => derived,
    resolveBotFlags: () => NEUTRAL_PERSONALITY_FLAGS, getMatchScoreContext, grifballEnemyGoalPos: goal,
    constrainCombatantToArena: (pos, vel) => constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: map, arenaRadius: map.arenaRadius }),
    ...targets,
    getBestTacticalTarget: () => { check('no generic target override', true, false); return null; },
    getTacticalTargetById: (id: string, target: string) => {
      targetLookups.push({ tick, id, target });
      return targets.getTacticalTargetById(id, target);
    },
    triggerCombatantAttack: (self, weapon, melee = false) => {
      attacks.push({ tick, id: self.id, weapon: self.activeWeapon, melee });
      triggerCombatantAttackAction({ self, weapon, melee, recordHammerAttack: noop, playSwing: noop });
    },
    getActiveCustomMap: () => map, getTargetPlayerModel: () => null,
    recordCombatantObservation: noop, tryEnterPressureState: () => false, tryStartComboOnHit: () => false,
    recoverCombatantAltitude: noop, clearPressureTarget: noop,
    startAIHammerJump: () => { check('unexpected hammer jump', true, false); return false; },
    triggerCombatantLunge: () => check('unexpected sword lunge', true, false),
    swapCombatantWeapon: () => check('unexpected weapon swap', true, false),
    playDash: noop, playJump: noop, playExplosion: noop, playDeath: noop,
  });
  const random = seededRandom(17), dt = 1 / 60;
  const ballMeshRef = { current: null }, ballChargingRef = { current: false }, ballChargeTimerRef = { current: 0 };
  const frames = [];
  let pressureTick = 0, damageTick = 0, rejection = '', resumedPassTick = 0;
  for (tick = 1; tick <= 180; tick++) {
    const plan = state.aiMatchContext.grifballTeamPlan;
    const before = new Map([...state.otherPlayers].map(([id, c]) => [id, c.pos.clone()]));
    withSimulationRandom(random, tick * dt, () => {
      if (spec.pressure === 'withdraw' && tick === 40) threat.pos.set(-45 * sign, 0, 18 * sign);
      updateAIRosterTick({ refs, rosterAI: [...state.otherPlayers.values()], dt,
        respawnCombatant: () => check('unexpected respawn', true, false),
        beforeUpdate: () => updateGrifballTeamPlanForState(state, dt, goal, map), updateSingleAIEntity: (id, delta) => { if (id !== 'threat') update(id, delta); } });
      const selected = plan.assignments.get(carrierId)?.pass?.selected;
      if (!pressureTick && selected && plan.passCharge && plan.passCharge.elapsed + dt + 1e-9 >= selected.chargeSeconds) {
        pressureTick = tick;
        const protectedActor = spec.pressure === 'receiver' ? receiver : carrier;
        threat.pos.copy(protectedActor.pos); threat.pos.x += 1.5 * sign;
      }
      updateGrifballObjectiveForState({ state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt,
        isMultiplayer: false, activeCustomMap: map, placeCombatantsAtGrifballSpawns: noop, pushStatsUpdate: noop });
      if (tick === pressureTick) {
        check('unsafe pass cancelled', ballState(), 'held'); check('possession retained', state.grifball.ball.holderId, carrierId);
        check('charge cleared', plan.passCharge, null); check('charge display cleared', carrier.grifballPassCharge, 0);
        rejection = plan.assignments.get(carrierId)?.pass?.reason ?? '';
        check('fresh pass rejected', plan.assignments.get(carrierId)?.pass?.selected ?? null, null);
      }
      updateRosterCombatantVisualsForState({ state, refs, dt, renderSwordLungeTrailVfx: noop,
        applyBotMeleeImpact: botId => applyBotMeleeImpactForState({ state, botId, renderHammerSplashVfx: noop,
          spawnVoxelShockwaveParticles: noop, playExplosion: noop, playDeath: noop, playSwing: noop,
          recordBotPsychKill: noop, recordBotCalibrationDeath: noop }) });
    });
    if (threat.hp < 1 && !damageTick) damageTick = tick;
    if (pressureTick && tick >= pressureTick && threat.hp > 0 && spec.pressure !== 'withdraw') {
      check('no pass into active pressure', ballState(), 'held');
    }
    if (pressureTick && tick > pressureTick && plan.passCharge && !resumedPassTick) resumedPassTick = tick;
    for (const c of [carrier, receiver]) {
      check(`${c.id}.finite`, [...c.pos.toArray(), ...c.vel.toArray(), c.yaw, c.aiTimer ?? 0].every(Number.isFinite), true);
      check(`${c.id}.open segment`, isSpaceSegmentOpen(plan.snapshot!.geometry!, before.get(c.id)!, c.pos), true);
      check(`${c.id}.no friendly damage`, c.hp > 0, true);
    }
    frames.push({ tick, holder: state.grifball.ball.holderId, ballState: ballState(),
      charge: plan.passCharge ? { ...plan.passCharge } : null,
      assignments: [...plan.assignments.values()].map(a => ({ id: a.botId, role: a.role, receive: !!a.receive,
        tanking: a.tanking?.mode ?? null, target: state.aiMatchContext.coordinator.tacticalEngagements.get(a.botId)?.targetId ?? null })),
      actors: [...state.otherPlayers.values()].map(c => ({ id: c.id, pos: c.pos.toArray(), vel: c.vel.toArray(),
        hp: c.hp, weapon: c.activeWeapon, weaponState: c.weaponState, aiState: c.aiState, timer: c.aiTimer ?? 0 })) });
  }
  tick = 180;
  check('pressure on release frame', pressureTick, 36);
  const defender = spec.pressure === 'receiver' ? receiverId : carrierId;
  check('autonomous attack', attacks.some(a => a.id === defender && a.tick > pressureTick), true);
  check('one committed response', attacks.length, 1);
  check('response timing', attacks[0]?.tick, spec.pressure === 'receiver' ? 40 : 37);
  check('impact timing', damageTick, spec.pressure === 'withdraw' ? 0 : spec.pressure === 'receiver' ? 64 : 59);
  check('expected enemy health', threat.hp, spec.pressure === 'withdraw' ? 1 : 0);
  check('threat kill credit', state.otherPlayers.get(defender)!.kills, spec.pressure === 'withdraw' ? 0 : 1);
  check('enemy death count', threat.deaths, spec.pressure === 'withdraw' ? 0 : 1);
  check('resume passing after threat', resumedPassTick > pressureTick, true);
  if (spec.pressure === 'receiver') check('receiver tactical handoff', targetLookups.some(t => t.id === receiverId && t.target === threat.id), true);
  if (spec.pressure !== 'receiver') check('runner counter owns response', targetLookups.length, 0);
  check('only hostile target lookup', targetLookups.every(t => t.target === threat.id), true);
  return { name: `${spec.pressure}/${spec.team}/${spec.reverse ? 'reverse' : 'forward'}/${spec.main ? 'main' : 'ordinary'}`,
    boundary: 'live-pressure-decision-integration' as const, scenario: spec, ticks: 180,
    failureCount, failures, pressureTick, damageTick, resumedPassTick, rejection, attacks, targetLookups, frames };
}
export const runPressureDecisionIntegration = () => PRESSURE_DECISION_CASES.map(runPressureDecisionTrace);


import * as THREE from 'three';
import { triggerCombatantAttackAction, triggerCombatantLungeAction } from '../../src/components/grifball/combatantActions';
import { lungeFixture } from './grifballLungeFixture';
import { idleAction } from '../../src/sim/actions';
import { stepSimulation } from '../../src/sim/step';
import { stepCombatantWeapons } from '../../src/sim/weapons';
import { tickCombatantInvulnerability } from '../../src/components/grifball/aiTickState';
import { setSimCarrier } from '../../src/sim/grifball';
import { setGrifballCarrierForState, reconcileGrifballCarrierForState, updateGrifballObjectiveForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { seededRandom, withSimulationRandom } from '../../src/game/simulationRandom';
import type { SimCombatExecution } from '../../src/sim/simState';
import type { CharacterModelType, UniversalSettings } from '../../src/types';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { resolveHammerSlamTiming } from '../../src/game/hammerSlamTiming';
import type { ParityDifference } from './grifballExecutionParity';
import type { Vec3 } from '../../src/game/grifballBall';
import { groundMotionAction, stepLiveGroundMotion, type GroundMotion } from './grifballGroundMotion';

export interface FlightPose { height?: number; velocityY?: number; direction?: Vec3 }

export interface LungeParityCase {
  name: string; target?: { x: number; z: number }; startZ?: number; hp?: number;
  trade?: 'sword' | 'hammer'; shield?: number; carrier?: boolean;
  settings?: Partial<UniversalSettings>; hits: number; deaths?: number;
  cancel?: 'dead'; friendly?: boolean; attackerHp?: number; attackerHits?: number; pairedLunge?: boolean; reverseOrder?: boolean;
  window?: { weapon: 'sword' | 'hammer'; ageMs?: number; limitMs: number; enabled?: boolean; wrongWeapon?: boolean };
  attackerModel?: CharacterModelType; targetModel?: CharacterModelType;
  attackerCrouch?: boolean; targetCrouch?: boolean;
  motion?: { attacker?: FlightPose; target?: FlightPose };
  expectedFirstHitTick?: number;
  targetMovement?: GroundMotion;
}
export const LUNGE_PARITY_CASES: LungeParityCase[] = [
  { name: 'nonlethal-contact', hits: 1 },
  { name: 'narrow-miss', target: { x: 1.55, z: 2 }, hits: 0 },
  { name: 'timeout', target: { x: 0, z: 20 }, hits: 0 },
  { name: 'slow-timeout', target: { x: 0, z: 20 }, settings: { swordLungeSpeed: 7 }, hits: 0 },
  { name: 'tuned-cooldown', settings: { swordLungeReload: .35 }, hits: 1 },
  { name: 'arena-boundary', startZ: 22, target: { x: 4, z: 22 }, hits: 0 },
  { name: 'dead-target-cancel', cancel: 'dead', hits: 0 },
  { name: 'friendly-target-contact', friendly: true, hits: 1 },
  { name: 'friendly-target-death', friendly: true, hp: 1, hits: 1, deaths: 1 },
  { name: 'shield-contact', target: { x: 0, z: .4 }, shield: 1, hits: 0 },
  { name: 'shield-expiry-order', target: { x: 0, z: .4 }, shield: 1 / 60, hits: 1 },
  { name: 'lethal-respawn', hp: 1, hits: 1, deaths: 1 },
  { name: 'carrier-death-respawn', hp: 1, carrier: true, hits: 1, deaths: 1 },
  { name: 'sword-trade-respawn', hp: 1, trade: 'sword', target: { x: 0, z: .4 }, hits: 1, deaths: 2 },
  { name: 'hammer-trade-respawn', hp: 1, trade: 'hammer', target: { x: 0, z: .4 }, hits: 1, deaths: 2 },
  ...(['sword', 'hammer'] as const).flatMap(trade => [
    { name: `${trade}-trade-both-survive`, hp: 3, trade, target: { x: 0, z: .4 }, hits: 1, attackerHits: 1 },
    { name: `${trade}-trade-attacker-survives`, hp: 1, attackerHp: 3, trade, target: { x: 0, z: .4 }, hits: 1, attackerHits: 1, deaths: 1 },
    { name: `${trade}-trade-target-survives`, hp: 3, attackerHp: 1, trade, target: { x: 0, z: .4 }, hits: 1, attackerHits: 1, deaths: 1 },
    { name: `${trade}-trade-tuned-recovery`, hp: 3, trade, target: { x: 0, z: .4 }, hits: 1, attackerHits: 1,
      settings: { swordLungeReload: .35, swordSlashReload: .27, hammerReloadTime: .42 } },
  ]),
  ...(['sword', 'hammer'] as const).flatMap(weapon => [
    { name: `${weapon}-window-inside`, window: { weapon, ageMs: 349, limitMs: 350 }, attackerHits: 1 },
    { name: `${weapon}-window-edge`, window: { weapon, ageMs: 350, limitMs: 350 }, attackerHits: 1 },
    { name: `${weapon}-window-outside`, window: { weapon, ageMs: 351, limitMs: 350 }, attackerHits: 0 },
    { name: `${weapon}-window-zero-edge`, window: { weapon, ageMs: 0, limitMs: 0 }, attackerHits: 1 },
    { name: `${weapon}-window-tuned`, window: { weapon, ageMs: 120, limitMs: 120 }, attackerHits: 1 },
    { name: `${weapon}-window-disabled`, window: { weapon, ageMs: 10, limitMs: 350, enabled: false }, attackerHits: 0 },
    { name: `${weapon}-window-no-history`, window: { weapon, limitMs: 350 }, attackerHits: 0 },
    { name: `${weapon}-window-future-history`, window: { weapon, ageMs: -1, limitMs: 350 }, attackerHits: 0 },
    { name: `${weapon}-window-other-weapon`, window: { weapon, ageMs: 10, limitMs: 350, wrongWeapon: true }, attackerHits: 0 },
  ].map(spec => ({ ...spec, hp: 3, hits: 1, target: { x: 0, z: .4 } }))),
  ...[false, true].flatMap(reverseOrder => [
    { name: 'lethal', hp: 1, deaths: 2 }, { name: 'both-survive', hp: 3 },
    { name: 'attacker-survives', hp: 1, attackerHp: 3, deaths: 1 },
    { name: 'target-survives', hp: 3, attackerHp: 1, deaths: 1 },
    { name: 'tuned-reload', hp: 3, settings: { swordLungeReload: .35 } },
  ].map(spec => ({ ...spec, name: `paired-${spec.name}-${reverseOrder ? 'reversed' : 'forward'}`,
    pairedLunge: true, reverseOrder, hits: 1, attackerHits: 1, target: { x: 0, z: 4 } }))),
];

/** Grounded committed flights, followed through contact, cooldown and single-spawn revival. */
export function runLungeParityTrace(spec: LungeParityCase, id = 'bot_2', observer = true,
  execution: SimCombatExecution = 'live-roster-v2', targetId = 'target') {
  const f = lungeFixture(id, observer, targetId), { sim, state, bot, target, map, refs } = f;
  state.grifballTactics = defaultGrifballTactics();
  Object.assign(sim.settings, spec.settings); Object.assign(state.settings, spec.settings);
  sim.combatExecution = execution; sim.match.phase = state.grifball.phase = 'playing';
  const [self, rival] = sim.combatants; self.id = id; rival.id = target.id;
  self.modelType = bot.modelType = spec.attackerModel ?? 'medium';
  rival.modelType = target.modelType = spec.targetModel ?? 'medium';
  self.isCrouching = bot.isCrouching = !!spec.attackerCrouch;
  rival.isCrouching = target.isCrouching = !!spec.targetCrouch;
  // Exactly one authored spawn per team bounds this slice; multi-slot arbitration stays a gap.
  map.teamSpawns = { blue: [{ x: -10, y: 0, z: 0 }], red: [{ x: 10, y: 0, z: 0 }] };
  sim.spawns = { blue: structuredClone(map.teamSpawns.blue), red: structuredClone(map.teamSpawns.red) };
  self.pos = { x: 0, y: 0, z: spec.startZ ?? 0 }; bot.pos.z = self.pos.z;
  bot.lungeStartPos = { ...self.pos };
  const p = spec.target ?? { x: 0, z: 2 };
  rival.pos = { x: p.x, y: 0, z: p.z }; target.pos.set(p.x, 0, p.z);
  for (const [live, headless, pose] of [[bot, self, spec.motion?.attacker], [target, rival, spec.motion?.target]] as const) {
    live.pos.y = headless.pos.y = pose?.height ?? 0;
    live.vel.y = headless.vel.y = pose?.velocityY ?? 0;
    live.isJumping = headless.isJumping = live.pos.y > .01 || Math.abs(live.vel.y) > .01;
    headless.grounded = !headless.isJumping;
    if (pose?.direction) headless.lungeAimDirection = { ...pose.direction };
  }
  self.weapon = bot.activeWeapon = 'sword'; self.yaw = 0;
  self.hp = self.maxHp = bot.hp = bot.maxHp = spec.attackerHp ?? spec.hp ?? 20;
  rival.hp = rival.maxHp = target.hp = target.maxHp = spec.hp ?? 20;
  self.weaponReadyTimer = rival.weaponReadyTimer = self.invulnerabilityTimer = rival.invulnerabilityTimer = 0;
  target.invulnerabilityTimer = rival.invulnerabilityTimer = spec.shield ?? 0;
  if (spec.carrier) {
    sim.match.ball.state = state.grifball.ball.state = 'held';
    sim.match.ball.holderId = state.grifball.ball.holderId = target.id;
    setSimCarrier(rival, true, sim.settings); setGrifballCarrierForState({ state, id: target.id, carrying: true });
    rival.hp = target.hp = spec.hp ?? 1;
  }
  if (spec.trade) {
    state.settings.enableSwordTrade = state.settings.enableHammerSwordTrade = true;
    sim.settings.enableSwordTrade = sim.settings.enableHammerSwordTrade = true;
    target.activeWeapon = rival.weapon = spec.trade;
    // Both victims are already committed to the same primary attack at the flight boundary.
    target.weaponState = 'swing_up'; target.weaponTimer = 0;
    rival.weaponState = 'windup'; rival.attackKind = spec.trade === 'sword' ? 'slash' : 'strike';
    rival.weaponPhaseElapsed = 0; rival.weaponTimer = spec.trade === 'sword' ? sim.settings.swordSlashSpeed * .5 : resolveHammerSlamTiming(sim.settings).windupTime;
  }
  if (spec.window) {
    const w = spec.window;
    state.settings.enableSwordTrade = sim.settings.enableSwordTrade = w.enabled !== false;
    state.settings.enableHammerSwordTrade = sim.settings.enableHammerSwordTrade = w.enabled !== false;
    state.settings.swordTradeWindow = sim.settings.swordTradeWindow = w.limitMs;
    state.settings.hammerSwordTradeWindow = sim.settings.hammerSwordTradeWindow = w.limitMs;
    target.activeWeapon = rival.weapon = w.weapon;
    // A completed attack history is supplied at the commitment boundary. Use the
    // production trigger to record its timestamp, then begin with its animation idle.
    if (w.ageMs !== undefined) {
      const historyWeapon = w.wrongWeapon ? (w.weapon === 'sword' ? 'hammer' : 'sword') : w.weapon;
      const timeMs = 1000 / 60 - w.ageMs;
      withSimulationRandom(seededRandom(31), timeMs / 1000, () => triggerCombatantAttackAction({ self: target,
        weapon: historyWeapon, recordHammerAttack: () => {}, playSwing: () => {} }));
      Object.assign(rival, { [historyWeapon === 'sword' ? 'lastSwordAttackTimeMs' : 'lastHammerAttackTimeMs']: timeMs });
      target.weaponState = 'ready'; target.weaponTimer = 0;
    }
  }
  if (spec.pairedLunge) {
    state.settings.enableSwordTrade = sim.settings.enableSwordTrade = true;
    target.activeWeapon = rival.weapon = 'sword'; target.aiState = 'LUNGING'; rival.yaw = Math.PI;
    const dir = spec.motion?.target?.direction ?? { x: 0, y: 0, z: -1 };
    withSimulationRandom(seededRandom(31), 0, () => triggerCombatantLungeAction({ self: target, settings: state.settings,
      pos: target.pos, vel: target.vel, lungeDir: new THREE.Vector3(dir.x, dir.y, dir.z).normalize(), playDash: () => {} }));
    rival.lungeTargetId = self.id;
    stepCombatantWeapons(sim, rival, { ...idleAction(), attackSecondary: true }, sim.settings, 0, []);
  }
  if (spec.reverseOrder) sim.combatants.reverse();
  // Start through the real action entry points before observing flight tick 1.
  if (spec.motion) {
    const dir = spec.motion.attacker?.direction ?? { x: 0, y: 0, z: 1 };
    withSimulationRandom(seededRandom(31), 0, () => triggerCombatantLungeAction({ self: bot, settings: state.settings,
      pos: bot.pos, vel: bot.vel, lungeDir: new THREE.Vector3(dir.x, dir.y, dir.z).normalize(), playDash: () => {} }));
  }
  self.lungeTargetId = rival.id;
  stepCombatantWeapons(sim, self, { ...idleAction(), attackSecondary: true }, sim.settings, 0, []);
  if (spec.cancel === 'dead') {
    target.hp = rival.hp = 0; rival.alive = false; target.respawnTimer = rival.respawnTimer = 10;
  }
  if (spec.friendly) { target.team = bot.team; rival.team = self.team; }
  const differences: ParityDifference[] = [], frames = [];
  let liveAttackerDamage = 0, simAttackerDamage = 0;
  let liveFirstHitTick = 0, simFirstHitTick = 0;
  let differenceCount = 0, liveDamage = 0, simDamage = 0, liveDeaths = 0, simDeaths = 0;
  const killCounts = new Map<string, number>(), deathCounts = new Map<string, number>();
  const pairs: [typeof bot, typeof self][] = [[bot, self], [target, rival]];
  const compare = (tick: number, field: string, live: unknown, headless: unknown, tolerance = 0) => {
    const same = typeof live === 'number' && typeof headless === 'number'
      ? Number.isFinite(live) && Number.isFinite(headless) && Math.abs(live - headless) <= tolerance : live === headless;
    if (!same) { differenceCount++; if (differences.length < 64) differences.push({ tick, field, live, headless, tolerance }); }
  };
  const ballMeshRef = { current: null }, ballChargingRef = { current: false }, ballChargeTimerRef = { current: 0 };
  const random = seededRandom(31);
  for (let tick = 1; tick <= 300; tick++) {
    const before = [bot.hp, target.hp], headlessBefore = [self.hp, rival.hp];
    withSimulationRandom(random, tick / 60, () => {
      f.weaponFrame(1 / 60); f.respawns(1 / 60);
      // Live roster order matters: each AI's shield ticks immediately before its own flight.
      for (const c of (spec.reverseOrder ? [target, bot] : [bot, target])) if (c.hp > 0) {
        tickCombatantInvulnerability(c, 1 / 60);
        // The scripted production path calls its gravity prelude before lunge flight.
        // After completion it owns the fall; tactical horizontal decisions stay held.
        if (spec.motion) f.gravityPrelude(c);
        if (c === target && spec.targetMovement) stepLiveGroundMotion(f, c, spec.targetMovement, tick);
        if (c === bot || spec.pairedLunge) {
          c.aiTimer = Math.max(0, (c.aiTimer ?? 0) - 1 / 60);
          if (c === bot) f.flight(); else f.targetFlight();
        }
      }
      updateGrifballObjectiveForState({ state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt: 1 / 60,
        isMultiplayer: false, activeCustomMap: map, placeCombatantsAtGrifballSpawns: () => {}, pushStatsUpdate: () => {} });
      f.visuals(1 / 60);
      reconcileGrifballCarrierForState({ state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef });
    });
    const events = stepSimulation(sim, { [self.id]: { ...idleAction(), crouch: !!spec.attackerCrouch },
      [rival.id]: { ...(spec.targetMovement
        ? groundMotionAction(rival, spec.targetMovement, tick, Math.PI, sim.settings) : idleAction()),
        aim: Math.PI, crouch: !!spec.targetCrouch } }, { settings: sim.settings });
    for (const event of events.kills) {
      const attacker = sim.combatants.find(c => c.id === event.attackerId);
      const victim = sim.combatants.find(c => c.id === event.victimId);
      if (attacker?.team !== victim?.team) killCounts.set(event.attackerId, (killCounts.get(event.attackerId) ?? 0) + 1);
      deathCounts.set(event.victimId, (deathCounts.get(event.victimId) ?? 0) + 1);
    }
    liveAttackerDamage += Math.max(0, before[0] - bot.hp); simAttackerDamage += Math.max(0, headlessBefore[0] - self.hp);
    liveDamage += Math.max(0, before[1] - target.hp); simDamage += Math.max(0, headlessBefore[1] - rival.hp);
    if (!liveFirstHitTick && before[1] > target.hp) liveFirstHitTick = tick;
    if (!simFirstHitTick && headlessBefore[1] > rival.hp) simFirstHitTick = tick;
    for (const [index, [a, b]] of pairs.entries()) {
      if (before[index] > 0 && a.hp <= 0) liveDeaths++;
      if (headlessBefore[index] > 0 && b.hp <= 0) simDeaths++;
      compare(tick, `${index}.health`, a.hp, b.hp, 1e-9);
      compare(tick, `${index}.crouching`, !!a.isCrouching, b.isCrouching);
      compare(tick, `${index}.model`, a.modelType, b.modelType);
      compare(tick, `${index}.alive`, a.hp > 0, b.alive);
      compare(tick, `${index}.respawn`, a.respawnTimer ?? 0, b.respawnTimer, 1e-6);
      compare(tick, `${index}.shield`, a.invulnerabilityTimer ?? 0, b.invulnerabilityTimer, 1e-6);
      compare(tick, `${index}.weapon`, a.activeWeapon, b.weapon);
      compare(tick, `${index}.kills`, a.kills ?? 0, killCounts.get(b.id) ?? 0);
      compare(tick, `${index}.deaths`, a.deaths ?? 0, deathCounts.get(b.id) ?? 0);
      const phase = a.weaponState === 'ready' ? 'idle' : a.weaponState === 'swing_up' ? 'windup'
        : a.weaponState === 'swing_down' ? 'active' : 'recovering';
      compare(tick, `${index}.weaponPhase`, phase, b.weaponState);
      compare(tick, `${index}.phaseElapsed`, a.weaponTimer ?? 0, b.weaponPhaseElapsed ?? 0, 1e-6);
      if (spec.pairedLunge) {
        compare(tick, `${index}.cooldown`, Math.max(0, a.aiTimer ?? 0), b.attackCooldown, 1e-6);
        compare(tick, `${index}.outcome`, a.aiLastLungeOutcome, b.lungeOutcome);
        if (a.isLunging || b.isLunging) compare(tick, `${index}.flightElapsed`, a.lungeTimer, b.lungeTimer, 1e-6);
      }
      compare(tick, `${index}.lunging`, !!a.isLunging, b.isLunging);
      if (spec.targetMovement && index === 1) {
        compare(tick, 'target.dashRemaining', a.aiDashRemaining ?? 0, b.dashRemaining, 1e-6);
        compare(tick, 'target.dashCooldown', a.aiDashCooldownTimer ?? 0, b.dashCooldownTimer, 1e-6);
      }
      if (spec.motion) compare(tick, `${index}.jumping`, !!a.isJumping, b.isJumping);
      for (const axis of ['x', 'y', 'z'] as const) {
        compare(tick, `${index}.pos.${axis}`, a.pos[axis], b.pos[axis], 1e-6);
        compare(tick, `${index}.vel.${axis}`, a.vel[axis], b.vel[axis], 1e-6);
      }
    }
    compare(tick, 'cooldown', Math.max(0, bot.aiTimer ?? 0), self.attackCooldown, 1e-6);
    compare(tick, 'outcome', bot.aiLastLungeOutcome, self.lungeOutcome);
    if (bot.isLunging || self.isLunging) compare(tick, 'flightElapsed', bot.lungeTimer, self.lungeTimer, 1e-6);
    compare(tick, 'ball.holder', state.grifball.ball.holderId, sim.match.ball.holderId);
    compare(tick, 'ball.state', state.grifball.ball.state, sim.match.ball.state);
    compare(tick, 'ball.looseTimer', state.grifball.ball.looseTimer, sim.match.ball.looseTimer, 1e-6);
    for (const axis of ['x', 'y', 'z'] as const) for (const field of ['pos', 'vel'] as const)
      compare(tick, `ball.${field}.${axis}`, state.grifball.ball[field][axis], sim.match.ball[field][axis], 1e-6);
    frames.push({ tick, live: { pos: bot.pos.toArray(), hp: bot.hp, targetHp: target.hp, lunging: !!bot.isLunging,
      vel: bot.vel.toArray(), targetPos: target.pos.toArray(), targetVel: target.vel.toArray(),
      cooldown: bot.aiTimer ?? 0, respawn: target.respawnTimer, outcome: bot.aiLastLungeOutcome },
      headless: { pos: { ...self.pos }, hp: self.hp, targetHp: rival.hp, lunging: self.isLunging,
        vel: { ...self.vel }, targetPos: { ...rival.pos }, targetVel: { ...rival.vel },
        cooldown: self.attackCooldown, respawn: rival.respawnTimer, outcome: self.lungeOutcome } });
  }
  compare(300, 'expected.liveAttackerDamage', liveAttackerDamage, spec.attackerHits ?? (spec.trade ? 1 : 0));
  compare(300, 'expected.simAttackerDamage', simAttackerDamage, spec.attackerHits ?? (spec.trade ? 1 : 0));
  compare(300, 'expected.liveDamage', liveDamage, spec.hits); compare(300, 'expected.simDamage', simDamage, spec.hits);
  compare(300, 'expected.deathFeed', f.deaths.length, spec.deaths ?? 0);
  compare(300, 'expected.liveDeaths', liveDeaths, spec.deaths ?? 0); compare(300, 'expected.simDeaths', simDeaths, spec.deaths ?? 0);
  if (spec.expectedFirstHitTick !== undefined) {
    compare(300, 'expected.liveFirstHitTick', liveFirstHitTick, spec.expectedFirstHitTick);
    compare(300, 'expected.simFirstHitTick', simFirstHitTick, spec.expectedFirstHitTick);
  }
  return { name: `${id}->${targetId}/${observer ? 'observer' : 'player-view'}/${spec.name}`, combatExecution: execution,
    scenario: spec, ticks: 300, differenceCount, differences, frames };
}

export const LUNGE_PARITY_ACTORS = [
  { id: 'main_ai', targetId: 'target' }, { id: 'bot_2', targetId: 'target' }, { id: 'bot_2', targetId: 'main_ai' },
];

export function runLungeParity() {
  return LUNGE_PARITY_ACTORS.flatMap(({ id, targetId }) => [false, true].flatMap(observer =>
    LUNGE_PARITY_CASES.map(spec => runLungeParityTrace(spec, id, observer, 'live-roster-v2', targetId))));
}

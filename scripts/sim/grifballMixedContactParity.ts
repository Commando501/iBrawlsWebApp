import * as THREE from 'three';
import { lungeFixture } from './grifballLungeFixture';
import { addParityActor, parityRecorder } from './grifballMultiActorParity';
import { triggerCombatantAttackAction, triggerCombatantLungeAction } from '../../src/components/grifball/combatantActions';
import { tickCombatantInvulnerability } from '../../src/components/grifball/aiTickState';
import { seededRandom, withSimulationRandom } from '../../src/game/simulationRandom';
import { stepCombatantWeapons } from '../../src/sim/weapons';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';
import type { Combatant } from '../../src/types';
import type { SimCombatant } from '../../src/sim/simState';

const KINDS = ['melee-first', 'lunge-first', 'same-frame-one', 'same-frame-two',
  'killed-flight', 'damaged-flight', 'trade-survivors', 'double-flight-two', 'double-flight-three'] as const;
export interface MixedContactCase {
  kind: typeof KINDS[number];
  attack: 'slash' | 'slam' | 'swipe';
  reverse: boolean;
  mainRole: 'lunger' | 'target' | 'melee';
  observer: boolean;
}
export const MIXED_CONTACT_CASES: MixedContactCase[] = KINDS.flatMap(kind =>
  (['slash', 'slam', 'swipe'] as const).flatMap(attack => [false, true].flatMap(reverse =>
    (['lunger', 'target', 'melee'] as const).flatMap(mainRole => [false, true].map(observer =>
      ({ kind, attack, reverse, mainRole, observer }))))));
const phase = (c: Combatant) => c.weaponState === 'ready' ? 'idle'
  : ['swing_up', 'melee_up'].includes(c.weaponState ?? '') ? 'windup'
  : ['swing_down', 'melee_down'].includes(c.weaponState ?? '') ? 'active' : 'recovering';

/** Committed intents, independently advanced live and headless through mixed contact. */
export function runMixedContactParityTrace(spec: MixedContactCase) {
  const id = (role: MixedContactCase['mainRole']) => spec.mainRole === role ? 'main_ai' : role;
  const f = lungeFixture(id('lunger'), spec.observer, id('target'));
  const { state, sim, bot, target } = f;
  const settings = { swordLungeSpeed: 24, attackRange: 2, attackRadius: 1.5,
    swordSlashSpeed: .22, hammerSlamWindupTime: .05, hammerSlamAttackTime: .06, hammerMeleeSpeed: .1,
    enableSwordTrade: spec.kind === 'trade-survivors', enableHammerSwordTrade: spec.kind === 'trade-survivors' };
  Object.assign(state.settings, settings); Object.assign(sim.settings, settings);
  sim.combatExecution = 'live-roster-v2'; sim.match.phase = 'playing';
  const pairs: (readonly [Combatant, SimCombatant])[] = [[bot, sim.combatants[0]], [target, sim.combatants[1]]];
  const threatenedFlight = spec.kind === 'killed-flight' || spec.kind === 'damaged-flight';
  const doubleFlight = spec.kind.startsWith('double-flight');
  const targetZ = threatenedFlight ? 12 : spec.kind === 'melee-first' ? 4.6
    : spec.kind === 'lunge-first' || spec.kind === 'trade-survivors' ? 3.8 : 4.2;
  pairs.push(addParityActor(f, id('melee'), threatenedFlight ? 'red' : 'blue', .3, threatenedFlight ? .8 : targetZ - 2));
  pairs.push(addParityActor(f, 'extra', 'blue', doubleFlight ? .2 : -.3, doubleFlight ? 0 : spec.kind === 'trade-survivors' ? targetZ - 2 : -10));
  for (const [a, b] of pairs) {
    b.id = a.id; b.controller = 'ai'; a.hp = a.maxHp = b.hp = b.maxHp = 20;
    a.invulnerabilityTimer = b.invulnerabilityTimer = b.weaponReadyTimer = 0;
    b.pos = { x: a.pos.x, y: a.pos.y, z: a.pos.z }; b.yaw = a.yaw - Math.PI;
    a.weaponState = 'ready'; a.weaponTimer = 0; a.isLunging = b.isLunging = false;
    a.vel.set(0, 0, 0); b.vel = { x: 0, y: 0, z: 0 };
  }
  target.pos.z = pairs[1][1].pos.z = targetZ;
  const targetHp = spec.kind === 'same-frame-two' || spec.kind === 'double-flight-two' ? 2
    : spec.kind === 'trade-survivors' || spec.kind === 'double-flight-three' ? 3 : 1;
  target.hp = target.maxHp = pairs[1][1].hp = pairs[1][1].maxHp = targetHp;
  bot.hp = bot.maxHp = pairs[0][1].hp = pairs[0][1].maxHp = spec.kind === 'killed-flight' ? 1
    : spec.kind === 'damaged-flight' ? 2 : spec.kind === 'trade-survivors' ? 3 : 20;
  const flightPairs = doubleFlight ? [pairs[0], pairs[3]] : [pairs[0]];
  const meleePairs = spec.kind === 'trade-survivors' ? [pairs[2], pairs[1]] : [pairs[2]];
  // Both entry points start at time zero. No resolver is run with a nonzero delta
  // before the paired loop. Every authored swing below impacts on frame 7 unless consumed.
  withSimulationRandom(seededRandom(43), 0, () => {
    for (const [a, b] of flightPairs) {
      a.activeWeapon = b.weapon = 'sword'; a.aiState = 'LUNGING'; b.yaw = 0;
      triggerCombatantLungeAction({ self: a, settings: state.settings, lungeDir: new THREE.Vector3(0, 0, 1),
        pos: a.pos, vel: a.vel, playDash: () => {} });
      b.lungeTargetId = target.id;
      stepCombatantWeapons(sim, b, { ...idleAction(), attackSecondary: true }, sim.settings, 0, []);
    }
    for (const [a, b] of meleePairs) {
      a.activeWeapon = b.weapon = spec.attack === 'slash' ? 'sword' : 'hammer';
      // Trade consumption covers primaries. The third-party attacker may still use a swipe.
      const secondary = spec.attack === 'swipe' && a !== target;
      triggerCombatantAttackAction({ self: a, weapon: b.weapon, melee: secondary, recordHammerAttack: () => {}, playSwing: () => {} });
      stepCombatantWeapons(sim, b, { ...idleAction(), attackPrimary: !secondary, attackSecondary: secondary }, sim.settings, 0, []);
    }
  });
  if (spec.reverse) { state.otherPlayers = new Map([...state.otherPlayers].reverse()); sim.combatants.reverse(); }
  const record = parityRecorder(), frames = [], random = seededRandom(43);
  const kills = new Map<string, number>(), deaths = new Map<string, number>();
  const finishedLive = new Map<string, number>(), finishedSim = new Map<string, number>();
  const firstDamageLive = new Map<string, number>(), firstDamageSim = new Map<string, number>();
  for (let tick = 1; tick <= 120; tick++) {
    const before = pairs.map(([a, b]) => ({ liveHp: a.hp, simHp: b.hp, liveFlight: !!a.isLunging, simFlight: b.isLunging }));
    withSimulationRandom(random, tick / 60, () => {
      f.weaponFrame(1 / 60); f.respawns(1 / 60);
      for (const c of state.otherPlayers.values()) if (c.hp > 0) {
        tickCombatantInvulnerability(c, 1 / 60);
        c.aiTimer = Math.max(0, (c.aiTimer ?? 0) - 1 / 60);
        if (c.isLunging) f.flightFor(c, target);
      }
      f.visuals(1 / 60);
    });
    const events = stepSimulation(sim, Object.fromEntries(pairs.map(([, c]) => [c.id, { ...idleAction(), aim: c.yaw }])), { settings: sim.settings });
    for (const e of events.kills) {
      kills.set(e.attackerId, (kills.get(e.attackerId) ?? 0) + 1);
      deaths.set(e.victimId, (deaths.get(e.victimId) ?? 0) + 1);
    }
    for (const [index, [a, b]] of pairs.entries()) {
      if (before[index].liveHp > a.hp && !firstDamageLive.has(a.id)) firstDamageLive.set(a.id, tick);
      if (before[index].simHp > b.hp && !firstDamageSim.has(b.id)) firstDamageSim.set(b.id, tick);
      if (before[index].liveFlight && !a.isLunging && !finishedLive.has(a.id)) finishedLive.set(a.id, tick);
      if (before[index].simFlight && !b.isLunging && !finishedSim.has(b.id)) finishedSim.set(b.id, tick);
      record.compare(tick, `${a.id}.health`, a.hp, b.hp);
      record.compare(tick, `${a.id}.alive`, a.hp > 0, b.alive);
      record.compare(tick, `${a.id}.lunging`, !!a.isLunging, b.isLunging);
      record.compare(tick, `${a.id}.phase`, phase(a), b.weaponState);
      record.compare(tick, `${a.id}.phaseElapsed`, a.weaponTimer ?? 0, b.weaponPhaseElapsed ?? 0, 1e-6);
      record.compare(tick, `${a.id}.respawn`, a.respawnTimer ?? 0, b.respawnTimer, 1e-6);
      record.compare(tick, `${a.id}.shield`, a.invulnerabilityTimer ?? 0, b.invulnerabilityTimer, 1e-6);
      record.compare(tick, `${a.id}.kills`, a.kills ?? 0, kills.get(b.id) ?? 0);
      record.compare(tick, `${a.id}.deaths`, a.deaths ?? 0, deaths.get(b.id) ?? 0);
      for (const axis of ['x', 'y', 'z'] as const) {
        record.compare(tick, `${a.id}.pos.${axis}`, a.pos[axis], b.pos[axis], 1e-6);
        record.compare(tick, `${a.id}.vel.${axis}`, a.vel[axis], b.vel[axis], 1e-6);
      }
      if (flightPairs.some(([c]) => c === a)) {
        record.compare(tick, `${a.id}.outcome`, a.aiLastLungeOutcome, b.lungeOutcome);
        record.compare(tick, `${a.id}.cooldown`, Math.max(0, a.aiTimer ?? 0), b.attackCooldown, 1e-6);
      }
    }
    const main = pairs.find(([a]) => a.id === 'main_ai')!;
    record.compare(tick, 'main.legacyKills', state.enemyKills, kills.get(main[1].id) ?? 0);
    record.compare(tick, 'main.legacyDeaths', state.enemyDeaths, deaths.get(main[1].id) ?? 0);
    frames.push({ tick, live: pairs.map(([c]) => ({ id: c.id, hp: c.hp, pos: c.pos.toArray(), vel: c.vel.toArray(),
      lunging: !!c.isLunging, phase: phase(c), outcome: c.aiLastLungeOutcome, kills: c.kills ?? 0, deaths: c.deaths ?? 0 })),
      headless: pairs.map(([, c]) => ({ id: c.id, hp: c.hp, pos: { ...c.pos }, vel: { ...c.vel }, lunging: c.isLunging,
        phase: c.weaponState, outcome: c.lungeOutcome, kills: kills.get(c.id) ?? 0, deaths: deaths.get(c.id) ?? 0 })) });
  }
  // Authored distances guarantee contacts on frames 6/7/8; melee impacts occur on 7.
  // These expectations are independent of agreement between the two engines.
  const expectedTargetTick = spec.kind === 'lunge-first' || spec.kind === 'trade-survivors' ? 6
    : spec.kind === 'damaged-flight' ? 27 : spec.kind === 'killed-flight' ? 0 : 7;
  const winningFlight = spec.reverse ? pairs[0] : pairs[3];
  const winner = spec.kind === 'trade-survivors' ? undefined : spec.kind === 'killed-flight' || spec.kind === 'melee-first'
    || spec.kind === 'same-frame-two' || spec.kind === 'double-flight-three' ? pairs[2]
    : spec.kind === 'double-flight-two' ? winningFlight : pairs[0];
  const victim = spec.kind === 'killed-flight' ? pairs[0] : pairs[1];
  for (const [a, b] of pairs) {
    const expectedDeaths = winner && a === victim[0] ? 1 : 0;
    record.compare(120, `${a.id}.expectedLiveDeaths`, a.deaths ?? 0, expectedDeaths);
    record.compare(120, `${a.id}.expectedSimDeaths`, deaths.get(b.id) ?? 0, expectedDeaths);
    record.compare(120, `${a.id}.expectedLiveKills`, a.kills ?? 0, a === winner?.[0] ? 1 : 0);
    record.compare(120, `${a.id}.expectedSimKills`, kills.get(b.id) ?? 0, a === winner?.[0] ? 1 : 0);
  }
  record.compare(120, 'expected.targetFirstHit.live', firstDamageLive.get(target.id) ?? 0, expectedTargetTick);
  record.compare(120, 'expected.targetFirstHit.headless', firstDamageSim.get(target.id) ?? 0, expectedTargetTick);
  const botHit = threatenedFlight ? 7 : spec.kind === 'trade-survivors' ? 6 : 0;
  record.compare(120, 'expected.lungerFirstHit.live', firstDamageLive.get(bot.id) ?? 0, botHit);
  record.compare(120, 'expected.lungerFirstHit.headless', firstDamageSim.get(bot.id) ?? 0, botHit);
  const endHealth = [spec.kind === 'killed-flight' ? 0 : spec.kind === 'damaged-flight' ? 1 : spec.kind === 'trade-survivors' ? 2 : 20,
    spec.kind === 'trade-survivors' || spec.kind === 'killed-flight' ? 1 : 0, 20, 20];
  for (const [index, hp] of endHealth.entries()) {
      record.compare(120, `expected.${index}.liveHp`, pairs[index][0].hp, hp);
      record.compare(120, `expected.${index}.simHp`, pairs[index][1].hp, hp);
  }
  for (const [a, b] of flightPairs) {
    const expectedFinish = spec.kind === 'melee-first' ? 8 : threatenedFlight ? (spec.kind === 'killed-flight' ? 7 : 27)
      : spec.kind === 'lunge-first' || spec.kind === 'trade-survivors' ? 6 : 7;
    const expectedOutcome = spec.kind === 'killed-flight' ? undefined : spec.kind === 'melee-first' ? 'target_dead' : 'hit';
    record.compare(120, `${a.id}.expectedFinish.live`, finishedLive.get(a.id), expectedFinish);
    record.compare(120, `${a.id}.expectedFinish.headless`, finishedSim.get(b.id), expectedFinish);
    record.compare(120, `${a.id}.expectedOutcome.live`, a.aiLastLungeOutcome, expectedOutcome);
    record.compare(120, `${a.id}.expectedOutcome.headless`, b.lungeOutcome, expectedOutcome);
  }
  return { name: Object.values(spec).join('/'), scenario: spec, ticks: 120, ...record.result(), frames };
}
export const runMixedContactParity = () => MIXED_CONTACT_CASES.map(runMixedContactParityTrace);

import * as THREE from 'three';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { createOfflineBotCombatant } from '../../src/game/roster';
import { buildCombatantRigForModel } from '../../src/components/grifball/combatantRig';
import { triggerCombatantAttackAction } from '../../src/components/grifball/combatantActions';
import { tickCombatantInvulnerability } from '../../src/components/grifball/aiTickState';
import { idleAction } from '../../src/sim/actions';
import { stepSimulation } from '../../src/sim/step';
import type { ParityDifference } from './grifballExecutionParity';
import type { Combatant } from '../../src/types';
import type { SimCombatant } from '../../src/sim/simState';

/** Independent paired actors; registration also exercises the real roster visual owner. */
export function addParityActor(f: ReturnType<typeof createBotParityFixture>, id: string, team: 'blue' | 'red', x: number, z: number) {
  const live = createOfflineBotCombatant({ id, playerName: id, team, spawnPos: new THREE.Vector3(x, 0, z),
    yaw: Math.PI, hue: 0, difficulty: 'normal', settings: f.state.settings, modelType: 'medium' });
  live.hp = live.maxHp = 1; live.invulnerabilityTimer = live.respawnTimer = live.swapCooldownTimer = 0;
  live.weaponState = 'ready';
  f.state.otherPlayers.set(id, live);
  const group = new THREE.Group(); group.userData.modelSystem = 'v2';
  f.refs.otherPlayerMeshes.set(id, { group, hammer: new THREE.Group(), sword: new THREE.Group(), rig: buildCombatantRigForModel(group) });
  const sim: SimCombatant = { ...structuredClone(f.sim.combatants[0]), id, team, controller: 'ai',
    pos: { x, y: 0, z }, hp: 1, maxHp: 1, yaw: 0 };
  f.sim.combatants.push(sim);
  return [live, sim] as const;
}

export function parityRecorder() {
  const differences: ParityDifference[] = [];
  let differenceCount = 0;
  return {
    compare(tick: number, field: string, live: unknown, headless: unknown, tolerance = 0) {
      const equal = typeof live === 'number' && typeof headless === 'number'
        ? Number.isFinite(live) && Number.isFinite(headless) && Math.abs(live - headless) <= tolerance : live === headless;
      if (!equal) { differenceCount++; if (differences.length < 64) differences.push({ tick, field, live, headless, tolerance }); }
    },
    result: () => ({ differenceCount, differences }),
  };
}
const phase = (c: Combatant) => c.weaponState === 'ready' ? 'idle'
  : ['swing_up', 'melee_up'].includes(c.weaponState ?? '') ? 'windup'
  : ['swing_down', 'melee_down'].includes(c.weaponState ?? '') ? 'active' : 'recovering';

export interface MultiActorCase {
  kind: 'splash' | 'focus-one-hp' | 'focus-two-hp' | 'opposing';
  attack: 'slash' | 'slam' | 'swipe';
  reverse: boolean;
  mainVictim: boolean;
  observer: boolean;
  mirror: boolean;
}
export const MULTI_ACTOR_CASES: MultiActorCase[] =
  (['splash', 'focus-one-hp', 'focus-two-hp', 'opposing'] as const).flatMap(kind =>
    (['slash', 'slam', 'swipe'] as const).flatMap(attack => [false, true].flatMap(reverse =>
      [false, true].flatMap(mainVictim => [false, true].flatMap(observer =>
        [false, true].map(mirror => ({ kind, attack, reverse, mainVictim, observer, mirror })))))));

/** Authored simultaneous attacks, real live frame owners, six actors, no copied tick state. */
export function runMultiActorParityTrace(spec: MultiActorCase) {
  const f = createBotParityFixture(spec.mainVictim ? 'attacker' : 'main_ai', spec.observer,
    { maxHP: 1, attackRange: 2, attackRadius: 1.5 }, spec.mainVictim ? 'main_ai' : 'victim');
  const { sim, state, bot, target } = f;
  sim.combatExecution = 'live-roster-v2'; sim.match.phase = 'playing';
  const pairs: (readonly [Combatant, SimCombatant])[] = [[bot, sim.combatants[0]], [target, sim.combatants[1]]];
  for (const [a, b] of pairs) {
    b.id = a.id; b.pos = { x: a.pos.x, y: a.pos.y, z: a.pos.z }; b.controller = 'ai';
    a.hp = a.maxHp = b.hp = b.maxHp = 1;
    b.weaponReadyTimer = b.invulnerabilityTimer = 0;
  }
  const focus = spec.kind.startsWith('focus');
  pairs.push(addParityActor(f, 'support', focus ? 'blue' : 'red', .3, focus ? 0 : 2));
  pairs.push(addParityActor(f, 'friendly', 'blue', -.3, 2));
  pairs.push(addParityActor(f, 'shielded', 'red', .6, 2));
  pairs.push(addParityActor(f, 'outside', 'red', 12, 2));
  pairs[4][0].invulnerabilityTimer = pairs[4][1].invulnerabilityTimer = 10;
  if (spec.kind === 'focus-two-hp') target.hp = target.maxHp = pairs[1][1].hp = pairs[1][1].maxHp = 2;
  if (spec.kind === 'opposing') {
    // Mutual reach, first actor kills the opposing pending attack before its visual update.
    pairs[2][0].pos.x = pairs[2][1].pos.x = 12;
    pairs[3][0].pos.x = pairs[3][1].pos.x = 12;
    target.yaw = 0;
  }
  const attackers = focus ? [pairs[0], pairs[2]] : spec.kind === 'opposing' ? pairs.slice(0, 2) : [pairs[0]];
  for (const [a, b] of pairs) {
    a.activeWeapon = b.weapon = spec.attack === 'slash' ? 'sword' : 'hammer';
    b.yaw = a.yaw - Math.PI;
    if (spec.mirror) {
      a.team = b.team = a.team === 'blue' ? 'red' : 'blue';
      a.pos.x *= -1; a.pos.z *= -1; b.pos.x *= -1; b.pos.z *= -1;
      a.yaw += Math.PI; b.yaw += Math.PI;
    }
  }
  if (spec.reverse) {
    state.otherPlayers = new Map([...state.otherPlayers].reverse()); sim.combatants.reverse();
  }
  // Single-spawn revival is already certified; these traces stop before revival to
  // isolate contact arbitration from the independent spawn-selection suite.
  const record = parityRecorder(), frames = [];
  const kills = new Map<string, number>(), deaths = new Map<string, number>();
  const first = spec.reverse && attackers.length > 1 ? attackers[1] : attackers[0];
  const winner = spec.kind === 'focus-two-hp' ? (first === attackers[0] ? attackers[1] : attackers[0]) : first;
  const expectedVictims = spec.kind === 'splash' ? [pairs[1], pairs[2]]
    : spec.kind === 'opposing' ? [first === pairs[0] ? pairs[1] : pairs[0]] : [pairs[1]];
  for (let tick = 1; tick <= 120; tick++) {
    f.frame(false, false, () => {
      for (const c of state.otherPlayers.values()) if (c.hp > 0) tickCombatantInvulnerability(c, 1 / 60);
      if (tick === 1) for (const [c] of attackers) triggerCombatantAttackAction({ self: c,
        weapon: spec.attack === 'slash' ? 'sword' : 'hammer', melee: spec.attack === 'swipe',
        recordHammerAttack: () => {}, playSwing: () => {} });
    });
    const events = stepSimulation(sim, Object.fromEntries(pairs.map(([a, b]) => [b.id, {
      ...idleAction(), aim: b.yaw, attackPrimary: tick === 1 && attackers.some(([c]) => c === a) && spec.attack !== 'swipe',
      attackSecondary: tick === 1 && attackers.some(([c]) => c === a) && spec.attack === 'swipe',
    }])), { settings: sim.settings });
    for (const event of events.kills) {
      kills.set(event.attackerId, (kills.get(event.attackerId) ?? 0) + 1);
      deaths.set(event.victimId, (deaths.get(event.victimId) ?? 0) + 1);
    }
    for (const [a, b] of pairs) {
      record.compare(tick, `${a.id}.hp`, a.hp, b.hp);
      record.compare(tick, `${a.id}.alive`, a.hp > 0, b.alive);
      record.compare(tick, `${a.id}.phase`, phase(a), b.weaponState);
      record.compare(tick, `${a.id}.respawn`, a.respawnTimer ?? 0, b.respawnTimer, 1e-6);
      record.compare(tick, `${a.id}.shield`, a.invulnerabilityTimer ?? 0, b.invulnerabilityTimer, 1e-6);
      record.compare(tick, `${a.id}.kills`, a.kills ?? 0, kills.get(b.id) ?? 0);
      record.compare(tick, `${a.id}.deaths`, a.deaths ?? 0, deaths.get(b.id) ?? 0);
    }
    const main = pairs.find(([c]) => c.id === 'main_ai')!;
    record.compare(tick, 'main.legacyKills', state.enemyKills, kills.get(main[1].id) ?? 0);
    record.compare(tick, 'main.legacyDeaths', state.enemyDeaths, deaths.get(main[1].id) ?? 0);
    frames.push({ tick, live: pairs.map(([c]) => ({ id: c.id, hp: c.hp, kills: c.kills ?? 0, deaths: c.deaths ?? 0, phase: phase(c) })),
      headless: pairs.map(([, c]) => ({ id: c.id, hp: c.hp, kills: kills.get(c.id) ?? 0, deaths: deaths.get(c.id) ?? 0, phase: c.weaponState })) });
  }
  for (const [a, b] of pairs) {
    const expectedDeaths = expectedVictims.some(([c]) => c === a) ? 1 : 0;
    const expectedKills = a === winner[0] ? expectedVictims.length : 0;
    record.compare(120, `${a.id}.expectedLiveDeaths`, a.deaths ?? 0, expectedDeaths);
    record.compare(120, `${a.id}.expectedSimDeaths`, deaths.get(b.id) ?? 0, expectedDeaths);
    record.compare(120, `${a.id}.expectedLiveKills`, a.kills ?? 0, expectedKills);
    record.compare(120, `${a.id}.expectedSimKills`, kills.get(b.id) ?? 0, expectedKills);
  }
  return { name: Object.values(spec).join('/'), scenario: spec, ticks: 120, ...record.result(), frames };
}
export const runMultiActorParity = () => MULTI_ACTOR_CASES.map(runMultiActorParityTrace);

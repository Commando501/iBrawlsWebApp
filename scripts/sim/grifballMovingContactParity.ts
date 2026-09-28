import { runBotExecutionParityTrace, type BotParityCase } from './grifballBotExecutionParity';
import { LUNGE_PARITY_ACTORS, runLungeParityTrace, type LungeParityCase } from './grifballLungeParity';
import type { GroundMotion } from './grifballGroundMotion';

const settings = { attackRange: 3, attackRadius: 1.5, grifballPunchLungeDistance: 2,
  speedForward: 100, speedBackward: 100, speedSide: 100, dashDistance: 4, dashDuration: .2, swordSlashSpeed: .22 };
const walk = (x: number, z: number): GroundMotion => ({ walk: [
  { tick: 1, direction: { x, z } }, { tick: 31, direction: { x: 0, z: 0 } },
] });
const dash = (x: number, z: number, tick = 1): GroundMotion => ({ dash: { tick, direction: { x, z } } });
const attacks = [
  { name: 'slash', weapon: 'sword', reach: .9, radius: 2 },
  { name: 'slam', weapon: 'hammer', reach: 3, radius: 1.5 },
  { name: 'swipe', weapon: 'hammer', secondary: true, reach: 3, radius: 1.5 },
  { name: 'punch', weapon: 'ball', reach: 2, radius: 1.5 },
] as const;

export const MOVING_ATTACK_CASES: BotParityCase[] = attacks.flatMap(a => {
  const edge = Math.sqrt(a.radius ** 2 - .375 ** 2);
  const base = { weapon: a.weapon, secondary: 'secondary' in a && a.secondary, settings };
  const cases: BotParityCase[] = [
    { ...base, name: `${a.name}-walk-into-impact`, target: { x: edge + .15, z: a.reach }, movement: { target: walk(-1, 0) }, hits: 1 },
    { ...base, name: `${a.name}-walk-out-of-impact`, target: { x: edge - .1, z: a.reach }, movement: { target: walk(1, 0) }, hits: 0 },
    { ...base, name: `${a.name}-turn-back-before-impact`, target: { x: edge - .1, z: a.reach },
      movement: { target: { walk: [{ tick: 1, direction: { x: 1, z: 0 } }, { tick: 4, direction: { x: -1, z: 0 } },
        { tick: 16, direction: { x: 0, z: 0 } }] } }, hits: 1 },
    { ...base, name: `${a.name}-dash-out-of-impact`, target: { x: 0, z: a.reach }, movement: { target: dash(1, 0) }, hits: 0 },
    { ...base, name: `${a.name}-dash-into-impact`, target: { x: 4, z: a.reach }, movement: { target: dash(-1, 0) }, hits: 1 },
  ];
  if (a.weapon !== 'ball') cases.push(
    { ...base, name: `${a.name}-walking-attacker-hit`, target: { x: 0, z: a.reach + a.radius + .5 }, movement: { attacker: walk(0, 1) }, hits: 1 },
    { ...base, name: `${a.name}-retreating-attacker-miss`, target: { x: 0, z: a.reach + a.radius - .15 }, movement: { attacker: walk(0, -1) }, hits: 0 },
    { ...base, name: `${a.name}-dash-during-windup`, settings: { ...settings, dashDistance: 2 },
      target: { x: 0, z: a.reach + 2 }, movement: { attacker: dash(0, 1, 2) }, hits: 1 },
  );
  return cases.map(c => ({ ...c, name: `moving-${c.name}`, expectedHitTick: a.weapon === 'sword' && c.hits ? 7 : undefined }));
});

const lunges: LungeParityCase[] = [
  { name: 'walking-crossing-hit', target: { x: 1.7, z: 2 }, targetMovement: walk(-1, 0), hits: 1 },
  { name: 'walking-escape-miss', target: { x: 1.4, z: 2 }, targetMovement: walk(1, 0), hits: 0 },
  { name: 'walking-retreat-caught', target: { x: 0, z: 4 }, targetMovement: walk(0, 1), hits: 1 },
  { name: 'dashing-crossing-hit', target: { x: 2, z: 2 }, targetMovement: dash(-1, 0), hits: 1 },
  { name: 'dashing-escape-miss', target: { x: 1.4, z: 2 }, targetMovement: dash(1, 0), hits: 0 },
  { name: 'dash-expiry-caught', target: { x: 0, z: 4 }, targetMovement: dash(0, 1), hits: 1 },
  { name: 'tuned-short-dash-caught', target: { x: 0, z: 4 }, targetMovement: dash(0, 1), settings: { ...settings, dashDistance: 2, dashDuration: .07 }, hits: 1 },
];
export const MOVING_LUNGE_CASES: LungeParityCase[] = [
  ...lunges.flatMap(c => [false, true].map(reverseOrder => ({ settings, ...c, reverseOrder,
    name: `moving-${c.name}-${reverseOrder ? 'target-first' : 'attacker-first'}` }))),
  ...(['walk', 'dash'] as const).flatMap(kind => [false, true].map(reverseOrder => ({ settings, reverseOrder,
    name: `moving-${kind}-before-contact-${reverseOrder ? 'target-first' : 'attacker-first'}`,
    target: { x: 1.5, z: .4 }, targetMovement: kind === 'walk' ? walk(1, 0) : dash(1, 0),
    hits: reverseOrder ? 0 : 1, expectedFirstHitTick: reverseOrder ? 0 : 1 }))),
];

export function runMovingContactParity() {
  return [
    ...['main_ai', 'bot_2'].flatMap(id => [false, true].flatMap(observer => MOVING_ATTACK_CASES.map(c =>
      runBotExecutionParityTrace(c, id, observer, 'live-roster-v2')))),
    ...LUNGE_PARITY_ACTORS.flatMap(({ id, targetId }) => [false, true].flatMap(observer => MOVING_LUNGE_CASES.map(c =>
      runLungeParityTrace(c, id, observer, 'live-roster-v2', targetId)))),
  ];
}

import { LUNGE_PARITY_ACTORS, runLungeParityTrace, type LungeParityCase } from './grifballLungeParity';

// Committed motion only: target selection, steering, recovery tactics and pressure
// are held fixed. Targets fall ballistically or follow their own committed lunge.
const flights: LungeParityCase[] = [
  { name: 'rising-attacker', motion: { attacker: { height: 2, velocityY: 6 }, target: { height: 2 } }, hits: 1 },
  { name: 'falling-attacker', motion: { attacker: { height: 3, velocityY: -4 }, target: { height: 1.5 } }, hits: 1 },
  { name: 'above-target-miss', motion: { attacker: { height: 6 } }, hits: 0 },
  { name: 'rising-target', motion: { target: { height: .5, velocityY: 7.2 } }, hits: 1 },
  { name: 'falling-target', motion: { target: { height: 2, velocityY: -6 } }, hits: 1 },
  { name: 'overhead-target-miss', motion: { target: { height: 6 } }, hits: 0 },
  { name: 'upward-commit', motion: { attacker: { direction: { x: 0, y: .6, z: .8 } }, target: { height: 2.5 } }, hits: 1 },
  { name: 'retain-upward-momentum', motion: { attacker: { velocityY: 20, direction: { x: 0, y: .6, z: .8 } }, target: { height: 2.5 } }, hits: 1 },
  { name: 'downward-commit', target: { x: 0, z: 4 }, motion: { attacker: { height: 3, velocityY: -8, direction: { x: 0, y: -.6, z: .8 } } }, hits: 1 },
  { name: 'downward-overshoot', motion: { attacker: { height: 3, velocityY: -8, direction: { x: 0, y: -.6, z: .8 } } }, hits: 0 },
  { name: 'vertical-commit', target: { x: 0, z: 0 }, motion: { attacker: { direction: { x: 0, y: 1, z: 0 } }, target: { height: 3 } }, hits: 1 },
  { name: 'land-during-timeout', target: { x: 0, z: 20 }, motion: { attacker: { height: 2 } }, settings: { swordLungeSpeed: 7 }, hits: 0 },
  { name: 'crossing-flights', target: { x: 2, z: 2 }, pairedLunge: true,
    motion: { target: { direction: { x: -1, y: 0, z: 0 } } }, hits: 1, attackerHits: 1 },
  { name: 'parallel-retreat', target: { x: 0, z: 4 }, pairedLunge: true,
    motion: { target: { direction: { x: 0, y: 0, z: 1 } } }, hits: 0, attackerHits: 0 },
  { name: 'diverging-flights', target: { x: 2, z: 4 }, pairedLunge: true,
    motion: { target: { direction: { x: 1, y: 0, z: 0 } } }, hits: 0, attackerHits: 0 },
  { name: 'airborne-crossing', target: { x: 2, z: 2 }, pairedLunge: true,
    motion: { attacker: { height: 2, velocityY: 3 }, target: { height: 2, velocityY: 3, direction: { x: -1, y: 0, z: 0 } } }, hits: 1, attackerHits: 1 },
  { name: 'vertical-crossing', target: { x: 0, z: 0 }, pairedLunge: true,
    motion: { attacker: { direction: { x: 0, y: 1, z: 0 } }, target: { height: 4, velocityY: -24, direction: { x: 0, y: -1, z: 0 } } }, hits: 1, attackerHits: 1 },
];
export const MOTION_PARITY_CASES: LungeParityCase[] = [
  ...flights.flatMap(spec => [false, true].map(reverseOrder => ({ ...spec, reverseOrder,
    name: `motion-${spec.name}-${reverseOrder ? 'target-first' : 'attacker-first'}` }))),
  ...[false, true].map(reverseOrder => ({ name: `motion-contact-before-escape-${reverseOrder ? 'target-first' : 'attacker-first'}`,
    reverseOrder, pairedLunge: true, target: { x: 1.5, z: .4 },
    motion: { target: { direction: { x: 1, y: 0, z: 0 } } },
    hits: reverseOrder ? 0 : 1, attackerHits: reverseOrder ? 0 : 1, expectedFirstHitTick: reverseOrder ? 0 : 1 })),
];

export function runMotionParity() {
  return LUNGE_PARITY_ACTORS.flatMap(({ id, targetId }) => [false, true].flatMap(observer =>
    MOTION_PARITY_CASES.map(spec => runLungeParityTrace(spec, id, observer, 'live-roster-v2', targetId))));
}

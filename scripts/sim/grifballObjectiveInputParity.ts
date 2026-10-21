import { runBotExecutionParityTrace } from './grifballBotExecutionParity';
import { parityRecorder } from './grifballMultiActorParity';

export const OBJECTIVE_INPUT_CASES = [100, 140].flatMap(forward =>
  [{ x: 0, z: 1 }, { x: 0, z: -1 }, { x: 1, z: 0 }, { x: .6, z: -.8 }].flatMap(direction =>
    ['main_ai', 'bot_2'].flatMap(id => [false, true].map(observer => ({ forward, direction, id, observer })))));
export type ObjectiveInputCase = typeof OBJECTIVE_INPUT_CASES[number];

export function validateObjectiveInput(trace: Pick<ReturnType<typeof runBotExecutionParityTrace>, 'frames'>, spec: ObjectiveInputCase) {
  const record = parityRecorder(), speed = 5.2 * spec.forward / 100;
  record.compare(0, 'expected.frameCount', trace.frames.length, 240);
  for (let tick = 1; tick <= 240; tick++) {
    const f = trace.frames[tick - 1];
    record.compare(tick, 'expected.tick', f?.tick, tick);
    for (const side of ['live', 'headless'] as const) {
      const actual = f?.[side], motion = actual?.motion?.[0];
      record.compare(tick, `expected.${side}.health`, actual?.hp, 1);
      record.compare(tick, `expected.${side}.targetHealth`, actual?.targetHp, 20);
      // Championship Stadium half-extents (61.5, 33.08), less the .6 body margin.
      for (const [axis, index, limit] of [['x', 0, 60.9], ['z', 2, 32.48]] as const) {
        const travel = spec.direction[axis] * speed * tick / 60;
        const position = Math.max(-limit, Math.min(limit, travel));
        const velocity = Math.abs(travel) > limit ? 0 : spec.direction[axis] * speed;
        const pos = motion?.pos, vel = motion?.vel;
        record.compare(tick, `expected.${side}.${axis}`, Array.isArray(pos) ? pos[index] : pos?.[axis], position, 1e-6);
        record.compare(tick, `expected.${side}.v${axis}`, Array.isArray(vel) ? vel[index] : vel?.[axis], velocity, 1e-6);
      }
      // Every ready attack is recommitted before walking; movement must retain
      // its attack facing even while travelling sideways/backwards.
      const yaw = motion?.yaw;
      record.compare(tick, `expected.${side}.facingX`, yaw === undefined ? undefined : Math.sin(yaw), Math.sin(.63 + (side === 'live' ? Math.PI : 0)), 1e-6);
      record.compare(tick, `expected.${side}.facingZ`, yaw === undefined ? undefined : Math.cos(yaw), Math.cos(.63 + (side === 'live' ? Math.PI : 0)), 1e-6);
    }
  }
  return record.result();
}
export function runObjectiveInputTrace(spec: ObjectiveInputCase) {
  const trace = runBotExecutionParityTrace({ name: 'objective-world-steering', weapon: 'sword', repeat: true, aim: .63,
    settings: { speedForward: spec.forward, speedBackward: 25, speedSide: 50 }, target: { x: 20, z: 20 }, hits: 0,
    movement: { attacker: { walk: [{ tick: 1, direction: spec.direction }] } }, movementExecution: 'scripted-objective-v1' },
  spec.id, spec.observer, 'live-roster-v2');
  const expected = validateObjectiveInput(trace, spec);
  return { ...trace, name: `objective-input/${JSON.stringify(spec)}`, input: spec,
    differenceCount: trace.differenceCount + expected.differenceCount,
    differences: [...trace.differences, ...expected.differences].slice(0, 64) };
}
export const runObjectiveInputParity = () => OBJECTIVE_INPUT_CASES.map(runObjectiveInputTrace);

import { runFrameObjectiveTrace, type FrameObjectiveCase, type CarrierCrowdCase } from './grifballFrameObjectiveParity';
import { parityRecorder } from './grifballMultiActorParity';

export interface CarrierRecoverySpec { frame: FrameObjectiveCase; crowd: CarrierCrowdCase }
export const CARRIER_RECOVERY_CASES: CarrierRecoverySpec[] = [false, true].flatMap(player =>
  (['stationary', 'cross', 'retreat'] as const).filter(motion => player || motion === 'stationary').flatMap(motion =>
    [false, true].flatMap(lunge => [1, 2, 3].flatMap(hp => [false, true].flatMap(reverse =>
      [false, true].flatMap(mirror => ([1, 3] as const).flatMap(escortHp => ([1, 12] as const).map((attackAt): CarrierRecoverySpec => ({
        frame: { player, lunge, hp, reverse, mirror, goal: false },
        crowd: { secondLunge: false, shield: false, pickup: 'tie', recovery: { motion, escortHp, attackAt } },
      })))))))));

export function runCarrierRecoveryTrace(spec: CarrierRecoverySpec, snapshotAt?: number) {
  const trace = runFrameObjectiveTrace(spec.frame, snapshotAt, undefined, spec.crowd);
  const record = parityRecorder(), { frame, crowd } = spec, { motion, escortHp, attackAt } = crowd.recovery!;
  const distant = motion === 'retreat' && attackAt === 12;
  const damage = distant && !frame.lunge ? 0 : frame.hp;
  const lethal = frame.hp <= damage;
  // With pinned 7.54-unit/s runner motion and 24-unit/s lunge motion, separation is
  // 1.511 units on tick 16 and 1.237 on tick 17, crossing the 1.5 contact radius.
  // The slash at tick 12 is already out of reach; both collectors remain behind.
  const deathTick = distant ? 17 : attackAt;
  const runnerId = frame.player ? 'player' : 'target';
  const earlyEscortPickup = !distant && frame.lunge && frame.reverse;
  // Early possession applies runner HP before the later slash. A three-HP escort
  // becomes a carrier here and dies from that same frame's second sword attack.
  const escortDead = escortHp === 1 || earlyEscortPickup;
  const finalHolder = !lethal ? runnerId : distant ? null : escortDead || !frame.reverse ? 'interceptor' : 'escort';
  const firstHolder = distant || !lethal ? runnerId : frame.lunge && !frame.reverse ? 'interceptor' : null;
  const firstSlash = frame.lunge || frame.reverse ? 'support' : 'attacker';
  const runnerKiller = !lethal ? null : frame.lunge ? 'attacker' : firstSlash;
  for (const side of ['live', 'headless'] as const) {
    const first = trace.frames[attackAt - 1][side], last = trace.frames.at(-1)![side];
    record.compare(attackAt, `expected.${side}.attackHealth`, first.hp, distant ? frame.hp : 0);
    record.compare(attackAt, `expected.${side}.firstPossession`, first.ball.holderId, firstHolder);
    record.compare(120, `expected.${side}.finalHealth`, last.hp, Math.max(0, frame.hp - damage));
    record.compare(120, `expected.${side}.finalPossession`, last.ball.holderId, finalHolder);
    record.compare(120, `expected.${side}.runnerDeaths`, last.runnerDeaths, lethal ? 1 : 0);
    record.compare(120, `expected.${side}.noGoal`, last.goals, 0);
    if (!distant) record.compare(attackAt + 1, `expected.${side}.nextPickup`, trace.frames[attackAt][side].ball.holderId, finalHolder);
    if (distant && frame.lunge) {
      record.compare(16, `expected.${side}.beforeLungeContact`, trace.frames[15][side].hp, frame.hp);
      record.compare(17, `expected.${side}.lungeContact`, trace.frames[16][side].hp, 0);
    }
    for (const f of trace.frames) {
      const movingTicks = lethal ? Math.min(f.tick, deathTick) : f.tick;
      const sign = frame.mirror ? -1 : 1;
      record.compare(f.tick, `expected.${side}.runnerX`, f[side].runnerPos[0], motion === 'cross' ? sign * movingTicks * 7.54 / 60 * .25 : 0, 1e-6);
      record.compare(f.tick, `expected.${side}.runnerZ`, f[side].runnerPos[2], motion === 'retreat' ? sign * movingTicks * 7.54 / 60 : 0, 1e-6);
      if (f.tick < attackAt) record.compare(f.tick, `expected.${side}.beforeAttack`, f[side].hp, frame.hp);
    }
  }
  for (const side of ['liveCrowd', 'simCrowd'] as const) {
    const actors = trace.frames.at(-1)![side]!;
    for (const id of ['attacker', 'support']) {
      const actor = actors.find(c => c.id === id)!;
      record.compare(120, `expected.${side}.${id}.kills`, actor.kills, Number(runnerKiller === id) + Number(escortDead && firstSlash === id));
      record.compare(120, `expected.${side}.${id}.health`, actor.hp, 1);
    }
    for (const id of ['escort', 'interceptor']) {
      const actor = actors.find(c => c.id === id)!;
      const expectedHp = id === 'interceptor' ? finalHolder === id ? frame.hp : 1
        : escortDead ? 0 : finalHolder === id ? frame.hp : escortHp - (frame.lunge ? 1 : 2);
      record.compare(120, `expected.${side}.${id}.health`, actor.hp, expectedHp);
      record.compare(120, `expected.${side}.${id}.deaths`, actor.deaths, id === 'escort' && escortDead ? 1 : 0);
    }
  }
  const expected = record.result();
  return { ...trace, differenceCount: trace.differenceCount + expected.differenceCount, differences: [...trace.differences, ...expected.differences].slice(0, 64) };
}
export const runCarrierRecoveryParity = () => CARRIER_RECOVERY_CASES.map(c => runCarrierRecoveryTrace(c));

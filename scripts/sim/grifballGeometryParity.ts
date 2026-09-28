import { runBotExecutionParityTrace, type BotParityCase } from './grifballBotExecutionParity';
import { LUNGE_PARITY_ACTORS, runLungeParityTrace, type LungeParityCase } from './grifballLungeParity';

// Independent, authored geometry oracle: roster impact height 1.2, body centers
// .825/.52, target radius bonus .2 for Large. Do not derive these boundaries from
// either hit resolver: matching two incorrect implementations must still fail.
const attacks = [
  { name: 'slash', weapon: 'sword', reach: .9, radius: 2 },
  { name: 'slam', weapon: 'hammer', reach: 3, radius: 1.5 },
  { name: 'swipe', weapon: 'hammer', secondary: true, reach: 3, radius: 1.5 },
  { name: 'punch', weapon: 'ball', reach: 2, radius: 1.5 },
] as const;
const postures = [false, true].flatMap(attackerCrouch => [false, true].map(targetCrouch => ({ attackerCrouch, targetCrouch })));
const sides = [{ name: 'inside', offset: -.01, hits: 1 }, { name: 'outside', offset: .01, hits: 0 }];
const poseName = (a: boolean, b: boolean) => `${a ? 'crouch' : 'stand'}-to-${b ? 'crouch' : 'stand'}`;

export const STATIONARY_GEOMETRY_CASES: BotParityCase[] = attacks.flatMap(attack =>
  (['medium', 'large'] as const).flatMap(targetModel => postures.flatMap(pose => sides.map(side => {
    const radius = attack.radius + (targetModel === 'large' ? .2 : 0);
    const height = 1.2 - (pose.targetCrouch ? .52 : .825);
    return { name: `geometry-${attack.name}-${targetModel}-${poseName(pose.attackerCrouch, pose.targetCrouch)}-${side.name}`,
      weapon: attack.weapon, secondary: 'secondary' in attack && attack.secondary, targetModel, ...pose,
      settings: { attackRange: 3, attackRadius: 1.5, grifballPunchLungeDistance: 2 },
      target: { x: Math.sqrt(radius * radius - height * height) + side.offset, z: attack.reach }, hits: side.hits };
  }))));

// A larger attacker must not increase reach against a medium target.
STATIONARY_GEOMETRY_CASES.push(...attacks.map(attack => ({
  name: `geometry-${attack.name}-large-attacker-medium-target`, weapon: attack.weapon,
  secondary: 'secondary' in attack && attack.secondary, attackerModel: 'large' as const,
  settings: { attackRange: 3, attackRadius: 1.5, grifballPunchLungeDistance: 2 },
  target: { x: Math.sqrt(attack.radius ** 2 - .375 ** 2) + .01, z: attack.reach }, hits: 0,
})));

export const LUNGE_GEOMETRY_CASES: LungeParityCase[] = (['medium', 'large'] as const).flatMap(targetModel =>
  postures.flatMap(pose => sides.map(side => {
    const radius = 1.5 + (targetModel === 'large' ? .2 : 0);
    const height = pose.attackerCrouch === pose.targetCrouch ? 0 : .305;
    return { name: `geometry-lunge-${targetModel}-${poseName(pose.attackerCrouch, pose.targetCrouch)}-${side.name}`,
      targetModel, ...pose, settings: { swordLungeSpeed: 30 },
      // First flight tick reaches z=.5; later ticks can only move farther away.
      target: { x: Math.sqrt(radius * radius - height * height) + side.offset, z: .5 }, hits: side.hits };
  })));
LUNGE_GEOMETRY_CASES.push({ name: 'geometry-lunge-large-attacker-medium-target', attackerModel: 'large',
  settings: { swordLungeSpeed: 30 }, target: { x: 1.51, z: .5 }, hits: 0 });
LUNGE_GEOMETRY_CASES.push(...(['medium', 'large'] as const).flatMap(targetModel => [false, true].map(crouch => ({
  name: `geometry-lunge-${targetModel}-${crouch ? 'crouch' : 'stand'}-exact-contact`, targetModel,
  attackerCrouch: crouch, targetCrouch: crouch, settings: { swordLungeSpeed: 30 },
  target: { x: targetModel === 'large' ? 1.7 : 1.5, z: .5 }, hits: 1,
}))));

export function runGeometryParity() {
  return [
    ...['main_ai', 'bot_2'].flatMap(id => [false, true].flatMap(observer =>
      STATIONARY_GEOMETRY_CASES.map(spec => runBotExecutionParityTrace(spec, id, observer, 'live-roster-v2')))),
    ...LUNGE_PARITY_ACTORS.flatMap(({ id, targetId }) => [false, true].flatMap(observer =>
      LUNGE_GEOMETRY_CASES.map(spec => runLungeParityTrace(spec, id, observer, 'live-roster-v2', targetId)))),
  ];
}

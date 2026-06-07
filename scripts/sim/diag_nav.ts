// Diagnostic: can a scripted DISCRETE policy (via decodeAction, the same path the RL net
// uses) navigate to the ball and score? If yes, the action path is fine and the issue is
// learning; if no, decodeAction/movement is broken.
import { createMatch, resolveSimSettings } from '../../src/sim/factory';
import { stepSimulation } from '../../src/sim/step';
import { decodeAction } from '../../src/sim/env/action';
import { type ActionsById } from '../../src/sim/actions';

const settings = resolveSimSettings();
const s = createMatch({ seed: 1 });
// Skip countdown.
for (let i = 0; i < 200 && s.match.phase !== 'playing'; i++) stepSimulation(s, {}, { settings });

const me = s.combatants.find((c) => c.team === 'blue')!;
let grabbedAt = -1;
let scoredAt = -1;
const obsBallHolder = () => s.match.ball.holderId;

for (let t = 0; t < 3600; t++) {
  // Discrete factors: [move, aim, attack, jump, dash, swap]
  // not carrying -> aim toward ball (1), move forward (1); carrying -> aim toward enemy goal (2)
  const carrying = me.hasBall;
  const factors = carrying ? [1, 2, 0, 0, 0, 0] : [1, 1, 0, 0, 0, 0];
  const actions: ActionsById = { [me.id]: decodeAction(factors, s, me.id) };
  const ev = stepSimulation(s, actions, { settings });
  if (grabbedAt < 0 && me.hasBall) grabbedAt = t;
  if (ev.goal === 'blue') { scoredAt = t; break; }
}

console.log('ball start holder:', obsBallHolder());
console.log('me start pos vs ball: me at blue spawn, ball at home (0,0,~0.35)');
console.log('grabbed ball at tick:', grabbedAt, grabbedAt >= 0 ? '(OK)' : '(NEVER)');
console.log('scored at tick:', scoredAt, scoredAt >= 0 ? '(OK)' : '(NEVER)');
console.log('final hasBall:', me.hasBall, 'blue goals:', s.scores.blue.goals);

import { planGrifballPass } from '../game/aiGrifballPassing';
import { createSnapshotRouters } from '../game/aiGrifballRunner';
import { defaultGrifballTactics, resolveTeamTactics } from '../game/grifballTacticsConfig';
import { resolveRunnerThrowAllowed } from '../game/runnerBallSettings';
import { isNeuralNetDifficulty } from '../game/neuralBrains';
import type { SimState } from './simState';
import type { ScriptedObjectivePlanner } from './scriptedObjectivePlanner';
import { createSimGrifballTacticalSnapshot } from './grifballTacticalAdapter';

export type ScriptedPassFrame = { kind: 'cancelled'; reason: string }
  | { kind: 'charging'; carrierId: string; receiverId: string; elapsed: number }
  | { kind: 'release'; carrierId: string; receiverId: string; speed: number; direction: { x: number; z: number } };

/** Own-state pass charge and release decision. Runs after movement/intent and the
 * phase clock, before ball physics. The objective host performs the actual throw. */
export function resolveSimScriptedGrifballPass(state: SimState, planner: ScriptedObjectivePlanner, dt: number): ScriptedPassFrame {
  const plan = planner.plan, ball = state.match.ball;
  const cancel = (reason: string): ScriptedPassFrame => { plan.passCharge = null; return { kind: 'cancelled', reason }; };
  const carrier = state.combatants.find(c => c.id === ball.holderId);
  const scripted = (id: string) => Object.hasOwn(planner.scriptedBots, id) && !isNeuralNetDifficulty(planner.scriptedBots[id]);
  const assignment = carrier && plan.assignments.get(carrier.id), selected = assignment?.pass?.selected;
  const tuning = carrier && resolveTeamTactics(planner.tactics ?? defaultGrifballTactics(), carrier.team);
  if (state.mode !== 'grifball' || state.match.phase !== 'playing' || ball.state !== 'held' || !carrier ||
    carrier.weapon !== 'ball' || carrier.controller !== 'ai' || !scripted(carrier.id) ||
    isNeuralNetDifficulty(state.settings.aiDifficulty) || !Object.hasOwn(planner.punchControl?.cooldowns ?? {}, carrier.id) ||
    !carrier.alive || carrier.hp <= 0 || carrier.respawnTimer > 0 || !selected || !resolveRunnerThrowAllowed(state.settings) ||
    !tuning?.enabled || !tuning.spaceEnabled || !tuning.passingEnabled || !plan.snapshot?.geometry ||
    carrier.weaponState !== 'idle' || carrier.swapLockoutTimer > 0 || carrier.weaponReadyTimer > 0 ||
    planner.punchControl!.cooldowns[carrier.id] > 0 || carrier.isLunging || carrier.isJumping || carrier.pos.y > .01 ||
    carrier.vel.y !== 0 || carrier.dashRemaining > 0 || carrier.slideActive) return cancel('carrier-or-pass-unavailable');
  const receiver = state.combatants.find(c => c.id === selected.receiverId);
  if (!receiver || !receiver.alive || receiver.hp <= 0 || receiver.respawnTimer > 0 || receiver.team !== carrier.team ||
    receiver.controller !== 'ai' || !scripted(receiver.id)) return cancel('receiver-unavailable');
  let charge = plan.passCharge;
  if (!charge || charge.carrierId !== carrier.id || charge.receiverId !== receiver.id || charge.speed !== selected.speed)
    charge = plan.passCharge = { carrierId: carrier.id, receiverId: receiver.id, speed: selected.speed, elapsed: 0 };
  charge.elapsed += Math.max(0, dt);
  if (charge.elapsed + 1e-9 < selected.chargeSeconds)
    return { kind: 'charging', carrierId: carrier.id, receiverId: receiver.id, elapsed: charge.elapsed };

  // Keep this plan's geometry/observed roster, replacing observations with this
  // engine's current positions and weapon clocks. Never use live engine state.
  const current = createSimGrifballTacticalSnapshot(state, { scriptedBots: planner.scriptedBots, tactics: planner.tactics });
  const snapshot = { ...plan.snapshot, passing: current.passing,
    players: plan.snapshot.players.flatMap(p => { const fresh = current.players.find(c => c.id === p.id); return fresh ? [fresh] : []; }) };
  const observedCarrier = snapshot.players.find(p => p.id === carrier.id);
  if (!observedCarrier) return cancel('carrier-observation-missing');
  const fresh = planGrifballPass(snapshot, observedCarrier, assignment?.tuning ?? tuning, createSnapshotRouters(snapshot));
  const pass = fresh.candidates.find(c => c.receiverId === receiver.id && c.speed === selected.speed && c.viable);
  if (!pass) { assignment!.pass = fresh; return cancel('release-no-longer-safe'); }
  plan.passCharge = null;
  return { kind: 'release', carrierId: carrier.id, receiverId: receiver.id, speed: pass.speed, direction: { ...pass.direction } };
}

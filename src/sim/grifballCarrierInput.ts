import { resolveGrifballCarrierDecision } from '../game/aiGrifballObjectiveSteering';
import type { GrifballTeamPlanState } from '../game/aiGrifballTeamPlan';
import { resolveDirectionalSpeedMultiplier } from '../game/runnerBallSettings';
import { getYawForHeading } from '../game/yaw';
import type { SimState } from './simState';
import { idleAction } from './actions';
import { resolveSimGrifballGroundActor } from './grifballSupportInput';
import { SCRIPTED_OBJECTIVE_INPUT_VERSION, validateScriptedObjectiveInput, type ScriptedObjectiveInput } from './scriptedObjectiveInput';

/** Carrier movement and explicit punch/pass handoffs. The caller supplies its
 * own AI readiness after ticking controller cooldowns. No live state is read.
 * A handoff contains no executable input: another owner must commit that action.
 * execution is reserved for callers owning the corresponding reload/pass clocks. */
export function resolveSimGrifballCarrierInput(state: SimState, plan: GrifballTeamPlanState, botId: string,
  scriptedBots: Readonly<Record<string, string>>, canStartWeaponAction: boolean, dt = 1 / 60,
  execution: { punch?: boolean; pass?: boolean } = {}) {
  const actor = resolveSimGrifballGroundActor(state, botId, scriptedBots, dt);
  if (!actor || !actor.hasBall || state.match.ball.state !== 'held' || state.match.ball.holderId !== botId) return null;
  const threats = state.combatants.filter(c => c.id !== botId && c.team !== actor.team && c.alive && c.hp > 0 && c.respawnTimer <= 0);
  if (state.combatExecution === 'live-mixed-v1') threats.sort((a, b) => Number(b.id === state.localPlayerId) - Number(a.id === state.localPlayerId));
  const decision = resolveGrifballCarrierDecision({ assignment: plan.assignments.get(botId), pos: actor.pos,
    players: plan.snapshot?.players ?? [], threats, avoidanceEnemies: threats.map(c => c.pos),
    goal: state.goalPlates.find(p => p.team !== actor.team)?.position ?? null,
    weaponState: actor.weaponState === 'idle' ? 'ready' : actor.weaponState === 'windup' ? 'swing_up' : actor.weaponState === 'active' ? 'swing_down' : 'recovering',
    canStartWeaponAction, settings: state.settings, dt });
  if (!decision) return null;
  if (decision.kind === 'pass' && !execution.pass || decision.kind === 'punch' && !execution.punch) return { decision, input: null };
  const speed = 5.8 * resolveDirectionalSpeedMultiplier(state.settings, 'forward', true);
  const scriptedObjective: ScriptedObjectiveInput = { version: SCRIPTED_OBJECTIVE_INPUT_VERSION, scriptedBots,
    movement: { [botId]: { x: decision.velocity.x / speed, z: decision.velocity.z / speed } } };
  const action = { ...idleAction(), attackPrimary: decision.kind === 'punch', aim: decision.heading && actor.weaponState === 'idle'
    ? getYawForHeading(decision.heading.x, decision.heading.z) - Math.PI : actor.yaw };
  validateScriptedObjectiveInput(state, scriptedObjective, { [botId]: action }, state.settings);
  return { decision, input: { action, scriptedObjective } };
}

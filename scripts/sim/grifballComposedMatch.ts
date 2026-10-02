import * as THREE from 'three';
import { createMatch, inwardSpawnYaw } from '../../src/sim/factory';
import { createRng } from '../../src/sim/rng';
import { createAIMatchContext } from '../../src/game/aiMatchContext';
import { resolvePersonalityFlags } from '../../src/game/aiPersonalities';
import { getGrifballTeamSpawn } from '../../src/components/grifball/arenaSpawns';
import { createSimGrifballActorStepOptions, type SimGrifballActorControl } from '../../src/sim/grifballActorOwner';
import { stepSimulation } from '../../src/sim/step';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { validationLocalInput, LOCAL_INPUT_PROTOCOL } from '../../src/game/grifballValidation/localPlayerInput';
import { idleAction, type ActionsById } from '../../src/sim/actions';
import type { FrozenCase, ValidationJob } from '../../src/game/grifballValidation/types';
import type { SimCombatPriorityMemory } from '../../src/sim/grifballCombatPriorities';

export const COMPOSED_MATCH_PROTOCOL = 'composed-grifball-match-v1';

/** Fresh match initialization from the same frozen inputs as the production
 * host. No positions, actions, damage or plan state are copied from a live run. */
export function createComposedValidationMatch(fixture: FrozenCase, job: ValidationJob) {
  if (fixture.specification.mode !== 'match' || fixture.specification.id !== job.caseId || fixture.inputHash !== job.inputHash ||
    fixture.specification.fixedHz !== 60 || fixture.observer === 'local-input' && fixture.localInput !== LOCAL_INPUT_PROTOCOL)
    throw new Error('Composed match requires matching frozen full-match inputs');
  const state = createMatch({ seed: job.seed, combatExecution: 'live-mixed-v1', settings: fixture.mechanics,
    map: structuredClone(fixture.map), teamSizes: { blue: 1, red: 1 } });
  state.localPlayerId = 'player'; state.localPlayerIsObserver = fixture.observer === 'outside-roster';
  const [player, template] = state.combatants;
  const used: THREE.Vector3[] = [], fallback = fixture.map.spawnPoints.map(p => new THREE.Vector3(p.x, p.y, p.z));
  const spawn = (team: string) => {
    const p = getGrifballTeamSpawn(fixture.map, team, fallback, used); used.push(p.clone());
    return { pos: { x: p.x, y: p.y, z: p.z }, yaw: (p.spawnYaw ?? inwardSpawnYaw(p)) - Math.PI };
  };
  if (state.localPlayerIsObserver) Object.assign(player, { pos: { x: 0, y: 35, z: 30 }, alive: false, hp: 0 });
  else Object.assign(player, spawn('blue'), { invulnerabilityTimer: fixture.mechanics.respawnInvulnerabilityDuration });
  state.combatants = [player, ...fixture.roster.map(actor => ({ ...structuredClone(template), id: actor.id,
    team: actor.slot.team, ...spawn(actor.slot.team), modelType: fixture.modelType,
    invulnerabilityTimer: fixture.mechanics.respawnInvulnerabilityDuration, pauseDuringInactiveGrifball: true }))];
  if (job.mirrored) {
    const blue = state.goalPlates.find(p => p.team === 'blue')!.position, red = state.goalPlates.find(p => p.team === 'red')!.position;
    for (const c of state.combatants) if (c !== player || !state.localPlayerIsObserver) {
      c.team = c.team === 'blue' ? 'red' : 'blue';
      c.pos.x = blue.x + red.x - c.pos.x; c.pos.z = blue.z + red.z - c.pos.z; c.yaw += Math.PI;
    }
  }
  const memories: Record<string, SimCombatPriorityMemory> = Object.fromEntries(fixture.roster.map(a => [a.id, {
    aiState: 'APPROACHING', timer: 0, swayTimer: 0, coordCommitTimer: 0, cooldownMultiplier: 1, pendingPostEvasionCharge: false,
  }]));
  const matchContext = createAIMatchContext(); matchContext.grifballTeamPlan.styleSeed = job.seed;
  // Scores used by the live combat personality are local/main kills, not team goals.
  const checkpoint = { protocol: COMPOSED_MATCH_PROTOCOL, caseId: job.caseId, inputHash: job.inputHash, jobId: job.id,
    state, memories, matchContext, randomState: createRng(job.seed).getState(),
    defaultsInitialized: false, scorePlayer: 0, scoreEnemy: 0, punchCooldowns: Object.fromEntries(fixture.roster.map(a => [a.id, 0])) };
  return { checkpoint, fixture, job };
}
export type ComposedMatchCheckpoint = ReturnType<typeof createComposedValidationMatch>['checkpoint'];

/** Rebuild after checkpoint restore or map changes; caches are not persistence. */
export function createComposedMatchStepper(fixture: FrozenCase, job: ValidationJob, checkpoint: ComposedMatchCheckpoint) {
  if (checkpoint.protocol !== COMPOSED_MATCH_PROTOCOL || checkpoint.caseId !== job.caseId || checkpoint.inputHash !== job.inputHash ||
    checkpoint.jobId !== job.id || fixture.inputHash !== job.inputHash ||
    checkpoint.state.localPlayerIsObserver !== (fixture.observer === 'outside-roster'))
    throw new Error('Composed match checkpoint does not match its frozen job');
  const rng = createRng(0); rng.setState(checkpoint.randomState);
  const control: SimGrifballActorControl = {
    scriptedBots: Object.fromEntries(fixture.roster.map(a => [a.id, a.effectiveKnobs.difficulty])),
    configs: Object.fromEntries(fixture.roster.map(a => [a.id, { knobs: a.effectiveKnobs, derived: a.derived,
      flags: resolvePersonalityFlags(a.slot.archetype, { spacingBand: a.slot.spacingBand ?? fixture.mechanics.aiSpacingBand,
        skipPressure: a.slot.skipPressure ?? fixture.mechanics.aiSkipPressure }) }])),
    memories: checkpoint.memories, matchContext: checkpoint.matchContext, random: rng.next,
    getScoreContext: () => ({ scorePlayer: checkpoint.scorePlayer, scoreEnemy: checkpoint.scoreEnemy }),
    isObserverMode: fixture.observer === 'outside-roster', spawnPoints: fixture.map.spawnPoints, navigation: {},
  };
  control.planner = { version: 'scripted-objective-planner-v1', scriptedBots: control.scriptedBots,
    plan: checkpoint.matchContext.grifballTeamPlan, tactics: job.config, passControl: 'scripted-pass-v1',
    punchControl: { version: 'scripted-carrier-punch-v1', cooldowns: checkpoint.punchCooldowns } };
  return () => {
    const state = checkpoint.state;
    if (state.match.phase === 'matchEnd' || state.tick >= job.simulationTicks) return null;
    // Live ordinary roster defaults initialize on their first AI tick, even
    // during countdown. Retain the same draw order across restored runs.
    if (!checkpoint.defaultsInitialized) {
      for (const actor of fixture.roster) checkpoint.memories[actor.id].swayTimer = rng.next() * Math.PI;
      checkpoint.defaultsInitialized = true;
    }
    const actions: ActionsById = {};
    if (!control.isObserverMode) {
      const input = validationLocalInput(createSimGrifballTacticalSnapshot(state,
        { scriptedBots: control.scriptedBots, tactics: job.config }), state.tick);
      actions.player = { ...idleAction(), aim: input.yaw - Math.PI, moveZ: input.forward ? 1 : 0,
        attackPrimary: input.attack === 'primary', pickup: input.pickup };
    }
    const events = stepSimulation(state, actions, { ...createSimGrifballActorStepOptions(state, control), mixedArenaFrame: true });
    for (const kill of events.kills) {
      if (kill.attackerId === 'player') checkpoint.scorePlayer++;
      if (kill.attackerId === 'main_ai') checkpoint.scoreEnemy++;
    }
    checkpoint.randomState = rng.getState();
    return events;
  };
}

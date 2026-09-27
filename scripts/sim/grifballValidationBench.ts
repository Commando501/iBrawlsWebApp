import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { DEFAULT_ADMIN_SETTINGS } from '../../src/settings/gameplaySettings';
import { createInitialGrifballRuntimeState } from '../../src/components/grifball/runtimeState';
import { createLiveGrifballTacticalSnapshot } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { createOfflineBotCombatant } from '../../src/game/roster';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { createGrifballTeamPlanState, updateGrifballTeamPlan } from '../../src/game/aiGrifballTeamPlan';
import { GrifballEvaluationTracker } from '../../src/game/grifballEvaluation';
import type { CustomMapData } from '../../src/types';

// Isolates warm snapshot/planner/evaluator costs from rendering, combat and scheduling.
// Eight participants: one observed human and seven scripted bots. No universal timing assertions.
const summarize = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return { samples: sorted.length, medianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(3),
    p95Ms: +sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(3), maxMs: +sorted[sorted.length - 1].toFixed(3) };
};
for (const obstacles of [false, true]) {
  const state = createInitialGrifballRuntimeState({ debugMode: false,
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball' }, isMultiplayer: false, multiplayerRole: null });
  state.grifballTactics = defaultGrifballTactics(); state.grifball.phase = 'playing'; state.arenaRadius = 52;
  state.isObserverMode = false; state.localPlayerTeam = 'red'; state.playerPos.set(4, 0, 10.5);
  state.playerVel.set(0, 0, 0); state.activeWeapon = 'hammer'; state.pWeaponState = 'ready'; state.pWeaponTimer = 0;
  state.otherPlayers.clear();
  for (let i = 0; i < 7; i++) {
    const bot = createOfflineBotCombatant({ id: `p${i}`, playerName: `p${i}`, team: i % 2 ? 'red' : 'blue',
      spawnPos: new THREE.Vector3(i % 2 ? 4 : -4, 0, (i - 3.5) * 3), yaw: 0, hue: 0, difficulty: 'normal', settings: state.settings });
    bot.activeWeapon = i === 0 ? 'ball' : 'hammer'; bot.weaponState = 'ready';
    state.otherPlayers.set(bot.id, bot);
  }
  state.grifball.ball.state = 'held'; state.grifball.ball.holderId = 'p0';
  Object.assign(state.grifball.ball.pos, state.otherPlayers.get('p0')!.pos);
  const map = { mapShape: 'rectangular', arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 }, objects: obstacles ? [
    { type: 'box', position: { x: 0, y: 1, z: 0 }, scale: { x: 1, y: 2, z: 15 }, isCollidable: true },
    { type: 'cylinder', position: { x: 12, y: 1, z: 10 }, scale: { x: 4, y: 2, z: 4 }, isCollidable: true },
  ] : [] } as CustomMapData;
  const goal = (team: string | undefined) => ({ x: team === 'blue' ? 47 : -47, z: 0 });
  const plan = createGrifballTeamPlanState(), tracker = new GrifballEvaluationTracker();
  const snapshotMs: number[] = [], refreshMs: number[] = [], betweenMs: number[] = [], evaluationMs: number[] = [];
  let refreshes = 0;
  for (let i = 0; i < 720; i++) {
    const start = performance.now(), snapshot = createLiveGrifballTacticalSnapshot(state, goal, map), observed = performance.now();
    const revision = plan.revision;
    updateGrifballTeamPlan(plan, snapshot, 1 / 60); const planned = performance.now();
    tracker.sample({ phase: state.grifball.phase, holderId: snapshot.holderId, holderTeam: 'blue',
      goals: { blue: 0, red: 0 }, players: snapshot.players, assignments: plan.assignments.values(), geometry: snapshot.geometry }, 1 / 60);
    const evaluated = performance.now();
    if (i < 120) continue; // Warm up the geometry cache and JIT separately from measured ticks.
    snapshotMs.push(observed - start); evaluationMs.push(evaluated - planned);
    if (revision !== plan.revision) { refreshMs.push(planned - observed); refreshes++; }
    else betweenMs.push(planned - observed);
  }
  console.log(JSON.stringify({ participants: 8, obstacles, measuredSeconds: 10, refreshes,
    snapshot: summarize(snapshotMs), plannerRefresh: summarize(refreshMs), plannerBetweenRefreshes: summarize(betweenMs),
    evaluator: summarize(evaluationMs) }));
}

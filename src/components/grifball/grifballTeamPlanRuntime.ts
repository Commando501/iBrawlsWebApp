import { createGrifballTacticalSnapshot } from '../../game/grifballTacticalContract';
import { getGrifballTeamSpawn, createDefaultSpawnPoints } from './arenaSpawns';
import { setTacticalBotEngagements, type BotCoordRole } from '../../game/aiBotCoordinator';
import { updateGrifballTeamPlan, resetGrifballTeamPlan, selectGrifballAssignmentThreat, type GrifballTacticalPlayer } from '../../game/aiGrifballTeamPlan';
import { isNeuralNetDifficulty } from '../../game/neuralBrains';
import type { GrifballRuntimeState } from './runtimeState';
import { GRAVITY_ACCELERATION, MELEE_SWORD_SLASH_REACH } from './combatGeometry';
import type { CustomMapData } from '../../types';
import { observeGrifballSpace } from '../../game/aiGrifballSpace';

/** Read-only live adapter, also exercised against headless fixtures in contract tests. */
export function createLiveGrifballTacticalSnapshot(
  state: GrifballRuntimeState,
  getEnemyGoalPos: (team: string | undefined) => { x: number; z: number } | null,
  activeCustomMap: CustomMapData | null = null,
) {
  const players: GrifballTacticalPlayer[] = [];
  const point = (p: { x: number; z: number }) => ({ x: p.x, z: p.z });
  if (!state.isObserverMode && state.playerHP > 0 && state.playerRespawnTimer <= 0) {
    players.push({ id: 'player', team: state.localPlayerTeam, pos: point(state.playerPos), vel: point(state.playerVel), heading: { x: -Math.sin(state.yaw), z: -Math.cos(state.yaw) }, scripted: false, difficulty: state.settings.aiDifficulty, height: state.playerPos.y, pickupRequested: state.playerPickupRequested });
    players[players.length - 1].space = observeGrifballSpace(state.settings, state.activeWeapon,
      state.activeWeapon === 'sword' ? state.pSwordState : state.pWeaponState,
      state.activeWeapon === 'sword' ? state.pSwordTimer : state.pWeaponTimer,
      state.swapLockoutTimer ?? 0, state.playerPos.y, state.playerVel.y, GRAVITY_ACCELERATION, MELEE_SWORD_SLASH_REACH);
  }
  for (const bot of state.otherPlayers.values()) {
    if (bot.hp <= 0 || (bot.respawnTimer ?? 0) > 0 || bot.isObserver || !bot.team) continue;
    players.push({
      id: bot.id, team: bot.team, heading: { x: -Math.sin(bot.yaw), z: -Math.cos(bot.yaw) }, pos: point(bot.pos), vel: point(bot.vel),
      scripted: bot.controller === 'ai' && !isNeuralNetDifficulty(bot.difficulty) && !isNeuralNetDifficulty(state.settings.aiDifficulty),
      difficulty: bot.difficulty ?? state.settings.aiDifficulty, height: bot.pos.y, pickupRequested: bot.pickupRequested,
      space: observeGrifballSpace(state.settings, bot.activeWeapon, bot.weaponState, bot.weaponTimer ?? 0,
        bot.swapLockoutTimer ?? 0, bot.pos.y, bot.vel.y, GRAVITY_ACCELERATION, MELEE_SWORD_SLASH_REACH),
    });
  }
  const blue = getEnemyGoalPos('red');
  const red = getEnemyGoalPos('blue');
  // Project the existing spawn selection from current public positions; re-evaluate as players move.
  const spawnFor = (team: string, id: string) => getGrifballTeamSpawn(activeCustomMap, team,
    createDefaultSpawnPoints(state.arenaRadius * 0.65), [state.playerPos, ...[...state.otherPlayers.values()]
      .filter(p => p.id !== id && p.hp > 0 && (p.respawnTimer ?? 0) <= 0).map(p => p.pos)]);
  const respawns = [...state.otherPlayers.values()].filter(p => !p.isObserver && p.team && (p.respawnTimer ?? 0) > 0).map(p => ({
    id: p.id, team: p.team!, pos: point(spawnFor(p.team!, p.id)), seconds: p.respawnTimer!, speed: 5.2 * state.settings.speedForward / 100,
  }));
  if (!state.isObserverMode && state.playerRespawnTimer > 0) respawns.push({ id: 'player', team: state.localPlayerTeam,
    pos: point(spawnFor(state.localPlayerTeam, 'player')), seconds: state.playerRespawnTimer, speed: 5.2 * state.settings.speedForward / 100 });
  const roster = [...state.otherPlayers.values()].filter(p => !p.isObserver).sort((a, b) => a.id.localeCompare(b.id));
  return createGrifballTacticalSnapshot({ match: state.grifball, settings: state.settings, map: activeCustomMap,
    arenaRadius: state.arenaRadius, tactics: state.grifballTactics,
    roster: [...roster.map(p => ({ id: p.id, team: p.team!, controller: p.controller,
      difficulty: p.difficulty ?? state.settings.aiDifficulty,
      scripted: p.controller === 'ai' && !isNeuralNetDifficulty(p.difficulty) && !isNeuralNetDifficulty(state.settings.aiDifficulty) })),
      ...(!state.isObserverMode ? [{ id: 'player', team: state.localPlayerTeam, controller: 'remote', difficulty: state.settings.aiDifficulty, scripted: false }] : [])],
    players, respawns, goals: { blue, red },
  });
}

/** Called once after respawns, before any bot moves. No live vector references escape. */
export function updateGrifballTeamPlanForState(
  state: GrifballRuntimeState, dt: number,
  getEnemyGoalPos: (team: string | undefined) => { x: number; z: number } | null,
  activeCustomMap: CustomMapData | null = null,
): void {
  const plan = state.aiMatchContext.grifballTeamPlan;
  if (state.settings.gameMode !== 'grifball' || state.isMultiplayer) {
    resetGrifballTeamPlan(plan);
    setTacticalBotEngagements(state.aiMatchContext.coordinator, []);
    return;
  }
  const snapshot = createLiveGrifballTacticalSnapshot(state, getEnemyGoalPos, activeCustomMap);
  const players = snapshot.players;
  updateGrifballTeamPlan(plan, snapshot, dt);
  const engagements: [string, { targetId: string; role: BotCoordRole }][] = [];
  for (const a of plan.assignments.values()) {
    const bot = players.find(p => p.id === a.botId);
    if (!bot) continue;
    const targetId = selectGrifballAssignmentThreat(a, bot.pos, players);
    if (targetId && (a.defense || a.tanking?.attack && targetId === a.tanking.targetId)) engagements.push([a.botId, { targetId, role: a.tanking?.mode === 'punish' ? 'flanker' : 'pressure' }]);
  }
  setTacticalBotEngagements(state.aiMatchContext.coordinator, engagements);
}

import { updateGrifballTeamPlan, resetGrifballTeamPlan, type GrifballTacticalPlayer } from '../../game/aiGrifballTeamPlan';
import { isNeuralNetDifficulty } from '../../game/neuralBrains';
import type { GrifballRuntimeState } from './runtimeState';
import { GRAVITY_ACCELERATION, MELEE_SWORD_SLASH_REACH } from './combatGeometry';
import type { CustomMapData } from '../../types';
import { observeGrifballSpace } from '../../game/aiGrifballSpace';
import { buildGrifballSpaceGeometry } from '../../game/grifballSpaceGeometry';

/** Called once after respawns, before any bot moves. No live vector references escape. */
export function updateGrifballTeamPlanForState(
  state: GrifballRuntimeState, dt: number,
  getEnemyGoalPos: (team: string | undefined) => { x: number; z: number } | null,
  activeCustomMap: CustomMapData | null = null,
): void {
  const plan = state.aiMatchContext.grifballTeamPlan;
  if (state.settings.gameMode !== 'grifball' || state.isMultiplayer) {
    resetGrifballTeamPlan(plan);
    return;
  }
  const players: GrifballTacticalPlayer[] = [];
  const point = (p: { x: number; z: number }) => ({ x: p.x, z: p.z });
  if (!state.isObserverMode && state.playerHP > 0 && state.playerRespawnTimer <= 0) {
    players.push({ id: 'player', team: state.localPlayerTeam, pos: point(state.playerPos), vel: point(state.playerVel), heading: { x: -Math.sin(state.yaw), z: -Math.cos(state.yaw) }, scripted: false, pickupRequested: state.playerPickupRequested });
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
      pickupRequested: bot.pickupRequested,
      space: observeGrifballSpace(state.settings, bot.activeWeapon, bot.weaponState, bot.weaponTimer ?? 0,
        bot.swapLockoutTimer ?? 0, bot.pos.y, bot.vel.y, GRAVITY_ACCELERATION, MELEE_SWORD_SLASH_REACH),
    });
  }
  const blue = getEnemyGoalPos('red');
  const red = getEnemyGoalPos('blue');
  updateGrifballTeamPlan(plan, {
    round: state.grifball.roundNumber, playing: state.grifball.phase === 'playing',
    ball: point(state.grifball.ball.pos),
    holderId: state.grifball.ball.state === 'held' ? state.grifball.ball.holderId : null,
    players, goals: { blue: blue ? point(blue) : null, red: red ? point(red) : null },
    tactics: state.grifballTactics,
    geometry: buildGrifballSpaceGeometry(activeCustomMap, state.arenaRadius),
    spacing: state.settings.grifballEscortSpacing ?? 4,
  }, dt);
}

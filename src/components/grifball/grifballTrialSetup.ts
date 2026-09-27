import * as THREE from 'three';
import type { LabScenario } from '../../game/grifballLabStore';
import { createOfflineBotCombatant } from '../../game/roster';
import { isNeuralNetDifficulty } from '../../game/neuralBrains';
import { resetAIMatchContext } from '../../game/aiMatchContext';
import { createEmptyTeamScores } from '../../game/teamScoring';
import { createInitialGrifballMatchState } from '../../game/grifballMatch';
import { setGrifballCarrierForState } from './grifballObjectiveRuntime';
import type { GrifballRuntimeState } from './runtimeState';

export const LAB_TICK = 1 / 60;

/** Clone simulation data, retaining Three vector methods and Map/Set semantics. */
export function cloneLabState<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof THREE.Vector3 || value instanceof THREE.Vector2 || value instanceof THREE.Quaternion || value instanceof THREE.Euler) return value.clone() as T;
  if (value instanceof Map) return new Map([...value].map(([key, item]) => [key, cloneLabState(item)])) as T;
  if (value instanceof Set) return new Set([...value].map(cloneLabState)) as T;
  if (Array.isArray(value)) return value.map(cloneLabState) as T;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneLabState(item)])) as T;
}

export function prepareGrifballScenario(state: GrifballRuntimeState, scenario: LabScenario, seed: number,
  getEnemyGoal?: (team: string) => { x: number; z: number } | null) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be an integer from 0 to 4294967295.');
  const bots = [...state.otherPlayers.values()].filter(bot => bot.controller === 'ai');
  const goals = state.aiMatchContext.grifballTeamPlan.snapshot?.goals;
  if (!bots.some(bot => bot.team === 'blue') || !bots.some(bot => bot.team === 'red')) throw new Error('Start a Grifball match with bots on both teams first.');
  if (bots.some(bot => isNeuralNetDifficulty(bot.difficulty)) || isNeuralNetDifficulty(state.settings.aiDifficulty)) throw new Error('Lab scenarios require scripted AI. Choose a scripted difficulty in Bot Configuration.');
  state.isObserverMode = true;
  state.hideLocalObserverAvatar = true;
  state.playerPickupRequested = false;
  state.playerVel.set(0, 0, 0);
  state.teamScores = createEmptyTeamScores();
  state.scorePlayer = state.scoreEnemy = state.playerKills = state.enemyKills = state.playerDeaths = state.enemyDeaths = state.gameTime = 0;
  state.lastDeaths = []; state.activeMedalPopup = null;
  state.grifball = createInitialGrifballMatchState(state.settings, state.grifball.ball.home);
  state.grifball.phase = 'playing';
  resetAIMatchContext(state.aiMatchContext);
  state.aiMatchContext.grifballTeamPlan.styleSeed = seed;
  // Positions follow the actual goal axis instead of assuming an arena orientation.
  const blue = getEnemyGoal?.('red') ?? goals?.blue ?? { x: 0, z: -state.arenaRadius * 0.8 };
  const red = getEnemyGoal?.('blue') ?? goals?.red ?? { x: 0, z: state.arenaRadius * 0.8 };
  const axis = new THREE.Vector3(red.x - blue.x, 0, red.z - blue.z).normalize();
  const lateral = new THREE.Vector3(-axis.z, 0, axis.x);
  const center = new THREE.Vector3(state.grifball.ball.home.x, 0, state.grifball.ball.home.z);
  state.observerCamMode = 'free';
  state.playerPos.copy(center).add(new THREE.Vector3(0, 25, 25));
  state.yaw = 0; state.pitch = -Math.PI / 4;
  const counts = { blue: 0, red: 0 };
  for (const bot of bots) {
    const team = bot.team === 'blue' ? 'blue' : 'red'; const slot = counts[team]++;
    const fresh = createOfflineBotCombatant({ id: bot.id, playerName: bot.playerName, team: bot.team,
      spawnPos: center.clone().addScaledVector(axis, (team === 'blue' ? -1 : 1) * (7 + Math.floor(slot / 2) * 5)).addScaledVector(lateral, (slot % 2 ? -1 : 1) * (2 + slot)),
      yaw: Math.atan2(-axis.x * (team === 'blue' ? 1 : -1), -axis.z * (team === 'blue' ? 1 : -1)),
      hue: bot.hue, difficulty: bot.difficulty ?? 'normal', settings: state.settings, modelType: bot.modelType });
    fresh.modelType = bot.modelType;
    // Keep object identities but remove every per-bot decision left by the old play.
    for (const key of Object.keys(bot)) delete (bot as any)[key];
    Object.assign(bot, fresh, { spawnTime: 1_000_000, invulnerabilityTimer: 0, weaponState: 'ready', aiSwayTimer: 0 });
    if (['outnumbered', 'delay'].includes(scenario) && team === 'blue' && slot > 0) { bot.hp = 0; bot.respawnTimer = 3600; }
  }
  if (scenario !== 'pickup') {
    const carrier = bots.find(bot => bot.team === (['escort', 'crowding', 'goal', 'lane', 'pursuit', 'rendezvous', 'tanking', 'breakthrough', 'pass', 'passdenied', 'stylematch'].includes(scenario) ? 'blue' : 'red'))!;
    carrier.pos.copy(center); state.grifball.ball.holderId = carrier.id; state.grifball.ball.state = 'held';
    setGrifballCarrierForState({ state, id: carrier.id, carrying: true });
    if (scenario === 'crowding') {
      bots.filter(bot => bot.team === 'blue' && bot !== carrier).forEach((bot, i) => bot.pos.copy(center).addScaledVector(axis, 2).addScaledVector(lateral, (i - 1) * 0.7));
      bots.filter(bot => bot.team === 'red').forEach((bot, i) => bot.pos.copy(center).addScaledVector(axis, state.settings.attackRange + state.settings.attackRadius + 1 + i * 2));
    }
    if (scenario === 'goal') {
      carrier.pos.set(red.x - axis.x * 3, 0, red.z - axis.z * 3);
      bots.filter(bot => bot !== carrier).forEach((bot, i) => bot.pos.copy(carrier.pos).addScaledVector(axis, -(4 + Math.floor(i / 2) * 3)).addScaledVector(lateral, (i % 2 ? -1 : 1) * 3));
    }
    if (['lane', 'pursuit', 'rendezvous'].includes(scenario)) {
      bots.filter(bot => bot.team === 'blue' && bot !== carrier).forEach((bot, i) => bot.pos.copy(center).addScaledVector(axis, scenario === 'rendezvous' ? -8 - i : 2 - i * 3).addScaledVector(lateral, (i % 2 ? -1 : 1) * 3));
      bots.filter(bot => bot.team === 'red').forEach((bot, i) => bot.pos.copy(center).addScaledVector(axis, scenario === 'pursuit' ? -7 - i * 3 : 7 + i * 3).addScaledVector(lateral, scenario === 'lane' ? -3 + i : (i % 2 ? -1 : 1) * 2));
    }
    if (['tanking', 'double', 'breakthrough', 'delay'].includes(scenario)) {
      const attackingBlue = scenario === 'tanking' || scenario === 'breakthrough';
      const attackers = bots.filter(bot => bot.team === 'blue' && bot !== carrier);
      const targets = bots.filter(bot => bot.team === 'red');
      attackers.forEach((bot, i) => bot.pos.copy(center).addScaledVector(axis, i < 2 ? 1 : -10).addScaledVector(lateral, i < 2 ? (i % 2 ? -1 : 1) * 3 : 0));
      targets.forEach((bot, i) => bot.pos.copy(center).addScaledVector(axis, i === 0 ? 4 : 18 + i * 4).addScaledVector(lateral, i === 0 ? 0 : (i % 2 ? -1 : 1) * 10));
      if (attackingBlue) carrier.pos.copy(center).addScaledVector(axis, scenario === 'breakthrough' ? 23 : -4);
      if (scenario === 'double') { carrier.weaponState = 'recovering'; carrier.weaponTimer = 0; }
      if (scenario === 'delay') { bots.find(bot => bot.team === 'blue' && bot.hp > 0)?.pos.copy(center).addScaledVector(axis, -10); carrier.pos.copy(center); targets.filter(bot => bot !== carrier).forEach((bot, i) => bot.pos.copy(center).addScaledVector(axis, 3 + i).addScaledVector(lateral, (i % 2 ? -1 : 1) * 3)); }
    }
    if (['cut', 'lastdefender', 'reinforcements'].includes(scenario)) {
      const defenders = bots.filter(bot => bot.team === 'blue');
      defenders.forEach((bot, i) => bot.pos.copy(center).addScaledVector(axis, i === 0 ? -14 : -8).addScaledVector(lateral, i === 0 ? 0 : (i % 2 ? -1 : 1) * 5));
      carrier.vel.copy(axis).multiplyScalar(-3).addScaledVector(lateral, 3);
      if (scenario !== 'cut') defenders.slice(1).forEach((bot, i) => { bot.hp = 0; bot.respawnTimer = scenario === 'reinforcements' ? 1 + i * 0.5 : 3600; });
      if (scenario === 'lastdefender') carrier.pos.set(blue.x + axis.x * 7, 0, blue.z + axis.z * 7);
    }
    if (scenario === 'pass' || scenario === 'passdenied') {
      carrier.pos.copy(center).addScaledVector(axis, -20);
      bots.filter(bot => bot.team === 'blue' && bot !== carrier).forEach((bot, i) => bot.pos.copy(center).addScaledVector(axis, -8 - i * 6).addScaledVector(lateral, i * 5));
      bots.filter(bot => bot.team === 'red').forEach((bot, i) => bot.pos.copy(center).addScaledVector(axis, scenario === 'pass' ? -40 + i * 2 : -8 + i * 3).addScaledVector(lateral, scenario === 'pass' ? 15 : (i % 2 ? -1 : 1) * 3));
    }
    if (scenario === 'stylematch' || scenario === 'adaptation') {
      carrier.pos.copy(center).addScaledVector(axis, scenario === 'stylematch' ? -8 : 8);
      bots.filter(bot => bot !== carrier).forEach((bot, i) => {
        const sign = bot.team === 'blue' ? -1 : 1;
        bot.pos.copy(center).addScaledVector(axis, sign * (4 + Math.floor(i / 2) * 3)).addScaledVector(lateral, (i % 2 ? -1 : 1) * (scenario === 'adaptation' ? 1.5 : 4));
        bot.vel.copy(axis).multiplyScalar(-sign * 3);
      });
      carrier.vel.copy(axis).multiplyScalar(scenario === 'stylematch' ? 3 : -3);
    }
    state.grifball.ball.pos = { x: carrier.pos.x, y: carrier.pos.y, z: carrier.pos.z };
  }
}

/** Rotate the same participants onto the other side without changing actor IDs. */
export function mirrorGrifballTrial(state: GrifballRuntimeState, getEnemyGoal?: (team: string) => { x: number; z: number } | null) {
  const blue = getEnemyGoal?.('red') ?? state.aiMatchContext.grifballTeamPlan.snapshot?.goals.blue;
  const red = getEnemyGoal?.('blue') ?? state.aiMatchContext.grifballTeamPlan.snapshot?.goals.red;
  const cx = blue && red ? (blue.x + red.x) / 2 : state.grifball.ball.home.x;
  const cz = blue && red ? (blue.z + red.z) / 2 : state.grifball.ball.home.z;
  const rotate = (p: { x: number; z: number }) => { p.x = 2 * cx - p.x; p.z = 2 * cz - p.z; };
  for (const bot of state.otherPlayers.values()) {
    bot.team = bot.team === 'blue' ? 'red' : 'blue'; rotate(bot.pos);
    bot.vel.x *= -1; bot.vel.z *= -1; bot.yaw += Math.PI;
  }
  rotate(state.grifball.ball.pos); rotate(state.grifball.ball.home);
  state.grifball.ball.vel.x *= -1; state.grifball.ball.vel.z *= -1;
}

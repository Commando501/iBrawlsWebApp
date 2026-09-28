import * as THREE from 'three';
import { createMatch, defaultGrifballMap } from '../../src/sim/factory';
import { createOfflineBotCombatant } from '../../src/game/roster';
import { createInitialGrifballRuntimeState } from '../../src/components/grifball/runtimeState';
import { createInitialGrifballThreeRefs } from '../../src/components/grifball/threeRefs';
import { buildCombatantRigForModel } from '../../src/components/grifball/combatantRig';
import { triggerCombatantAttackAction } from '../../src/components/grifball/combatantActions';
import { updateWeaponAnimationFrameForState } from '../../src/components/grifball/weaponAnimationFrameRuntime';
import { updateRosterCombatantVisualsForState } from '../../src/components/grifball/rosterVisualSync';
import { createCombatImpactCallbacksForState } from '../../src/components/grifball/combatImpactCallbacks';
import { applyBotMeleeImpactForState } from '../../src/components/grifball/botMeleeImpactRuntime';
import { createCombatantActionCallbacksForState } from '../../src/components/grifball/combatantActionCallbacks';
import { updateAIRosterTick } from '../../src/components/grifball/aiRosterTick';
import { seededRandom, withSimulationRandom } from '../../src/game/simulationRandom';
import type { CharacterModelType, UniversalSettings } from '../../src/types';
import { idleAction } from '../../src/sim/actions';
import { stepSimulation } from '../../src/sim/step';
import { setSimCarrier } from '../../src/sim/grifball';
import { setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import type { ParityDifference } from './grifballExecutionParity';
import type { SimCombatExecution } from '../../src/sim/simState';
import { groundMotionAction, stepLiveGroundMotion, type GroundMotion } from './grifballGroundMotion';

const noop = () => {};
export function createBotParityFixture(id = 'bot_2', observer = true, settings: Partial<UniversalSettings> = {}, targetId = 'target') {
  if (id === targetId) throw new Error('Parity actors must have distinct IDs');
  const map = structuredClone(defaultGrifballMap());
  const sim = createMatch({ seed: 27, teamSizes: { blue: 1, red: 1 }, settings, map });
  const state = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: sim.settings, isMultiplayer: false, multiplayerRole: null });
  state.otherPlayers.clear(); state.isObserverMode = observer; state.grifball.phase = 'playing';
  state.playerPos.set(40, 0, 0); state.playerRespawnTimer = 0; state.playerHP = state.playerMaxHP = 20;
  const refs = createInitialGrifballThreeRefs();
  refs.camera = new THREE.PerspectiveCamera(); refs.playerHammer = new THREE.Group(); refs.playerSword = new THREE.Group();
  const bot = createOfflineBotCombatant({ id, playerName: id, team: 'blue', spawnPos: new THREE.Vector3(), yaw: Math.PI,
    hue: 0, difficulty: 'normal', settings: state.settings, modelType: 'medium' });
  const target = createOfflineBotCombatant({ id: targetId, playerName: 'Target', team: 'red', spawnPos: new THREE.Vector3(0, 0, 2), yaw: 0,
    hue: 0, difficulty: 'normal', settings: state.settings, modelType: 'medium' });
  target.hp = target.maxHp = 20;
  for (const c of [bot, target]) {
    c.invulnerabilityTimer = c.respawnTimer = c.swapCooldownTimer = 0; c.weaponState = 'ready';
    state.otherPlayers.set(c.id, c);
    const group = new THREE.Group(); group.userData.modelSystem = 'v2';
    refs.otherPlayerMeshes.set(c.id, { group, hammer: new THREE.Group(), sword: new THREE.Group(), rig: buildCombatantRigForModel(group) });
  }
  const effects = { playExplosion: noop, playDeath: noop, playSwing: noop, spawnVoxelShockwaveParticles: noop,
    renderHammerSplashVfx: noop, recordBotCalibrationDeath: noop, recordBotPsychKill: noop };
  const impacts = createCombatImpactCallbacksForState({ ...effects, getState: () => state, getMainAI: () => state.otherPlayers.get('main_ai'),
    getEnemyAITarget: () => ({ id: target.id, pos: target.pos, vel: target.vel, hp: target.hp, playerName: target.playerName,
      modelType: target.modelType, weaponState: target.weaponState ?? 'ready', isLunging: !!target.isLunging,
      isCrouching: !!target.isCrouching, isObserver: false, respawnTimer: target.respawnTimer ?? 0,
      invuln: target.invulnerabilityTimer ?? 0 }), isMultiplayer: false,
    areCombatantsHostile: (a, b) => a !== b, executeTrade: noop, sendSync: () => false, applyOutgoingMultiplayerHitLocally: noop,
    evaluatePlayerKillMedals: () => [], recordPlayerDamageTaken: noop, tryRecordCalibrationCounterSuccess: noop,
    recordBotDamageTag: noop, tryEnterPressureState: () => false, tryStartComboOnHit: noop, playJump: noop, pushStatsUpdate: noop });
  const actions = createCombatantActionCallbacksForState({ getState: () => state, getRefs: () => refs, spawnPoints: [],
    getRosterAI: () => [...state.otherPlayers.values()], getActiveCustomMap: () => map, getOptimalSpawnPoint: () => new THREE.Vector3(),
    recordCombatantObservation: noop, onMainAIHammerSwing: noop, playSwing: noop, playJump: noop, playDash: noop, playRespawn: noop });
  const impact = (botId: string) => applyBotMeleeImpactForState({ state, botId, ...effects });
  const visuals = (dt: number) => updateRosterCombatantVisualsForState({ state, refs, dt, applyBotMeleeImpact: impact, renderSwordLungeTrailVfx: noop });
  const weaponFrame = (dt: number) => updateWeaponAnimationFrameForState({ state, refs, dt, mainAI: state.otherPlayers.get('main_ai'),
    getPlayerSwordLockTarget: () => null, ...impacts });
  const respawns = (dt: number) => updateAIRosterTick({ refs, rosterAI: [...state.otherPlayers.values()], dt, respawnCombatant: actions.respawnCombatant, updateSingleAIEntity: noop });
  const attack = (melee = false) => triggerCombatantAttackAction({ self: bot, weapon: bot.activeWeapon === 'sword' ? 'sword' : 'hammer',
    melee, recordHammerAttack: noop, playSwing: noop });
  const random = seededRandom(27);
  let tick = 0;
  const frame = (requestAttack = false, melee = false, move?: () => void) => withSimulationRandom(random, ++tick / 60, () => {
    weaponFrame(1 / 60); respawns(1 / 60);
    if (requestAttack && bot.hp > 0 && bot.weaponState === 'ready') attack(melee);
    move?.();
    visuals(1 / 60);
  });
  return { state, refs, bot, target, map, sim, impact, visuals, weaponFrame, respawns, attack, frame };
}

export interface BotParityCase {
  name: string;
  weapon: 'sword' | 'hammer' | 'ball';
  secondary?: boolean;
  repeat?: boolean;
  settings?: Partial<UniversalSettings>;
  target?: { x: number; z: number };
  aim?: number;
  shield?: boolean;
  attackerModel?: CharacterModelType;
  targetModel?: CharacterModelType;
  attackerCrouch?: boolean;
  targetCrouch?: boolean;
  movement?: { attacker?: GroundMotion; target?: GroundMotion };
  expectedHitTick?: number;
  hits: number;
}
export const BOT_PARITY_CASES: BotParityCase[] = [
  { name: 'slash', weapon: 'sword', hits: 1 },
  { name: 'slam', weapon: 'hammer', hits: 1 },
  { name: 'swipe', weapon: 'hammer', secondary: true, hits: 1 },
  { name: 'punch', weapon: 'ball', hits: 1 },
  { name: 'slash-held', weapon: 'sword', repeat: true, hits: 5 },
  { name: 'slam-held', weapon: 'hammer', repeat: true, hits: 4 },
  { name: 'swipe-held', weapon: 'hammer', secondary: true, repeat: true, hits: 5 },
  { name: 'punch-held', weapon: 'ball', repeat: true, hits: 5 },
  { name: 'slash-tuned', weapon: 'sword', settings: { swordSlashSpeed: .35, swordSlashReload: .75 }, hits: 1 },
  { name: 'swipe-tuned', weapon: 'hammer', secondary: true, settings: { hammerMeleeSpeed: .37, hammerMeleeReload: .75 }, hits: 1 },
  { name: 'slam-tuned', weapon: 'hammer', settings: { hammerSlamWindupTime: .08, hammerSlamAttackTime: .04 }, hits: 1 },
  { name: 'punch-tuned', weapon: 'ball', settings: { hammerMeleeSpeed: .37, grifballPunchCooldown: .75, grifballPunchLungeDistance: 3 }, target: { x: 0, z: 3.7 }, hits: 1 },
  ...(['sword', 'hammer', 'ball'] as const).flatMap(weapon => [
    { name: `${weapon}-behind`, weapon, target: { x: 0, z: -4 }, hits: 0 },
    { name: `${weapon}-shield`, weapon, shield: true, hits: 0 },
    { name: `${weapon}-rotated`, weapon, aim: Math.PI / 2, target: { x: 2, z: 0 }, hits: 1 },
  ]),
];

/** Paired stationary attacks through the real live frame owners, without AI decisions or copied states. */
export function runBotExecutionParityTrace(spec: BotParityCase, id: string, observer: boolean, execution: SimCombatExecution = 'live-roster-v1') {
  const f = createBotParityFixture(id, observer, spec.settings);
  const { sim, bot, target, state } = f;
  sim.combatExecution = execution; sim.match.phase = 'playing';
  const [self, rival] = sim.combatants;
  self.modelType = bot.modelType = spec.attackerModel ?? 'medium';
  rival.modelType = target.modelType = spec.targetModel ?? 'medium';
  self.isCrouching = bot.isCrouching = !!spec.attackerCrouch;
  rival.isCrouching = target.isCrouching = !!spec.targetCrouch;
  self.id = id; rival.id = target.id; self.pos = { x: 0, y: 0, z: 0 };
  const p = spec.target ?? { x: 0, z: 2 };
  rival.pos = { x: p.x, y: 0, z: p.z }; target.pos.set(p.x, 0, p.z);
  rival.hp = rival.maxHp = target.hp;
  self.invulnerabilityTimer = rival.invulnerabilityTimer = self.weaponReadyTimer = rival.weaponReadyTimer = 0;
  if (spec.shield) target.invulnerabilityTimer = rival.invulnerabilityTimer = 10;
  bot.activeWeapon = self.weapon = spec.weapon;
  if (spec.weapon === 'ball') {
    sim.match.ball.state = state.grifball.ball.state = 'held';
    sim.match.ball.holderId = state.grifball.ball.holderId = id;
    setSimCarrier(self, true, sim.settings); setGrifballCarrierForState({ state, id, carrying: true });
  }
  const differences: ParityDifference[] = [], frames = [];
  let differenceCount = 0;
  let liveHitTick = 0, simHitTick = 0;
  const compare = (tick: number, field: string, live: unknown, headless: unknown, tolerance = 0) => {
    const equal = typeof live === 'number' && typeof headless === 'number'
      ? Number.isFinite(live) && Number.isFinite(headless) && Math.abs(live - headless) <= tolerance : live === headless;
    if (!equal) { differenceCount++; if (differences.length < 64) differences.push({ tick, field, live, headless, tolerance }); }
  };
  for (let tick = 1; tick <= 240; tick++) {
    const request = tick === 1 || !!spec.repeat;
    bot.yaw = (spec.aim ?? 0) + Math.PI;
    f.frame(request, !!spec.secondary, () => {
      if (spec.movement?.attacker) stepLiveGroundMotion(f, bot, spec.movement.attacker, tick);
      if (spec.movement?.target) stepLiveGroundMotion(f, target, spec.movement.target, tick);
    });
    stepSimulation(sim, { [id]: { ...(spec.movement?.attacker
      ? groundMotionAction(self, spec.movement.attacker, tick, spec.aim ?? 0, sim.settings) : idleAction()), aim: spec.aim ?? 0, crouch: !!spec.attackerCrouch,
      attackPrimary: request && !spec.secondary, attackSecondary: request && !!spec.secondary },
      [rival.id]: { ...(spec.movement?.target
        ? groundMotionAction(rival, spec.movement.target, tick, 0, sim.settings) : idleAction()), crouch: !!spec.targetCrouch } }, { settings: sim.settings });
    if (!liveHitTick && target.hp < 20) liveHitTick = tick;
    if (!simHitTick && rival.hp < 20) simHitTick = tick;
    const phase = bot.weaponState === 'ready' ? 'idle'
      : ['swing_up', 'melee_up'].includes(bot.weaponState) ? 'windup'
      : ['swing_down', 'melee_down'].includes(bot.weaponState) ? 'active' : 'recovering';
    compare(tick, 'weaponPhase', phase, self.weaponState);
    compare(tick, 'phaseElapsed', bot.weaponTimer, self.weaponPhaseElapsed ?? 0, 1e-6);
    compare(tick, 'target.health', target.hp, rival.hp, 1e-9);
    compare(tick, 'health', bot.hp, self.hp, 1e-9);
    compare(tick, 'crouching', !!bot.isCrouching, self.isCrouching);
    compare(tick, 'target.crouching', !!target.isCrouching, rival.isCrouching);
    compare(tick, 'model', bot.modelType, self.modelType);
    compare(tick, 'target.model', target.modelType, rival.modelType);
    for (const axis of ['x', 'y', 'z'] as const) compare(tick, `position.${axis}`, bot.pos[axis], self.pos[axis], 1e-6);
    if (spec.movement) for (const [index, [a, b]] of ([[bot, self], [target, rival]] as const).entries()) {
      for (const axis of ['x', 'y', 'z'] as const) {
        compare(tick, `${index}.pos.${axis}`, a.pos[axis], b.pos[axis], 1e-6);
        compare(tick, `${index}.vel.${axis}`, a.vel[axis], b.vel[axis], 1e-6);
      }
      compare(tick, `${index}.dashRemaining`, a.aiDashRemaining ?? 0, b.dashRemaining, 1e-6);
      compare(tick, `${index}.dashCooldown`, a.aiDashCooldownTimer ?? 0, b.dashCooldownTimer, 1e-6);
    }
    frames.push({ tick, request, live: { weapon: bot.weaponState, elapsed: bot.weaponTimer, hp: bot.hp, targetHp: target.hp,
      motion: spec.movement ? [bot, target].map(c => ({ pos: c.pos.toArray(), vel: c.vel.toArray(),
        dashRemaining: c.aiDashRemaining ?? 0, dashCooldown: c.aiDashCooldownTimer ?? 0 })) : undefined },
      headless: { weapon: self.weaponState, elapsed: self.weaponPhaseElapsed ?? 0, hp: self.hp, targetHp: rival.hp,
        motion: spec.movement ? [self, rival].map(c => ({ pos: { ...c.pos }, vel: { ...c.vel },
          dashRemaining: c.dashRemaining, dashCooldown: c.dashCooldownTimer })) : undefined } });
  }
  compare(240, 'expectedDamage.live', 20 - target.hp, spec.hits);
  compare(240, 'expectedDamage.headless', 20 - rival.hp, spec.hits);
  if (spec.expectedHitTick !== undefined) {
    compare(240, 'expectedHitTick.live', liveHitTick, spec.expectedHitTick);
    compare(240, 'expectedHitTick.headless', simHitTick, spec.expectedHitTick);
  }
  return { name: `${id}/${observer ? 'observer' : 'player-view'}/${spec.name}`, combatExecution: sim.combatExecution,
    scenario: spec, ticks: 240, differenceCount, differences, frames };
}

export function runBotExecutionParity() {
  return ['main_ai', 'bot_2'].flatMap(id => [false, true].flatMap(observer =>
    BOT_PARITY_CASES.map(spec => runBotExecutionParityTrace(spec, id, observer))));
}

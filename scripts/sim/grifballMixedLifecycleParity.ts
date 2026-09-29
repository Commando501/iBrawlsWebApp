import * as THREE from 'three';
import { lungeFixture } from './grifballLungeFixture';
import { parityRecorder } from './grifballMultiActorParity';
import { DEFAULT_KEYBINDINGS } from '../../src/types';
import { updatePlayerRespawnForState } from '../../src/components/grifball/playerRespawnRuntime';
import { updatePlayerHorizontalMovementForState, updatePlayerVerticalIntegrationForState } from '../../src/components/grifball/playerMovementRuntime';
import { triggerPlayerSwordSlashForState, triggerPlayerHammerSwingForState, triggerPlayerSwordLungeForState } from '../../src/components/grifball/playerWeaponActions';
import { updatePlayerSwordLungeForState } from '../../src/components/grifball/playerSwordLungeRuntime';
import { executeMainAITradeForState } from '../../src/components/grifball/tradeRuntime';
import { areGrifballCombatantsHostileForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { tickCombatantInvulnerability } from '../../src/components/grifball/aiTickState';
import { seededRandom, withSimulationRandom } from '../../src/game/simulationRandom';
import { stepSimulation } from '../../src/sim/step';
import { stepCombatantWeapons } from '../../src/sim/weapons';
import { idleAction } from '../../src/sim/actions';
import type { SimState } from '../../src/sim/simState';

const noop = () => {};
const KINDS = ['hit-one', 'hit-two', 'sword-one', 'sword-two', 'hammer-one', 'hammer-two',
  'recent', 'expired', 'future', 'zero', 'disabled', 'hammer-recent', 'hammer-expired', 'hammer-future', 'hammer-zero', 'hammer-disabled',
  'shield', 'shield-expiry', 'friendly', 'dead', 'double-respawn'] as const;
export interface MixedLifecycleCase { kind: typeof KINDS[number]; main: boolean; mirror: boolean; reverse: boolean }
export const MIXED_LIFECYCLE_CASES: MixedLifecycleCase[] = KINDS.flatMap(kind => [false, true].flatMap(main =>
  [false, true].flatMap(mirror => [false, true].map(reverse => ({ kind, main, mirror, reverse })))));

/** Committed incoming roster flight followed through damage, revival and shield expiry.
 * The player proxy supplies a target snapshot only; live health is owned by runtime state. */
export interface OpposedFlightCase { first: 'player' | 'roster'; playerHp: number; botHp: number; trade: boolean; reload: number }
export function runMixedLifecycleTrace(spec: MixedLifecycleCase, snapshotAt?: number, opposed?: OpposedFlightCase) {
  const f = lungeFixture(spec.main ? 'main_ai' : 'attacker', false);
  const { state, sim, bot, target, refs, map } = f;
  const [self, player] = sim.combatants;
  state.otherPlayers.delete(target.id); refs.otherPlayerMeshes.delete(target.id);
  self.id = bot.id; player.id = 'player'; player.controller = 'remote';
  sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = player.id;
  sim.match.phase = 'playing';
  const direction = spec.mirror ? -1 : 1;
  self.team = bot.team = spec.mirror ? 'red' : 'blue';
  player.team = state.localPlayerTeam = spec.kind === 'friendly' ? self.team : spec.mirror ? 'blue' : 'red';
  const activeCounter = /^(sword|hammer)-(one|two)$/.test(spec.kind);
  const history = spec.kind.replace('hammer-', '');
  const trade = activeCounter || history === 'recent';
  const near = activeCounter || ['recent', 'expired', 'future', 'zero', 'disabled'].includes(history);
  Object.assign(state.settings, { swordLungeSpeed: 24, swordLungeReload: opposed?.reload ?? .6, respawnInvulnerabilityDuration: .5,
    enableSwordTrade: opposed?.trade ?? (near && history !== 'disabled'), enableHammerSwordTrade: near && history !== 'disabled',
    swordTradeWindow: 350, hammerSwordTradeWindow: 350 });
  Object.assign(sim.settings, state.settings);
  map.teamSpawns = { blue: [{ x: -10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
    red: [{ x: -10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }] };
  sim.spawns = { blue: structuredClone(map.teamSpawns.blue), red: structuredClone(map.teamSpawns.red) }; sim.map = structuredClone(map);
  self.pos = { x: 0, y: 0, z: 0 }; bot.pos.set(0, 0, 0);
  player.pos = { x: 0, y: 0, z: direction * (opposed ? opposed.first === 'player' ? 5 : 4.6 : near ? 1.8 : 5) }; state.playerPos.set(player.pos.x, 0, player.pos.z);
  state.playerVel.set(0, 0, 0); player.vel = { x: 0, y: 0, z: 0 };
  state.playerHP = state.playerMaxHP = player.hp = player.maxHp = opposed?.playerHp ?? (spec.kind.endsWith('two') ? 2 : 1);
  self.hp = self.maxHp = bot.hp = bot.maxHp = opposed?.botHp ?? (spec.kind.endsWith('two') ? 2 : 1);
  state.activeWeapon = player.weapon = spec.kind.startsWith('hammer') ? 'hammer' : 'sword';
  self.weapon = 'sword'; self.yaw = spec.mirror ? Math.PI : 0;
  bot.yaw = self.yaw + Math.PI;
  // Face the incoming attacker. An unconsumed counter would hit it again.
  state.yaw = spec.mirror ? Math.PI : 0; player.yaw = state.yaw - Math.PI;
  state.swapCooldownTimer = state.swapLockoutTimer = player.weaponReadyTimer = self.weaponReadyTimer = 0;
  state.playerInvulnerabilityTimer = player.invulnerabilityTimer = self.invulnerabilityTimer = 0;
  state.playerRespawnTimer = player.respawnTimer = 0;
  bot.lungeTargetDir = { x: 0, y: 0, z: direction }; self.lungeAimDirection = { x: 0, y: 0, z: direction };
  self.lungeTargetId = player.id;
  const random = seededRandom(83), record = parityRecorder();
  withSimulationRandom(random, 0, () => {
    stepCombatantWeapons(sim, self, { ...idleAction(), attackSecondary: true }, sim.settings, 0, []);
    if (opposed) {
      triggerPlayerSwordLungeForState({ state, lockTarget: bot, recordLungeStart: noop, playDash: noop, sendSync: noop });
      player.lungeTargetId = bot.id;
      stepCombatantWeapons(sim, player, { ...idleAction(), attackSecondary: true }, sim.settings, 0, []);
    }
    if (activeCounter) {
      if (player.weapon === 'sword') triggerPlayerSwordSlashForState({ state, playSwing: noop, sendSync: noop });
      else triggerPlayerHammerSwingForState({ state, recordHammerAttack: noop, playSwing: noop, sendSync: noop });
      stepCombatantWeapons(sim, player, { ...idleAction(), attackPrimary: true }, sim.settings, 0, []);
    }
  });
  if (['recent', 'expired', 'future', 'zero', 'disabled'].includes(history)) {
    const time = history === 'future' ? 1000 : history === 'zero' ? undefined
      : 1000 / 60 - (history === 'expired' ? 351 : 350);
    // Runtime timestamps have the simulation clock epoch; sim history is elapsed ms.
    withSimulationRandom(random, (time ?? 0) / 1000, () => {
      if (player.weapon === 'sword') triggerPlayerSwordSlashForState({ state, playSwing: noop, sendSync: noop });
      else triggerPlayerHammerSwingForState({ state, recordHammerAttack: noop, playSwing: noop, sendSync: noop });
    });
    if (player.weapon === 'sword') { player.lastSwordAttackTimeMs = time; if (history === 'zero') state.lastPlayerSwordAttackTime = 0; }
    else { player.lastHammerAttackTimeMs = time; if (history === 'zero') state.lastPlayerHammerAttackTime = 0; }
    state.pSwordState = state.pWeaponState = 'ready'; state.pSwordTimer = state.pWeaponTimer = 0;
  }
  if (spec.kind.startsWith('shield')) state.playerInvulnerabilityTimer = player.invulnerabilityTimer = spec.kind === 'shield' ? 1 : .15;
  if (spec.kind === 'dead' || spec.kind === 'double-respawn') {
    state.playerHP = player.hp = 0; player.alive = false;
    state.playerRespawnTimer = player.respawnTimer = spec.kind === 'dead' ? 3 : .025;
    if (spec.kind === 'double-respawn') { bot.hp = self.hp = 0; self.alive = false; bot.isLunging = self.isLunging = false; bot.respawnTimer = self.respawnTimer = .025; }
  }
  if (spec.reverse) sim.combatants.reverse();
  const constrain = (pos: THREE.Vector3, vel?: THREE.Vector3) => constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: map, arenaRadius: map.arenaRadius });
  const kills = new Map<string, number>(), deaths = new Map<string, number>(), frames = [];
  let restored: SimState | undefined;
  for (let tick = 1; tick <= 300; tick++) {
    withSimulationRandom(random, tick / 60, () => {
      const dead = updatePlayerRespawnForState({ state, dt: 1 / 60, isMultiplayer: false,
        getMainAi: () => state.otherPlayers.get('main_ai'), activeCustomMap: map, spawnPoints: [], playRespawn: noop });
      if (!dead) {
        if (state.isLunging) {
          const effects = { state, playExplosion: noop, playDeath: noop, playSwing: noop, pushStatsUpdate: noop,
            spawnVoxelShockwaveParticles: noop, recordBotCalibrationDeath: noop, evaluatePlayerKillMedals: () => [] };
          updatePlayerSwordLungeForState({ ...effects, dt: 1 / 60, isMultiplayer: false, activeCustomMap: map,
            multiplayerSocket: null, getMainAi: () => state.otherPlayers.get('main_ai'),
            areCombatantsHostile: (a, b) => areGrifballCombatantsHostileForState(state, a, b),
            constrainCombatantToArena: constrain, renderSwordLungeTrailVfx: noop, recordPlayerLungeEnd: noop,
            recordPlayerCounterSuccess: noop, recordPlayerDamageDealt: noop, applyOutgoingMultiplayerHitLocally: noop,
            executeTrade: reason => executeMainAITradeForState({ ...effects, mainAi: state.otherPlayers.get('main_ai'), reason }) });
        } else {
          updatePlayerHorizontalMovementForState({ state, refs, dt: 1 / 60, keysPressed: {}, movementKeybindings: DEFAULT_KEYBINDINGS,
          actionKeybindings: DEFAULT_KEYBINDINGS, gamepad: null, mobileJoystick: null, mobileControlsActive: false,
          sprintToggleActiveRef: { current: false }, prevSprintInputRef: { current: false } });
          updatePlayerVerticalIntegrationForState({ state, dt: 1 / 60, gravityAcceleration: 18, constrainCombatantToArena: constrain });
        }
      }
      f.weaponFrame(1 / 60); f.respawns(1 / 60);
      if (bot.hp > 0) {
        tickCombatantInvulnerability(bot, 1 / 60); bot.aiTimer = Math.max(0, (bot.aiTimer ?? 0) - 1 / 60);
        const proxy = { ...target, id: 'player', team: state.localPlayerTeam, hp: state.playerHP, maxHp: state.playerMaxHP,
          pos: state.playerPos, vel: state.playerVel, activeWeapon: state.activeWeapon === 'sword' ? 'sword' as const : 'hammer' as const, isLunging: state.isLunging,
          invulnerabilityTimer: state.playerInvulnerabilityTimer, isCrouching: state.isCrouching };
        f.flightFor(bot, proxy);
      }
      f.visuals(1 / 60);
    });
    const actions = Object.fromEntries(sim.combatants.map(c => [c.id, { ...idleAction(), aim: c.yaw }]));
    const events = stepSimulation(sim, actions, { settings: sim.settings });
    if (restored) {
      const restoredEvents = stepSimulation(restored, actions, { settings: restored.settings });
      record.compare(tick, 'snapshot.state', JSON.stringify(restored), JSON.stringify(sim));
      record.compare(tick, 'snapshot.events', JSON.stringify(restoredEvents), JSON.stringify(events));
    }
    if (tick === snapshotAt) restored = JSON.parse(JSON.stringify(sim));
    for (const e of events.kills) { kills.set(e.attackerId, (kills.get(e.attackerId) ?? 0) + 1); deaths.set(e.victimId, (deaths.get(e.victimId) ?? 0) + 1); }
    const rawPhase = state.activeWeapon === 'sword' ? state.pSwordState : state.pWeaponState;
    const canonical = (phase: string) => phase === 'ready' ? 'idle' : ['slashing', 'swing_up', 'swing_down'].includes(phase) ? 'attack' : phase;
    const live = { hp: state.playerHP, lunging: state.isLunging, phase: canonical(rawPhase), elapsed: state.activeWeapon === 'sword' ? state.pSwordTimer : state.pWeaponTimer,
      shield: state.playerInvulnerabilityTimer, respawn: Math.max(0, state.playerRespawnTimer), weapon: state.activeWeapon,
      pos: state.playerPos.toArray(), vel: state.playerVel.toArray(), heading: [Math.sin(state.yaw), Math.cos(state.yaw)], kills: state.playerKills, deaths: state.playerDeaths };
    const headless = { hp: player.hp, lunging: player.isLunging, phase: ['windup', 'active'].includes(player.weaponState) ? 'attack' : player.weaponState,
      elapsed: player.weaponPhaseElapsed ?? 0, shield: player.invulnerabilityTimer, respawn: player.respawnTimer, weapon: player.weapon,
      pos: Object.values(player.pos), vel: Object.values(player.vel), heading: [Math.sin(player.yaw + Math.PI), Math.cos(player.yaw + Math.PI)], kills: kills.get('player') ?? 0, deaths: deaths.get('player') ?? 0 };
    for (const field of ['hp', 'lunging', 'phase', 'elapsed', 'shield', 'respawn', 'weapon', 'kills', 'deaths'] as const) record.compare(tick, `player.${field}`, live[field], headless[field], 1e-6);
    for (const field of ['pos', 'vel', 'heading'] as const) for (let i = 0; i < live[field].length; i++) record.compare(tick, `player.${field}.${i}`, live[field][i], headless[field][i], 1e-6);
    const liveBot = { hp: bot.hp, shield: bot.invulnerabilityTimer, respawn: bot.respawnTimer, pos: bot.pos.toArray(), kills: bot.kills ?? 0, deaths: bot.deaths ?? 0, lunging: !!bot.isLunging };
    const simBot = { hp: self.hp, shield: self.invulnerabilityTimer, respawn: self.respawnTimer, pos: Object.values(self.pos), kills: kills.get(self.id) ?? 0, deaths: deaths.get(self.id) ?? 0, lunging: self.isLunging };
    for (const field of ['hp', 'shield', 'respawn', 'kills', 'deaths', 'lunging'] as const) record.compare(tick, `bot.${field}`, liveBot[field], simBot[field], 1e-6);
    for (let i = 0; i < 3; i++) record.compare(tick, `bot.pos.${i}`, liveBot.pos[i], simBot.pos[i], 1e-6);
    frames.push({ tick, live, headless, liveBot, simBot });
  }
  if (opposed) {
    const { first, playerHp, botHp, trade, reload } = opposed;
    const playerDamage = trade || first === 'roster' || botHp > 1 ? 1 : 0;
    const botDamage = trade || first === 'player' || playerHp > 1 ? 1 : 0;
    const contactTick = first === 'player' ? 5 : 4;
    for (const side of ['live', 'headless'] as const) {
      record.compare(120, `expected.${side}.hp`, frames[119][side].hp, playerHp - playerDamage);
      record.compare(300, `expected.${side}.kills`, frames[299][side].kills, botDamage && botHp === 1 ? 1 : 0);
      record.compare(300, `expected.${side}.deaths`, frames[299][side].deaths, playerDamage && playerHp === 1 ? 1 : 0);
      if (playerHp > playerDamage) {
        const recoverTick = first === 'player' || !trade && playerHp > 1 ? 5 : 4;
        record.compare(recoverTick, `expected.${side}.recovering`, frames[recoverTick - 1][side].phase, 'recovering');
        const readyTick = recoverTick + Math.ceil(reload * 60) - (first === 'player' || !trade && playerHp > 1 ? 1 : 0);
        record.compare(readyTick - 1, `expected.${side}.notReadyEarly`, frames[readyTick - 2][side].phase, 'recovering');
        record.compare(readyTick, `expected.${side}.ready`, frames[readyTick - 1][side].phase, 'idle');
      }
    }
    for (const side of ['liveBot', 'simBot'] as const) {
      record.compare(120, `expected.${side}.hp`, frames[119][side].hp, botHp - botDamage);
      record.compare(contactTick - 1, `expected.${side}.beforeContact`, frames[contactTick - 2][side].lunging, true);
      record.compare(contactTick, `expected.${side}.endFlight`, frames[contactTick - 1][side].lunging, false);
    }
    return { name: `opposed/${first}/${playerHp}-${botHp}/${trade}/${spec.main}/${spec.mirror}/${spec.reverse}`,
      scenario: { ...spec, opposed }, ticks: 300, combatExecution: 'live-mixed-v1', ...record.result(), frames };
  }
  const hit = !['shield', 'friendly', 'dead', 'double-respawn'].includes(spec.kind);
  const expectedPlayerHp = hit ? player.maxHp - 1 : spec.kind === 'dead' ? 0 : player.maxHp;
  const contactTick = near ? 1 : spec.kind === 'shield-expiry' ? 10 : 9;
  const reviveTick = spec.kind === 'double-respawn' ? 2 : spec.kind === 'dead' ? 181 : hit && player.maxHp === 1 ? contactTick + 181 : 0;
  for (const side of ['live', 'headless'] as const) {
    record.compare(120, `expected.${side}.hpBeforeRevival`, frames[119][side].hp, expectedPlayerHp);
    record.compare(300, `expected.${side}.hpAfterRevival`, frames[299][side].hp, expectedPlayerHp === 0 ? player.maxHp : expectedPlayerHp);
    record.compare(300, `expected.${side}.kills`, frames[299][side].kills, trade && self.maxHp === 1 ? 1 : 0);
    record.compare(300, `expected.${side}.deaths`, frames[299][side].deaths, hit && player.maxHp === 1 ? 1 : 0);
    if (reviveTick) {
      record.compare(reviveTick - 1, `expected.${side}.deadBeforeRevival`, frames[reviveTick - 2][side].hp, 0);
      record.compare(reviveTick, `expected.${side}.revival`, frames[reviveTick - 1][side].hp, player.maxHp);
      record.compare(reviveTick, `expected.${side}.revivalShield`, frames[reviveTick - 1][side].shield, .5, 1e-6);
      record.compare(reviveTick + 1, `expected.${side}.nextShield`, frames[reviveTick][side].shield, .5 - 1 / 60, 1e-6);
      record.compare(reviveTick, `expected.${side}.spawnX`, frames[reviveTick - 1][side].pos[0], -10);
    }
  }
  for (const side of ['liveBot', 'simBot'] as const) {
    record.compare(120, `expected.${side}.damage`, frames[119][side].hp, trade ? self.maxHp - 1 : self.maxHp);
    record.compare(300, `expected.${side}.kills`, frames[299][side].kills, hit && player.maxHp === 1 ? 1 : 0);
    if (spec.kind === 'double-respawn' || trade && self.maxHp === 1) {
      record.compare(reviveTick, `expected.${side}.occupiedSpawn`, frames[reviveTick - 1][side].pos[0], 10);
      record.compare(reviveTick, `expected.${side}.revivalShield`, frames[reviveTick - 1][side].shield, .5 - 1 / 60, 1e-6);
    }
  }
  return { name: `${spec.kind}/${spec.main ? 'main' : 'regular'}/${spec.mirror ? 'mirror' : 'original'}/${spec.reverse ? 'reverse' : 'forward'}`,
    scenario: spec, ticks: 300, combatExecution: 'live-mixed-v1', ...record.result(), frames };
}

export const runMixedLifecycleParity = () => MIXED_LIFECYCLE_CASES.map(spec => runMixedLifecycleTrace(spec));

import * as THREE from 'three';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { parityRecorder } from './grifballMultiActorParity';
import { DEFAULT_KEYBINDINGS, type Combatant } from '../../src/types';
import { triggerPlayerSwordLungeForState } from '../../src/components/grifball/playerWeaponActions';
import { updatePlayerSwordLungeForState } from '../../src/components/grifball/playerSwordLungeRuntime';
import { executeMainAITradeForState } from '../../src/components/grifball/tradeRuntime';
import { areGrifballCombatantsHostileForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { updatePlayerHorizontalMovementForState, updatePlayerVerticalIntegrationForState } from '../../src/components/grifball/playerMovementRuntime';
import { updatePlayerRespawnForState } from '../../src/components/grifball/playerRespawnRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { triggerCombatantAttackAction } from '../../src/components/grifball/combatantActions';
import { tickCombatantInvulnerability } from '../../src/components/grifball/aiTickState';
import { seededRandom, withSimulationRandom } from '../../src/game/simulationRandom';
import { stepSimulation } from '../../src/sim/step';
import { stepCombatantWeapons } from '../../src/sim/weapons';
import { idleAction } from '../../src/sim/actions';
import type { SimCombatExecution, SimState } from '../../src/sim/simState';

const noop = () => {};
const KINDS = ['hit-one', 'hit-two', 'shield', 'friendly', 'timeout', 'boundary',
  'sword-trade-one', 'sword-trade-two', 'hammer-trade-one', 'hammer-trade-two',
  'melee-first', 'player-first', 'same-frame-one', 'same-frame-two', 'killed-flight', 'damaged-flight'] as const;
export interface PlayerLungeParityCase {
  kind: typeof KINDS[number]; mainTarget: boolean; reverse: boolean; mirror: boolean;
}
export const PLAYER_LUNGE_PARITY_CASES: PlayerLungeParityCase[] = KINDS.flatMap(kind =>
  [false, true].flatMap(mainTarget => [false, true].flatMap(reverse => [false, true].map(mirror => ({ kind, mainTarget, reverse, mirror })))));
const phase = (c: Combatant) => c.weaponState === 'ready' ? 'idle'
  : ['swing_up', 'melee_up'].includes(c.weaponState ?? '') ? 'windup'
  : ['swing_down', 'melee_down'].includes(c.weaponState ?? '') ? 'active' : 'recovering';

/** Live local physics → player animation → roster respawn/shield → roster animation,
 * independently compared with stepSimulation. No state copying after commitment. */
export function runPlayerLungeParityTrace(spec: PlayerLungeParityCase, execution: SimCombatExecution = 'live-mixed-v1', snapshotAt?: number) {
  const f = createBotParityFixture('melee', false, {}, spec.mainTarget ? 'main_ai' : 'target');
  const { state, sim, target, bot, refs, map } = f;
  const trade = spec.kind.includes('trade'), threatened = spec.kind.endsWith('flight');
  const mixed = ['melee-first', 'player-first', 'same-frame-one', 'same-frame-two'].includes(spec.kind) || threatened;
  const direction = spec.mirror ? -1 : 1;
  const settings = { swordLungeSpeed: 24, swordLungeReload: .6, swordSlashSpeed: .22,
    attackRange: 2, attackRadius: 1.5, hammerSlamWindupTime: .05, hammerSlamAttackTime: .06,
    enableSwordTrade: trade, enableHammerSwordTrade: trade };
  Object.assign(state.settings, settings); Object.assign(sim.settings, settings);
  sim.combatExecution = execution; sim.localPlayerId = 'player'; sim.match.phase = 'playing';
  const player = { ...structuredClone(sim.combatants[0]), id: 'player', controller: 'remote' as const };
  sim.combatants.push(player);
  const pairs = [[bot, sim.combatants[0]], [target, sim.combatants[1]]] as const;
  const team = spec.mirror ? 'red' : 'blue', opponent = spec.mirror ? 'blue' : 'red';
  state.localPlayerTeam = player.team = team;
  const targetZ = trade ? 1.8 : threatened ? 12 : spec.kind === 'melee-first' ? 4.6
    : spec.kind === 'player-first' ? 3.8 : spec.kind.startsWith('same-frame') ? 4.2
    : spec.kind === 'timeout' || spec.kind === 'boundary' ? 50 : 5;
  for (const [a, b] of pairs) {
    b.id = a.id; a.hp = a.maxHp = b.hp = b.maxHp = 20;
    a.invulnerabilityTimer = b.invulnerabilityTimer = b.weaponReadyTimer = 0;
    a.weaponState = 'ready'; a.weaponTimer = 0; a.isLunging = b.isLunging = false;
    a.activeWeapon = b.weapon = 'hammer'; a.aiState = 'APPROACHING';
    a.vel.set(0, 0, 0); b.vel = { x: 0, y: 0, z: 0 };
  }
  target.team = pairs[1][1].team = spec.kind === 'friendly' ? team : opponent;
  target.pos.set(0, 0, direction * targetZ);
  target.hp = target.maxHp = pairs[1][1].hp = pairs[1][1].maxHp = spec.kind.endsWith('two') || spec.kind === 'shield' ? 2 : 1;
  bot.team = pairs[0][1].team = threatened ? opponent : team;
  bot.pos.set(threatened ? 2 : mixed ? .3 : 40, 0, direction * (threatened ? 2.8 : mixed ? targetZ - 2 : 40));
  bot.yaw = threatened ? Math.PI / 2 : spec.mirror ? 0 : Math.PI;
  target.yaw = spec.mirror ? Math.PI : 0;
  if (spec.kind === 'boundary') { target.pos.set(3, 0, 0); bot.pos.set(-2, 0, 0); }
  for (const [a, b] of pairs) { b.pos = { x: a.pos.x, y: a.pos.y, z: a.pos.z }; b.yaw = a.yaw - Math.PI; }
  state.activeWeapon = player.weapon = 'sword'; state.playerPos.set(0, 0, 0); state.playerVel.set(0, 0, 0);
  player.pos = { x: 0, y: 0, z: 0 }; player.vel = { x: 0, y: 0, z: 0 };
  state.playerHP = state.playerMaxHP = player.hp = player.maxHp = spec.kind.endsWith('two') || spec.kind === 'damaged-flight' ? 2 : 1;
  state.yaw = spec.mirror ? 0 : Math.PI; player.yaw = state.yaw - Math.PI;
  state.playerInvulnerabilityTimer = player.invulnerabilityTimer = player.weaponReadyTimer = state.swapCooldownTimer = 0;
  if (spec.kind === 'shield') target.invulnerabilityTimer = pairs[1][1].invulnerabilityTimer = 10;
  if (spec.kind === 'boundary') { map.mapShape = 'circle'; map.arenaRadius = 4; sim.map = structuredClone(map); }
  state.arenaRadius = map.arenaRadius;
  const ends: boolean[] = [], random = seededRandom(73), record = parityRecorder(), frames = [];
  const getMainAi = () => state.otherPlayers.get('main_ai');
  const effects = { state, playExplosion: noop, playDeath: noop, playSwing: noop, pushStatsUpdate: noop,
    spawnVoxelShockwaveParticles: noop, recordBotCalibrationDeath: noop, evaluatePlayerKillMedals: () => [] };
  const constrain = (pos: THREE.Vector3, vel?: THREE.Vector3) => constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: map, arenaRadius: map.arenaRadius });
  withSimulationRandom(random, 0, () => {
    // A committed heading can miss a target that has moved away from the lock point.
    const lockTarget = spec.kind === 'boundary' ? { ...target, pos: new THREE.Vector3(0, 0, direction * 50) } : target;
    triggerPlayerSwordLungeForState({ state, lockTarget, recordLungeStart: noop, playDash: noop, sendSync: noop });
    player.lungeTargetId = target.id;
    if (spec.kind === 'boundary') player.lungeAimDirection = { x: 0, y: 0, z: direction };
    stepCombatantWeapons(sim, player, { ...idleAction(), attackSecondary: true }, sim.settings, 0, []);
    for (const [a, b] of pairs) if (a === bot && mixed || a === target && trade) {
      a.activeWeapon = b.weapon = a === target && spec.kind.startsWith('sword') || a === bot ? 'sword' : 'hammer';
      triggerCombatantAttackAction({ self: a, weapon: b.weapon, melee: false, recordHammerAttack: noop, playSwing: noop });
      stepCombatantWeapons(sim, b, { ...idleAction(), attackPrimary: true }, sim.settings, 0, []);
    }
  });
  if (spec.reverse) { state.otherPlayers = new Map([...state.otherPlayers].reverse()); sim.combatants.reverse(); }
  const kills = new Map<string, number>(), deaths = new Map<string, number>();
  let endTick = 0, simEndTick = 0;
  let restored: SimState | undefined;
  for (let tick = 1; tick <= 120; tick++) {
    const wasLunging = state.isLunging, simWasLunging = player.isLunging;
    withSimulationRandom(random, tick / 60, () => {
      const dead = updatePlayerRespawnForState({ state, dt: 1 / 60, isMultiplayer: false, getMainAi,
        activeCustomMap: map, spawnPoints: [], playRespawn: noop });
      if (!dead) {
        if (state.isLunging) updatePlayerSwordLungeForState({ ...effects, dt: 1 / 60, isMultiplayer: false,
          activeCustomMap: map, multiplayerSocket: null, getMainAi,
          areCombatantsHostile: (a, b) => areGrifballCombatantsHostileForState(state, a, b),
          constrainCombatantToArena: constrain, renderSwordLungeTrailVfx: noop, recordPlayerLungeEnd: hit => { ends.push(hit); },
          recordPlayerCounterSuccess: noop, recordPlayerDamageDealt: noop, applyOutgoingMultiplayerHitLocally: noop,
          executeTrade: reason => executeMainAITradeForState({ ...effects, mainAi: getMainAi(), reason }) });
        else {
          updatePlayerHorizontalMovementForState({ state, refs, dt: 1 / 60, keysPressed: {}, movementKeybindings: DEFAULT_KEYBINDINGS,
            actionKeybindings: DEFAULT_KEYBINDINGS, gamepad: null, mobileJoystick: null, mobileControlsActive: false,
            sprintToggleActiveRef: { current: false }, prevSprintInputRef: { current: false } });
          updatePlayerVerticalIntegrationForState({ state, dt: 1 / 60, gravityAcceleration: 18, constrainCombatantToArena: constrain });
        }
      }
      f.weaponFrame(1 / 60); f.respawns(1 / 60);
      for (const c of state.otherPlayers.values()) if (c.hp > 0) tickCombatantInvulnerability(c, 1 / 60);
      f.visuals(1 / 60);
    });
    const actions = Object.fromEntries(sim.combatants.map(c => [c.id, { ...idleAction(), aim: c.yaw }]));
    const events = stepSimulation(sim, actions, { settings: sim.settings });
    if (restored) {
      const restoredEvents = stepSimulation(restored, actions, { settings: restored.settings });
      record.compare(tick, 'snapshot.events', JSON.stringify(restoredEvents), JSON.stringify(events));
      record.compare(tick, 'snapshot.state', JSON.stringify(restored), JSON.stringify(sim));
    }
    if (tick === snapshotAt) restored = JSON.parse(JSON.stringify(sim));
    for (const e of events.kills) { kills.set(e.attackerId, (kills.get(e.attackerId) ?? 0) + 1); deaths.set(e.victimId, (deaths.get(e.victimId) ?? 0) + 1); }
    if (wasLunging && !state.isLunging && !endTick) endTick = tick;
    if (simWasLunging && !player.isLunging && !simEndTick) simEndTick = tick;
    const livePlayer = { hp: state.playerHP, lunging: state.isLunging, phase: state.pSwordState === 'ready' ? 'idle' : state.pSwordState,
      elapsed: state.pSwordTimer, respawn: state.playerRespawnTimer, pos: state.playerPos.toArray(), vel: state.playerVel.toArray(), kills: state.playerKills, deaths: state.playerDeaths };
    const headlessPlayer = { hp: player.hp, lunging: player.isLunging, phase: player.weaponState,
      elapsed: player.weaponPhaseElapsed ?? 0, respawn: player.respawnTimer, pos: Object.values(player.pos), vel: Object.values(player.vel), kills: kills.get('player') ?? 0, deaths: deaths.get('player') ?? 0 };
    for (const field of ['hp', 'lunging', 'phase', 'elapsed', 'respawn', 'kills', 'deaths'] as const) record.compare(tick, `player.${field}`, livePlayer[field], headlessPlayer[field], 1e-6);
    for (const field of ['pos', 'vel'] as const) for (let i = 0; i < 3; i++) record.compare(tick, `player.${field}.${i}`, livePlayer[field][i], headlessPlayer[field][i], 1e-6);
    const actorFrames = pairs.map(([a, b]) => {
      const live = { hp: a.hp, phase: phase(a), elapsed: a.weaponTimer, respawn: a.respawnTimer, shield: a.invulnerabilityTimer, kills: a.kills ?? 0, deaths: a.deaths ?? 0 };
      const headless = { hp: b.hp, phase: b.weaponState, elapsed: b.weaponPhaseElapsed ?? 0, respawn: b.respawnTimer, shield: b.invulnerabilityTimer, kills: kills.get(b.id) ?? 0, deaths: deaths.get(b.id) ?? 0 };
      for (const field of ['hp', 'phase', 'elapsed', 'respawn', 'shield', 'kills', 'deaths'] as const) record.compare(tick, `${a.id}.${field}`, live[field], headless[field], 1e-6);
      return { id: a.id, live, headless };
    });
    frames.push({ tick, live: livePlayer, headless: headlessPlayer, actors: actorFrames });
  }
  record.compare(120, 'finishTick', endTick, simEndTick);
  const expectedTargetHp = spec.kind === 'hit-two' || spec.kind.endsWith('trade-two') ? 1
    : spec.kind === 'shield' ? 2 : ['friendly', 'timeout', 'boundary', 'killed-flight'].includes(spec.kind) ? 1 : 0;
  const expectedPlayerHp = spec.kind.endsWith('trade-one') || spec.kind === 'killed-flight' ? 0
    : ['hit-two', 'same-frame-two'].includes(spec.kind) ? 2 : 1;
  for (const [side, hp, targetHp] of [['live', state.playerHP, target.hp], ['headless', player.hp, pairs[1][1].hp]] as const) {
    record.compare(120, `expected.${side}.playerHP`, hp, expectedPlayerHp);
    record.compare(120, `expected.${side}.targetHP`, targetHp, expectedTargetHp);
  }
  const expectedFinish = trade ? 1 : spec.kind === 'boundary' ? 9 : spec.kind === 'timeout' ? 40
    : ['shield', 'friendly'].includes(spec.kind) ? 1 : spec.kind === 'player-first' ? 6
    : spec.kind === 'melee-first' ? 8 : spec.kind.startsWith('same-frame') || spec.kind === 'killed-flight' ? 7
    : spec.kind === 'damaged-flight' ? 27 : 9;
  record.compare(120, 'expected.live.finish', endTick, expectedFinish); record.compare(120, 'expected.headless.finish', simEndTick, expectedFinish);
  const expectedPlayerKills = ['hit-one', 'player-first', 'same-frame-one', 'damaged-flight'].includes(spec.kind) || spec.kind.endsWith('trade-one') ? 1 : 0;
  const expectedBotKills = ['melee-first', 'same-frame-two', 'killed-flight'].includes(spec.kind) ? 1 : 0;
  record.compare(120, 'expected.live.playerKills', state.playerKills, expectedPlayerKills);
  record.compare(120, 'expected.headless.playerKills', kills.get('player') ?? 0, expectedPlayerKills);
  record.compare(120, 'expected.live.botKills', bot.kills ?? 0, expectedBotKills);
  record.compare(120, 'expected.headless.botKills', kills.get(bot.id) ?? 0, expectedBotKills);
  return { name: `${spec.kind}/${spec.mainTarget ? 'main' : 'regular'}/${spec.reverse ? 'reversed' : 'forward'}/${spec.mirror ? 'mirrored' : 'original'}`,
    scenario: spec, combatExecution: execution, ticks: 120, ...record.result(), frames };
}

export const runPlayerLungeParity = () => PLAYER_LUNGE_PARITY_CASES.map(spec => runPlayerLungeParityTrace(spec));

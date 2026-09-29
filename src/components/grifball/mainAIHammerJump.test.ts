import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { createOfflineBotCombatant } from '../../game/roster';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { startAIHammerJumpForCombatant } from './combatantActions';
import { triggerEnemyHammerSwingForCombatant } from './enemyWeaponActions';
import { applyBotMeleeImpactForState } from './botMeleeImpactRuntime';
import { updateRosterCombatantVisualsForState } from './rosterVisualSync';
import { buildCombatantRigForModel } from './combatantRig';

const noop = () => {};
function fixture() {
  const state = createInitialGrifballRuntimeState({ debugMode: false,
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball', hammerSlamWindupTime: .08, hammerSlamAttackTime: .04 },
    isMultiplayer: false, multiplayerRole: null });
  state.isObserverMode = true;
  const refs = createInitialGrifballThreeRefs();
  const bot = createOfflineBotCombatant({ id: 'main_ai', playerName: 'main', team: 'red', spawnPos: new THREE.Vector3(),
    yaw: 0, hue: 0, difficulty: 'normal', settings: state.settings });
  Object.assign(bot, { hp: 1, maxHp: 1, respawnTimer: 0, weaponState: 'ready', activeWeapon: 'hammer',
    weaponTimer: 0, swapCooldownTimer: 0, aiDashRemaining: 0, aiHammerJumpsInAir: 0 });
  state.otherPlayers.clear(); state.otherPlayers.set(bot.id, bot);
  const group = new THREE.Group(); group.userData.modelSystem = 'v2';
  refs.otherPlayerMeshes.set(bot.id, { group, hammer: new THREE.Group(), sword: new THREE.Group(), rig: buildCombatantRigForModel(group) });
  let impacts = 0, jumps = 0;
  const centers: THREE.Vector3[] = [];
  const impact = () => { impacts++; applyBotMeleeImpactForState({ state, botId: bot.id, renderHammerSplashVfx: pos => centers.push(pos.clone()),
    spawnVoxelShockwaveParticles: noop, playExplosion: noop, playDeath: noop, playSwing: noop,
    playJump: () => jumps++, recordBotPsychKill: noop, recordBotCalibrationDeath: noop }); };
  const step = () => updateRosterCombatantVisualsForState({ state, refs, dt: 1 / 60, renderSwordLungeTrailVfx: noop, applyBotMeleeImpact: impact });
  const start = () => startAIHammerJumpForCombatant({ self: bot, settings: state.settings, vel: bot.vel,
    onMainAIHammerSwing: () => triggerEnemyHammerSwingForCombatant(bot), playSwing: noop, playJump: noop });
  return { state, bot, start, step, impact, centers, impacts: () => impacts, jumps: () => jumps };
}

test('registered main AI launches once at the roster hammer impact without needing a live target', () => {
  const f = fixture();
  assert.equal(f.start(), true);
  assert.equal(f.bot.vel.y, 0);
  for (let i = 0; i < 7; i++) f.step();
  assert.equal(f.impacts(), 0);
  assert.equal(f.bot.vel.y, 0);
  f.step();
  assert.equal(f.impacts(), 1);
  assert.equal(f.bot.vel.y, 7.2 + f.state.settings.hammerJumpPower);
  assert.equal(f.bot.isJumping, true);
  assert.equal(f.bot.aiHammerJumpsInAir, 1);
  assert.equal(f.bot.hammerJumpPlanned, false);
  assert.equal(f.bot.hammerJumpType, undefined);
  assert.equal(f.jumps(), 1);
  assert.deepEqual(f.centers[0].toArray(), [0, 1.2 - f.state.settings.attackRange, 0]);
  for (let i = 0; i < 60; i++) f.step();
  assert.equal(f.impacts(), 1);
  assert.equal(f.bot.aiHammerJumpsInAir, 1);
  assert.equal(f.jumps(), 1);
});

for (const reason of ['dash', 'swap'] as const) test(`main AI rejected ${reason} jump does not leave a latent plan`, () => {
  const f = fixture();
  if (reason === 'dash') f.bot.aiDashRemaining = .1; else f.bot.swapCooldownTimer = .1;
  assert.equal(f.start(), false);
  assert.equal(!!f.bot.hammerJumpPlanned, false);
  assert.equal(f.bot.hammerJumpType, undefined);
  assert.equal(f.bot.aiHammerJumpsInAir, 0);
  assert.equal(f.bot.weaponState, 'ready');
});

for (const reason of ['disabled', 'exhausted', 'outside-radius'] as const) test(`queued main jump respects ${reason} at impact`, () => {
  const f = fixture(); assert.equal(f.start(), true);
  if (reason === 'disabled') f.state.settings.hammerJumpAirLimit = 0;
  if (reason === 'exhausted') f.bot.aiHammerJumpsInAir = f.state.settings.hammerJumpAirLimit;
  if (reason === 'outside-radius') f.state.settings.hammerJumpTriggerRadius = .01;
  for (let i = 0; i < 8; i++) f.step();
  assert.equal(f.impacts(), 1);
  assert.equal(f.bot.vel.y, 0);
  assert.equal(f.bot.hammerJumpPlanned, false);
  assert.equal(f.bot.hammerJumpType, undefined);
});

test('death before the queued impact prevents a launch', () => {
  const f = fixture(); assert.equal(f.start(), true); f.bot.hp = 0; f.bot.respawnTimer = 3;
  for (let i = 0; i < 8; i++) f.step();
  assert.equal(f.impacts(), 0);
  assert.equal(f.bot.vel.y, 0);
  assert.equal(f.bot.aiHammerJumpsInAir, 0);
});

test('unlimited air jumps launch after the usual budget would be exhausted', () => {
  const f = fixture(); f.state.settings.hammerJumpAirLimit = 10; f.bot.aiHammerJumpsInAir = 12;
  assert.equal(f.start(), true);
  for (let i = 0; i < 8; i++) f.step();
  assert.equal(f.bot.aiHammerJumpsInAir, 13);
  assert.equal(f.jumps(), 1);
});

test('a normal registered main slam keeps its forward impact and does not launch', () => {
  const f = fixture(); triggerEnemyHammerSwingForCombatant(f.bot);
  for (let i = 0; i < 8; i++) f.step();
  assert.deepEqual(f.centers[0].toArray(), [0, 1.2, -f.state.settings.attackRange]);
  assert.equal(f.bot.vel.y, 0); assert.equal(f.jumps(), 0);
});

test('a queued jump cannot turn a subsequent carrier punch into a launch', () => {
  const f = fixture(); assert.equal(f.start(), true); f.bot.activeWeapon = 'ball';
  f.impact();
  assert.equal(f.bot.vel.y, 0); assert.equal(f.jumps(), 0);
  assert.equal(f.bot.hammerJumpPlanned, false); assert.equal(f.bot.hammerJumpType, undefined);
});

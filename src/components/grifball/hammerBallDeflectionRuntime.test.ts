import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMatch } from '../../sim/factory';
import { stepCombatantWeapons } from '../../sim/weapons';
import { idleAction } from '../../sim/actions';
import { createOfflineBotCombatant } from '../../game/roster';
import { throwBall } from '../../game/grifballBall';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { applyHammerStrikeImpactForState } from './hammerStrikeImpactRuntime';
import { applyBotMeleeImpactForState } from './botMeleeImpactRuntime';
import { deflectBallWithHammerForState } from './hammerBallDeflectionRuntime';

const noop = () => {};
const callbacks = {
  playSwing: noop, playDeath: noop, playExplosion: noop, playJump: noop, renderHammerSplashVfx: noop,
  spawnVoxelShockwaveParticles: noop, recordBotCalibrationDeath: noop, recordPlayerDamageTaken: noop,
  tryRecordCalibrationCounterSuccess: noop, recordBotPsychKill: noop, recordBotDamageTag: noop,
  tryEnterPressureState: () => false, tryStartComboOnHit: noop, pushStatsUpdate: noop,
  evaluatePlayerKillMedals: () => [], areCombatantsHostile: () => false,
  sendSync: () => true, applyOutgoingMultiplayerHitLocally: noop,
};
function fixture() {
  const sim = createMatch({ seed: 7, combatExecution: 'live-mixed-v1', teamSizes: { blue: 1, red: 1 } });
  sim.match.phase = 'playing';
  sim.localPlayerId = sim.combatants[0].id;
  const live = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: { ...sim.settings },
    isMultiplayer: false, multiplayerRole: null });
  live.grifball.phase = 'playing'; live.otherPlayers.clear(); live.playerPos.set(0, 0, 0);
  live.playerHP = 1; live.playerRespawnTimer = 0; live.yaw = Math.PI; live.pitch = live.crouchAmount = 0;
  live.activeWeapon = 'hammer';
  for (const ball of [sim.match.ball, live.grifball.ball])
    throwBall(ball, { x: 0, y: 1.2, z: 3 }, { x: 0, y: 0, z: -1 }, 20, 0);
  return { sim, live };
}
for (const role of ['player', 'ai'] as const) for (const enabled of [true, false]) {
  test(`${role} blast matches simulation with deflection ${enabled ? 'on' : 'off'}`, () => {
    const { sim, live } = fixture();
    sim.settings.hammerBallDeflectionEnabled = live.settings.hammerBallDeflectionEnabled = enabled;
    sim.settings.hammerBallDeflectionStrength = live.settings.hammerBallDeflectionStrength = 1.5;
    const attacker = sim.combatants[role === 'player' ? 0 : 1];
    attacker.pos = { x: 0, y: 0, z: 0 }; attacker.yaw = 0; attacker.pitch = 0;
    attacker.weapon = 'hammer'; attacker.weaponState = 'active'; attacker.weaponTimer = 0;
    attacker.weaponPhaseElapsed = 10; attacker.attackKind = 'strike'; attacker.alive = true;
    attacker.isLunging = false; attacker.weaponReadyTimer = 0;
    if (role === 'player') {
      applyHammerStrikeImpactForState({ ...callbacks, state: live, isPlayerStriking: true,
        mainAI: undefined, getEnemyAITarget: () => null, isMultiplayer: false });
    } else {
      const bot = createOfflineBotCombatant({ id: attacker.id, playerName: 'Bot', team: 'red',
        spawnPos: new THREE.Vector3(), yaw: Math.PI, hue: 0, difficulty: 'normal', settings: live.settings });
      bot.hp = 1; bot.respawnTimer = 0; bot.activeWeapon = 'hammer'; bot.weaponState = 'swing_down';
      live.otherPlayers.set(bot.id, bot);
      applyBotMeleeImpactForState({ ...callbacks, state: live, botId: bot.id });
    }
    stepCombatantWeapons(sim, attacker, idleAction(), sim.settings, 1 / 60, [], 'animation');
    assert.deepEqual(live.grifball.ball.vel, sim.match.ball.vel);
    assert.equal(live.grifball.ball.vel.z > 0, enabled);
    assert.ok(Math.abs(Math.hypot(...Object.values(live.grifball.ball.vel)) - (enabled ? 30 : 20)) < 1e-9);
  });
}
test('only the host applies online blasts; countdown, sandbox and held balls are unaffected', () => {
  const { live } = fixture();
  const hit = () => deflectBallWithHammerForState(live, live.playerPos, live.grifball.ball.pos, 4.5);
  live.isMultiplayer = true; live.multiplayerRole = 'client'; assert.equal(hit(), false);
  live.multiplayerRole = 'observer'; assert.equal(hit(), false);
  live.multiplayerRole = 'host'; assert.equal(hit(), true);
  live.grifball.phase = 'countdown'; assert.equal(hit(), false);
  live.grifball.phase = 'playing'; live.settings.gameMode = 'sandbox'; assert.equal(hit(), false);
});
test('runner punches do not trigger hammer blast deflection', () => {
  const { live } = fixture(); live.activeWeapon = 'ball';
  const before = structuredClone(live.grifball.ball);
  applyHammerStrikeImpactForState({ ...callbacks, state: live, isPlayerStriking: true,
    mainAI: undefined, getEnemyAITarget: () => null, isMultiplayer: false });
  assert.deepEqual(live.grifball.ball, before);
});

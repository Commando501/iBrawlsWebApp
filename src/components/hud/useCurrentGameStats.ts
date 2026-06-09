import { useEffect, useState } from 'react';
import { type GameStats } from '../../types';
import {
  DEFAULT_HAMMER_SLAM_ATTACK_TIME,
  DEFAULT_HAMMER_SLAM_TIMING_LOCKED,
  DEFAULT_HAMMER_SLAM_WINDUP_TIME,
} from '../../game/hammerSlamTiming';

export function createInitialGameStats(playerHue: number, ping: number): GameStats {
  return {
    playerHP: 1,
    playerMaxHP: 1,
    enemyHP: 1,
    enemyMaxHP: 1,
    scorePlayer: 0,
    scoreEnemy: 0,
    gameTime: 522,
    debugMode: false,
    debugDamageRadius: 4.5,
    weaponReady: true,
    weaponCooldown: 1.0,
    lastStrikePos: null,
    lastStrikeTick: 0,
    isCrouching: false,
    isJumping: false,
    playerRespawnTimer: 0,
    enemyRespawnTimer: 0,
    playerDashCooldownTimer: 0,
    playerDashReady: true,
    settings: {
      maxHP: 1,
      speedForward: 100,
      speedSide: 100,
      speedBackward: 100,
      attackRange: 3.2,
      attackRadius: 4.5,
      dashDistance: 6.0,
      dashDuration: 0.25,
      dashCooldown: 2.0,
      respawnInvulnerabilityDuration: 1.0,
      hammerReloadTime: 0.6,
      hammerSlamWindupTime: DEFAULT_HAMMER_SLAM_WINDUP_TIME,
      hammerSlamAttackTime: DEFAULT_HAMMER_SLAM_ATTACK_TIME,
      hammerSlamTimingLocked: DEFAULT_HAMMER_SLAM_TIMING_LOCKED,
      hammerMeleeSpeed: 0.24,
      hammerMeleeReload: 0.5,
      hammerAttackAnimation: 'current',
      hammerSplashVfx: 'current',
      swordLungeVfx: 'current',
      swordLungeDistance: 14.5,
      swordLungeSpeed: 24.0,
      swordAttackAnimation: 'current',
      swordSlashSpeed: 0.22,
      swordSlashReload: 0.6,
      swordLungeReload: 1.2,
      hammerJumpPower: 6.5,
      hammerJumpTriggerRadius: 3.5,
      hammerJumpWindow: 0.6,
      hammerJumpInputGate: 0.0,
      hammerJumpAirLimit: 1,
      visualizeJumpZone: true,
      directLightIntensity: 1.6,
      ambientLightIntensity: 0.82,
      skyboxBrightness: 4.0,
      skyboxHue: 224,
      showSkybox: true,
      enableSwordTrade: true,
      enableHammerSwordTrade: true,
      swordTradeWindow: 350,
      hammerSwordTradeWindow: 350,
      weaponReadyTime: 0.5,
      weaponSwapLockout: 1.0,
      enableSlide: false,
      enableSprint: false,
      speedSprint: 140,
      speedSlide: 160,
      slideDistance: 8.0,
      slideCooldown: 1.5,
      playerHue,
      aiDifficulty: 'normal',
      aiReactionLatency: 0.25,
      aiAnticipationFactor: 0.40,
      aiMovementComplexity: 50,
      aiWeaponSwapIQ: 50,
      aiPlaystyle: 50,
    },
    lastDeaths: [],
    playerX: 0,
    playerZ: 12,
    playerYaw: Math.PI,
    enemyX: 0,
    enemyZ: -12,
    enemyYaw: 0,
    enemyIsCrouching: false,
    playerIsCrouchMoving: false,
    enemyIsCrouchMoving: false,
    activeWeapon: 'hammer',
    crosshairColor: 'white',
    fps: 0,
    ping,
  };
}

interface UseCurrentGameStatsOptions {
  getSavedPlayerHue: () => number;
  ping: number;
}

export function useCurrentGameStats({
  getSavedPlayerHue,
  ping,
}: UseCurrentGameStatsOptions) {
  const [currentStats, setCurrentStats] = useState<GameStats>(() => (
    createInitialGameStats(getSavedPlayerHue(), ping)
  ));

  useEffect(() => {
    setCurrentStats(prev => ({
      ...prev,
      ping,
    }));
  }, [ping]);

  return {
    currentStats,
    setCurrentStats,
  };
}

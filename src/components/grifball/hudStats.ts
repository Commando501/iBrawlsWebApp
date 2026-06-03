import { MAIN_AI_ID } from '../../game/roster';
import { ballAsHammer } from '../../game/weaponCompat';
import { getTeamTally } from '../../game/teamScoring';
import { type Combatant, type GameStats } from '../../types';
import { type GrifballRuntimeState } from './runtimeState';

interface BuildGrifballHudStatsOptions {
  state: GrifballRuntimeState;
  opponent: Combatant | undefined;
  isMultiplayer: boolean;
  multiplayerRole: GameStats['multiplayerRole'];
  opponentConnected: boolean;
  fps: number;
  observerTargetName: string;
  opponentPlayerName: string | undefined;
}

export const buildGrifballHudStats = ({
  state: s,
  opponent: opp,
  isMultiplayer,
  multiplayerRole,
  opponentConnected,
  fps,
  observerTargetName,
  opponentPlayerName,
}: BuildGrifballHudStatsOptions): GameStats => ({
  playerHP: s.playerHP,
  playerMaxHP: s.playerMaxHP,
  enemyHP: opp?.hp ?? 0,
  enemyMaxHP: opp?.maxHp ?? s.settings.maxHP,
  scorePlayer: s.scorePlayer,
  scoreEnemy: s.scoreEnemy,
  otherPlayers: s.otherPlayers ? Array.from(s.otherPlayers.values())
    .filter((p: Combatant) => p.id !== MAIN_AI_ID)
    .map((p: Combatant) => ({
      id: p.id,
      playerName: p.playerName,
      pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
      vel: { x: p.vel.x, y: p.vel.y, z: p.vel.z },
      yaw: p.yaw,
      pitch: p.pitch,
      hp: p.hp,
      maxHp: p.maxHp,
      isCrouching: p.isCrouching,
      activeWeapon: ballAsHammer(p.activeWeapon),
      respawnTimer: p.respawnTimer,
      hue: p.hue,
      score: p.score ?? 0,
      kills: p.kills ?? 0,
      deaths: p.deaths ?? 0,
      isObserver: p.isObserver,
    })) : undefined,
  gameTime: s.gameTime,
  debugMode: s.debugMode,
  debugDamageRadius: s.settings.attackRadius,
  weaponReady: s.activeWeapon === 'hammer'
    ? s.pWeaponReady
    : s.activeWeapon === 'pistol'
      ? s.pPistolReady
      : s.pSwordReady,
  weaponCooldown: s.activeWeapon === 'hammer'
    ? (s.pWeaponCooldown ?? 1.0)
    : s.activeWeapon === 'pistol'
      ? s.pPistolCooldown
      : s.pSwordCooldown,
  activeWeapon: ballAsHammer(s.activeWeapon),
  crosshairColor: s.crosshairColor,
  lastStrikePos: s.lastStrikePos ? [s.lastStrikePos.x, s.lastStrikePos.y, s.lastStrikePos.z] : null,
  lastStrikeTick: s.lastStrikeTick,
  isCrouching: s.isCrouching,
  isJumping: s.isJumping,
  playerRespawnTimer: s.playerHP <= 0 ? s.playerRespawnTimer : 0,
  enemyRespawnTimer: (opp?.hp ?? 0) <= 0 ? s.enemyRespawnTimer : 0,
  playerDashCooldownTimer: s.playerDashCooldownTimer,
  playerDashReady: s.playerDashCooldownTimer <= 0 && s.playerDashRemaining <= 0,
  settings: s.settings,
  lastDeaths: [...s.lastDeaths],
  playerX: s.playerPos.x,
  playerZ: s.playerPos.z,
  playerYaw: s.yaw,
  enemyX: opp?.pos.x ?? 0,
  enemyZ: opp?.pos.z ?? 0,
  enemyYaw: opp?.yaw ?? 0,
  enemyIsCrouching: opp?.isCrouching ?? false,
  playerIsCrouchMoving: s.isCrouching && s.playerVel.length() > 0.15,
  enemyIsCrouchMoving: (opp?.isCrouching ?? false) && ((opp?.vel.length() ?? 0) > 0.15),
  isMultiplayer,
  multiplayerRole,
  opponentConnected,
  fps,
  showScoreboard: s.showScoreboard,
  isObserverMode: s.isObserverMode,
  observerCamMode: s.observerCamMode,
  observerTargetName,
  observerTargetRole: s.observerTarget,
  playerKills: s.playerKills,
  playerDeaths: s.playerDeaths,
  enemyKills: s.enemyKills,
  enemyDeaths: s.enemyDeaths,
  opponentPlayerName,
  activeMedalPopup: s.activeMedalPopup,
  grifball: buildGrifballHudPayload(s),
});

function resolveBallCarrierName(s: GrifballRuntimeState): string | null {
  const id = s.grifball.ball.holderId;
  if (!id) return null;
  if (id === 'player') return 'You';
  return s.otherPlayers.get(id)?.playerName ?? null;
}

function buildGrifballHudPayload(s: GrifballRuntimeState): GameStats['grifball'] {
  if (s.settings.gameMode !== 'grifball') return undefined;
  const g = s.grifball;
  const carrierId = g.ball.holderId;
  return {
    phase: g.phase,
    blueGoals: getTeamTally(s.teamScores, 'blue').goals,
    redGoals: getTeamTally(s.teamScores, 'red').goals,
    goalTarget: g.goalTarget,
    roundNumber: g.roundNumber,
    countdown:
      g.phase === 'countdown'
        ? Math.max(0, (s.settings.grifballCountdownDuration ?? 3) - g.phaseTimer)
        : 0,
    ballCarrierName: resolveBallCarrierName(s),
    ballCarrierTeam: carrierId
      ? carrierId === 'player'
        ? s.localPlayerTeam
        : s.otherPlayers.get(carrierId)?.team ?? null
      : null,
    winningTeam: g.winningTeam,
    localTeam: s.localPlayerTeam,
    localCarrying: carrierId === 'player',
    passCharge: s.grifballPassCharge,
  };
}

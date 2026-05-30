/**
 * One-shot Phase 4 codemod: replace flat s.aiXxx reads/writes with mai() roster accessors.
 * Run from repo root: node scripts/phase4-migrate-ai-fields.mjs
 */
import fs from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'src/components/GrifballGame.tsx');
let src = fs.readFileSync(file, 'utf8');

const fieldMap = [
  ['s.aiHammerJumpWindowTimer', 'mai()!.hammerJumpWindowTimer'],
  ['s.aiHammerJumpPlanned', 'mai()!.hammerJumpPlanned'],
  ['s.aiHammerJumpType', 'mai()!.hammerJumpType'],
  ['s.aiHammerJumpCooldownTimer', 'mai()!.aiHammerJumpCooldownTimer'],
  ['s.aiSwapCooldownTimer', 'mai()!.swapCooldownTimer'],
  ['s.aiSwapLockoutTimer', 'mai()!.swapLockoutTimer'],
  ['s.lastAISwordAttackTime', 'mai()!.lastSwordAttackTime'],
  ['s.lastAIHammerAttackTime', 'mai()!.lastHammerAttackTime'],
  ['s.aiInvulnerabilityTimer', 'mai()!.invulnerabilityTimer'],
  ['s.aiSpawnTime', 'mai()!.spawnTime'],
  ['s.aiPressureTargetId', 'mai()!.aiPressureTargetId'],
  ['s.aiPostLungeDecisionTimer', 'mai()!.aiPostLungeDecisionTimer'],
  ['s.aiPendingPostEvasionCharge', 'mai()!.aiPendingPostEvasionCharge'],
  ['s.aiLastLungeOutcome', 'mai()!.aiLastLungeOutcome'],
  ['s.aiLastLungeTargetId', 'mai()!.aiLastLungeTargetId'],
  ['s.aiLungeStartPos', 'mai()!.lungeStartPos'],
  ['s.aiLungeTargetDir', 'mai()!.lungeTargetDir'],
  ['s.aiLungeTimer', 'mai()!.lungeTimer'],
  ['s.aiIsLunging', 'mai()!.isLunging'],
  ['s.aiIsJumping', 'mai()!.isJumping'],
  ['s.aiIsSprinting', 'mai()!.aiIsSprinting'],
  ['s.aiSlideDistanceTraveled', 'mai()!.aiSlideDistanceTraveled'],
  ['s.aiSlideCooldownTimer', 'mai()!.aiSlideCooldownTimer'],
  ['s.aiSlideActive', 'mai()!.aiSlideActive'],
  ['s.aiDashDir', 'mai()!.aiDashDir'],
  ['s.aiDashCooldownTimer', 'mai()!.aiDashCooldownTimer'],
  ['s.aiDashRemaining', 'mai()!.aiDashRemaining'],
  ['s.aiSwayTimer', 'mai()!.aiSwayTimer'],
  ['s.aiWeaponTimer', 'mai()!.weaponTimer'],
  ['s.aiWeaponState', 'mai()!.weaponState'],
  ['s.aiActiveWeapon', 'mai()!.activeWeapon'],
  ['s.aiIsCrouching', 'mai()!.isCrouching'],
  ['s.aiPitch', 'mai()!.pitch'],
  ['s.aiYaw', 'mai()!.yaw'],
  ['s.aiVel', 'mai()!.vel'],
  ['s.aiPos', 'mai()!.pos'],
  ['s.aiMaxHP', 'mai()!.maxHp'],
  ['s.aiHP', 'mai()!.hp'],
  ['s.aiTimer', 'mai()!.aiTimer'],
  ['s.aiState', 'mai()!.aiState'],
];

// Longest first to avoid partial replacements
fieldMap.sort((a, b) => b[0].length - a[0].length);

for (const [from, to] of fieldMap) {
  src = src.split(from).join(to);
}

// Multiplayer opponent mirror: opponentDisplay for HUD-style reads in mixed contexts
const opponentFields = [
  ['mai()!.pos', 'opponentDisplay()!.pos', 'pushStatsUpdate|updateFloatingNameplate|getSpectateTargetData'],
];

fs.writeFileSync(file, src);
console.log('Phase 4 field migration applied to GrifballGame.tsx');

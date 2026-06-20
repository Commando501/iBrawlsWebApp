/**
 * Scripted combat baiters used to harden neural policies against passive players.
 *
 * They do not try to win with broad tactics. They hold a ready weapon, face the nearest
 * hostile, and punish direct approaches into melee/lunge range. The jitter variant adds
 * short forward/back movement so the learner cannot key only on perfectly idle targets.
 */

import { type ActionInput, idleAction } from '../actions';
import { analyzeCombatThreat } from '../combatThreat';
import { yawToFace } from '../env/action';
import { type Policy } from './policy';
import { MELEE_HAMMER_SWIPE_REACH, MELEE_SWORD_SLASH_REACH } from '../../components/grifball/combatGeometry';

export type PassiveBaitProfile = 'passive_bait' | 'passive_bait_jitter' | 'passive_bait_duelist';

export function passiveBaitPolicyFor(profile: PassiveBaitProfile): Policy {
  if (profile === 'passive_bait_duelist') return passiveBaitDuelistPolicy;
  return profile === 'passive_bait_jitter' ? passiveBaitJitterPolicy : passiveBaitPolicy;
}

export const passiveBaitPolicy: Policy = (state, agentId) => passiveBaitAction(state, agentId, false);

export const passiveBaitJitterPolicy: Policy = (state, agentId) => passiveBaitAction(state, agentId, true);

export const passiveBaitDuelistPolicy: Policy = (state, agentId) => passiveBaitDuelistAction(state, agentId);

function passiveBaitAction(
  state: Parameters<Policy>[0],
  agentId: string,
  jitter: boolean
): ActionInput {
  const self = state.combatants.find((c) => c.id === agentId);
  if (!self || !self.alive) return idleAction();
  const analysis = analyzeCombatThreat(state, self);
  const a = idleAction();
  if (!analysis.threat || analysis.distance == null) {
    a.aim = self.yaw;
    return a;
  }

  a.aim = yawToFace(analysis.threat.pos.x - self.pos.x, analysis.threat.pos.z - self.pos.z);
  const attackReady = self.attackCooldown <= 0 && self.weaponReadyTimer <= 0 && self.weaponState === 'idle';
  const meleeRange = self.weapon === 'sword'
    ? MELEE_SWORD_SLASH_REACH
    : Math.max(MELEE_HAMMER_SWIPE_REACH, state.settings.attackRange + state.settings.attackRadius * 0.85);
  const lungeRange = self.weapon === 'sword' ? Math.min(18, state.settings.swordLungeDistance ?? 14.5) : 0;
  if (attackReady && analysis.distance <= Math.max(meleeRange, lungeRange)) {
    if (self.weapon === 'sword' && analysis.distance > meleeRange) a.attackSecondary = true;
    else a.attackPrimary = true;
  }

  if (jitter && attackReady) {
    const phase = Math.sin(state.tick / 36 + stableAgentPhase(agentId));
    a.moveZ = Math.abs(phase) > 0.35 ? Math.sign(phase) * 0.25 : 0;
  }
  return a;
}

const DUELIST_SAFE_BUFFER = 1.25;
const DUELIST_STANDOFF_BAND = 2.5;

function passiveBaitDuelistAction(
  state: Parameters<Policy>[0],
  agentId: string
): ActionInput {
  const self = state.combatants.find((c) => c.id === agentId);
  if (!self || !self.alive) return idleAction();
  const analysis = analyzeCombatThreat(state, self);
  const a = idleAction();
  if (!analysis.threat || analysis.distance == null) {
    a.aim = self.yaw;
    return a;
  }

  a.aim = yawToFace(analysis.threat.pos.x - self.pos.x, analysis.threat.pos.z - self.pos.z);
  const distance = analysis.distance;
  const attackReady = self.attackCooldown <= 0 && self.weaponReadyTimer <= 0 && self.weaponState === 'idle';
  const targetVulnerable = !analysis.targetCanAttack ||
    analysis.threat.weaponState !== 'idle' ||
    analysis.threat.attackCooldown > 0 ||
    analysis.threat.weaponReadyTimer > 0 ||
    analysis.threat.isLunging;

  if (
    self.weapon !== 'sword' &&
    self.weaponState === 'idle' &&
    self.weaponReadyTimer <= 0 &&
    self.swapLockoutTimer <= 0 &&
    (!analysis.targetCanAttack || distance > analysis.threatRange + DUELIST_SAFE_BUFFER)
  ) {
    a.swapWeapon = true;
    return a;
  }

  const ownMeleeRange = self.weapon === 'sword'
    ? MELEE_SWORD_SLASH_REACH
    : Math.max(MELEE_HAMMER_SWIPE_REACH, state.settings.attackRange + state.settings.attackRadius * 0.85);
  const ownLungeRange = self.weapon === 'sword' ? Math.min(18, state.settings.swordLungeDistance ?? 14.5) : 0;

  if (targetVulnerable) {
    if (attackReady && distance <= ownMeleeRange) {
      a.attackPrimary = true;
    } else if (attackReady && self.weapon === 'sword' && distance <= ownLungeRange) {
      a.attackSecondary = true;
    } else {
      a.moveZ = 1;
    }
    return a;
  }

  if (analysis.targetCanAttack && analysis.targetFacingSelf) {
    const desiredMin = analysis.threatRange + DUELIST_SAFE_BUFFER;
    const desiredMax = desiredMin + DUELIST_STANDOFF_BAND;
    if (distance < desiredMin) {
      a.moveZ = -1;
      return a;
    }
    if (distance > desiredMax) {
      a.moveZ = 0.65;
      return a;
    }
    const phase = Math.sin(state.tick / 28 + stableAgentPhase(agentId));
    a.moveZ = Math.abs(phase) > 0.25 ? Math.sign(phase) * 0.35 : 0;
    return a;
  }

  return passiveBaitAction(state, agentId, true);
}

function stableAgentPhase(agentId: string): number {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) hash = (hash * 31 + agentId.charCodeAt(i)) | 0;
  return (Math.abs(hash) % 628) / 100;
}

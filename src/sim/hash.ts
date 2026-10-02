/**
 * Deterministic serialization + hashing of a {@link SimState}, used by the determinism
 * tests to assert that (seed + action sequence) reproduces an identical match. Floats
 * are quantized to a fixed grid first so that mathematically-identical runs hash equal
 * without being sensitive to insignificant trailing bits.
 */

import { type SimState, type SimCombatant, combatExecutionForActor } from './simState';

/** Quantize a float to 1e-5 resolution and stringify stably. */
function q(n: number): string {
  return (Math.round(n * 1e5) / 1e5).toString();
}

function combatantKey(c: SimCombatant): string {
  return [
    c.id,
    c.team,
    q(c.pos.x), q(c.pos.y), q(c.pos.z),
    q(c.vel.x), q(c.vel.y), q(c.vel.z),
    q(c.yaw),
    c.hp, c.maxHp, c.alive ? 1 : 0,
    q(c.respawnTimer), q(c.invulnerabilityTimer),
    c.weapon, c.weaponState, q(c.weaponTimer), c.attackKind,
    q(c.swapLockoutTimer), q(c.attackCooldown), q(c.weaponReadyTimer),
    q(c.dashCooldownTimer), q(c.dashRemaining),
    q(c.hammerJumpWindowTimer), c.hammerJumpsInAir, q(c.passChargeTimer),
    c.isLunging ? 1 : 0, q(c.lungeTimer),
    c.isJumping ? 1 : 0, c.isCrouching ? 1 : 0,
    c.hasBall ? 1 : 0,
  ].join(':');
}

/** Stable canonical string for a whole sim state. */
export function serializeState(state: SimState): string {
  const ball = state.match.ball;
  return [
    `t=${state.tick}`,
    `seed=${state.seed}`,
    `rng=${state.rngState}`,
    // Old/neutral and legacy snapshots keep their hashes. Nonzero player view
    // geometry changes future impacts and must survive determinism comparisons.
    ...state.combatants.filter(c => combatExecutionForActor(state, c) === 'live-player-v1' && (c.pitch || c.crouchAmount))
      .map(c => `view=${c.id}:${q(c.pitch ?? 0)}:${q(c.crouchAmount ?? 0)}`),
    // Preserve historical profile hashes; mixed execution also depends on actor
    // roles, commitment headings, phase clocks and weapon-specific trade history.
    ...(state.combatExecution === 'live-mixed-v1' ? [
      `execution=${state.combatExecution}:${state.localPlayerId ?? '-'}:${q(state.combatTimeMs ?? 0)}`,
      ...(state.localPlayerIsObserver ? ['local-observer=true'] : []),
      ...state.combatants.map(c => JSON.stringify([c.id, c.weaponPhaseElapsed, c.modelType,
        c.lungeTargetId, c.lungeDir, c.lungeAimDirection, c.lungeStartPos, c.lungeOutcome,
        c.lastSwordAttackTimeMs, c.lastHammerAttackTimeMs, c.passInputHeld, c.passCharging])),
    ] : []),
    `phase=${state.match.phase}:${q(state.match.phaseTimer)}:${state.match.roundNumber}`,
    `win=${state.match.winningTeam ?? '-'}:${state.match.lastScoringTeam ?? '-'}`,
    `ball=${ball.state}:${ball.holderId ?? '-'}:${q(ball.pos.x)}:${q(ball.pos.y)}:${q(ball.pos.z)}:${q(ball.vel.x)}:${q(ball.vel.y)}:${q(ball.vel.z)}:${q(ball.looseTimer)}`,
    // Team-agnostic: works for grifball (blue/red) and combat (t0..tN). Sorted for stability.
    ...Object.keys(state.scores)
      .sort()
      .map((t) => {
        const tally = state.scores[t];
        return `score.${t}=${tally.goals}/${tally.kills}/${tally.deaths}`;
      }),
    ...state.combatants.map(combatantKey),
  ].join('|');
}

/** 32-bit FNV-1a hash of the canonical state string (hex). */
export function hashState(state: SimState): string {
  const s = serializeState(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

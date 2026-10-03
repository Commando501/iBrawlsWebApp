import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSuiteManifest } from '../../src/game/grifballValidation/profiles';
import { createSuitePlan } from '../../src/game/grifballValidation/plan';
import { createAutonomousValidationRuntime } from './grifballAutonomousRuntime';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { resolveAIComboOrchestrationForCombatant } from '../../src/components/grifball/aiComboOrchestrationRuntime';
import { resolveAIGroundAttackOpportunityForCombatant } from '../../src/components/grifball/aiGroundAttackOpportunityRuntime';
import { setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';

function comboFixture(preserveReadyStrike: boolean) {
  const f = createBotParityFixture('main_ai');
  let swaps = 0, attacks = 0;
  const noop = () => {};
  const target = { id: f.target.id, pos: new THREE.Vector3(2.75, 0, 0), vel: new THREE.Vector3(-7.54, 0, 0),
    hp: 2, maxHp: 2, activeWeapon: 'ball' as const, weaponState: 'ready', isLunging: false, isCrouching: false, playerName: 'Runner' };
  const frame = { pos: f.bot.pos, vel: f.bot.vel, aiState: 'APPROACHING' as const, timer: 0, weaponState: 'ready' as const };
  const applyTacticalWeapon = () => { swaps++; return { activeWeapon: 'sword' as const, canStartWeaponAction: false, weaponState: 'ready' as const }; };
  const options: Parameters<typeof resolveAIComboOrchestrationForCombatant>[0] = { state: f.state, self: f.bot,
    aiContext: f.state.aiMatchContext, botId: f.bot.id, target, frame, activeWeapon: 'hammer', canStartWeaponAction: true,
    tacticalWeapon: 'sword', preserveReadyStrike, swapFeintActive: false, targetProtected: false, targetAirborne: false,
    hasVerticalLungeLine: true, targetIsLunging: false, dt: 1 / 60, difficulty: 'normal', weaponSwapIQ: 0,
    weaponPrioritization: 50, attackDistanceToTarget: 2.75, combatDistanceToTarget: 2.75, distanceToTarget: 2.75,
    minLungeRange: 3, maxLungeRange: 12, resolvedAiReach: 7, stationarySwingReach: 7, swapLockoutRemaining: 0,
    cooldownMultiplier: 1, getTargetPlayerModel: () => null, applyTacticalWeapon, triggerCombatantLunge: noop,
    triggerCombatantAttack: () => { attacks++; }, recordCombatantObservation: noop };
  return { f, target, frame, options, applyTacticalWeapon, counts: () => ({ swaps, attacks }) };
}

for (const mirrored of [false, true]) for (const evasive of [false, true]) test(`goal-side safety strikes before punch range and survives the carrier: ${mirrored}/evasive=${evasive}`, async t => {
  const manifest = createSuiteManifest('quick');
  // Keep a straight-route control alongside the default evasive runner. Avoidance
  // may escape the follow-up, but the first strike and surviving safety are required.
  if (!evasive) Object.assign(manifest.candidate.defaults, { runnerRiskWeight: 0, stylesEnabled: false });
  manifest.cases = [{ id: 'safety-counter', mode: 'match', scenario: null, mapId: 'championship_stadium',
    roster: 'scripted-4v4', difficulty: 'normal', seeds: [102], opponents: ['balanced'], mirrored: true,
    fixedHz: 60, simulationSeconds: 10, watchdogSeconds: 60 }];
  const plan = await createSuitePlan(manifest, { commit: 'a'.repeat(40), dirty: false, workingTreeHash: 'b'.repeat(64), scope: ['src'] });
  const job = plan.jobs.find(j => j.variant === 'candidate' && j.mirrored === mirrored)!;
  const host = createAutonomousValidationRuntime(plan.cases[0], job), s = host.state, sign = mirrored ? -1 : 1;
  const carrier = [...s.otherPlayers.values()].find(p => p.team === job.focalTeam)!;
  const defender = [...s.otherPlayers.values()].find(p => p.team !== job.focalTeam)!;
  for (const p of s.otherPlayers.values()) {
    p.invulnerabilityTimer = p.aiTimer = p.swapCooldownTimer = p.swapLockoutTimer = 0; p.weaponState = 'ready';
    if (p !== carrier && p !== defender) { p.hp = 0; p.respawnTimer = 100; }
  }
  s.grifball.phase = 'playing'; s.grifball.ball.state = 'held'; s.grifball.ball.holderId = carrier.id;
  carrier.pos.set(30 * sign, 0, 0); defender.pos.set(35 * sign, 0, 0);
  carrier.vel.set(0, 0, 0); defender.vel.set(0, 0, 0);
  setGrifballCarrierForState({ state: s, id: carrier.id, carrying: true }); Object.assign(s.grifball.ball.pos, carrier.pos);
  let firstStrike = 0, firstHitDistance = 0, elapsed = 0;
  try {
    for (let tick = 1; tick <= 180; tick++) {
      host.runtime.step(); elapsed = tick;
      if (!firstStrike && defender.weaponState === 'swing_up') firstStrike = tick;
      if (!firstHitDistance && carrier.hp < 2) firstHitDistance = carrier.pos.distanceTo(defender.pos);
      if (defender.hp <= 0 || carrier.hp <= 0 || s.grifball.phase !== 'playing') break;
    }
    assert.ok(firstStrike > 0 && firstStrike <= 3, 'the goal-side safety must take the existing opening');
    assert.ok(firstHitDistance > 3.3, 'first hit lands before the carrier reaches its punch envelope');
    assert.ok(carrier.hp < 2, 'the safety must damage the approaching carrier');
    if (!evasive) assert.equal(carrier.hp, 0, 'the straight-running carrier must be stopped');
    assert.equal(defender.hp, 1, 'early defense avoids the previous fatal return punch');
    t.diagnostic(JSON.stringify({ mirrored, firstStrike, firstHitDistance, elapsed }));
  } finally { host.runtime.dispose(); }
});

test('a ready interception reaches the existing strike owner before a new weapon setup', () => {
  for (const preserve of [false, true]) {
    const x = comboFixture(preserve), combo = resolveAIComboOrchestrationForCombatant(x.options);
    const result = resolveAIGroundAttackOpportunityForCombatant({ ...x.options, state: x.f.state, self: x.f.bot, frame: { ...x.frame, ...combo },
      activeWeapon: combo.activeWeapon, canStartWeaponAction: combo.canStartWeaponAction,
      enemyInKillRange: true, selfGrounded: true, slideActive: false, swordForbidden: false,
      comboActive: combo.comboActive, feintChance: 0, lungeDistanceToTarget: 2.75, aggressiveLungeMult: 1,
      tunedAnticipationFactor: 0, playstyleFactor: .5,
      tuning: { weaponSwapFeintDelay: .2, lungeChanceAirborneBase: 0, lungeChanceAirborneAnticipation: 0,
        lungeChanceGroundBase: 0, lungeChanceGroundAnticipation: 0, lungeFakeoutForwardTimer: .2 },
      constrainCombatantToArena: () => {}, startWeaponSwapFeintTimer: () => {}, commitFeint: () => {}, tryFeintRoll: () => false });
    assert.deepEqual(x.counts(), preserve ? { swaps: 0, attacks: 1 } : { swaps: 1, attacks: 0 });
    assert.equal(result.weaponState, preserve ? 'swing_up' : 'ready');
    assert.equal(result.activeWeapon, preserve ? 'hammer' : 'sword');
    if (preserve) assert.equal(result.timer, x.f.state.settings.hammerReloadTime);
  }
});

for (const mirrored of [false, true]) for (const evasive of [false, true]) test(`supported safety holds its cut as the runner closes: ${mirrored}/evasive=${evasive}`, async t => {
  const manifest = createSuiteManifest('quick');
  if (!evasive) Object.assign(manifest.candidate.defaults, { runnerRiskWeight: 0, stylesEnabled: false });
  manifest.cases = [{ id: 'supported-safety-counter', mode: 'match', scenario: null, mapId: 'championship_stadium',
    roster: 'scripted-4v4', difficulty: 'normal', seeds: [102], opponents: ['balanced'], mirrored: true,
    fixedHz: 60, simulationSeconds: 10, watchdogSeconds: 60 }];
  const plan = await createSuitePlan(manifest, { commit: 'a'.repeat(40), dirty: false, workingTreeHash: 'b'.repeat(64), scope: ['src'] });
  const job = plan.jobs.find(j => j.variant === 'candidate' && j.mirrored === mirrored)!;
  const host = createAutonomousValidationRuntime(plan.cases[0], job), s = host.state, sign = mirrored ? -1 : 1;
  const carrier = [...s.otherPlayers.values()].find(p => p.team === job.focalTeam)!;
  const [defender, support] = [...s.otherPlayers.values()].filter(p => p.team !== job.focalTeam);
  for (const p of s.otherPlayers.values()) {
    p.invulnerabilityTimer = p.aiTimer = p.swapCooldownTimer = p.swapLockoutTimer = 0; p.weaponState = 'ready';
    p.vel.set(0, 0, 0);
    if (p !== carrier && p !== defender && p !== support) { p.hp = 0; p.respawnTimer = 100; }
  }
  s.grifball.phase = 'playing'; s.grifball.ball.state = 'held'; s.grifball.ball.holderId = carrier.id;
  carrier.pos.set(20 * sign, 0, 0); defender.pos.set(35 * sign, 0, 0); support.pos.set(22 * sign, 0, 8 * sign);
  setGrifballCarrierForState({ state: s, id: carrier.id, carrying: true }); Object.assign(s.grifball.ball.pos, carrier.pos);
  let holds = 0, pressure = 0, elapsed = 0, firstHoldX: number | null = null;
  try {
    for (let tick = 1; tick <= 180; tick++) {
      host.runtime.step(); elapsed = tick;
      const orders = s.aiMatchContext.grifballTeamPlan.assignments;
      if (orders.get(defender.id)?.reason.includes('hold the goal-side cut')) {
        holds++;
        firstHoldX ??= defender.pos.x;
        if (orders.get(support.id)?.defense?.mode === 'intercept') pressure++;
      }
      if (defender.hp <= 0 || carrier.hp <= 0 || s.grifball.phase !== 'playing') break;
    }
    assert.ok(holds > 0, 'a supported defender must use the visible cut');
    assert.ok(pressure > 0, 'holding the cut must retain separate pressure');
    assert.ok(carrier.hp < 2, 'the defensive pair damages the approaching runner');
    if (!evasive) assert.equal(carrier.hp, 0, 'the defensive pair stops the straight-running carrier');
    assert.ok(defender.hp > 0, 'the covering defender survives');
    t.diagnostic(JSON.stringify({ mirrored, holds, pressure, elapsed, firstHoldX }));
  } finally { host.runtime.dispose(); }
});

for (const boundary of ['cooldown', 'busy', 'protected', 'dead'] as const)
  test(`interception priority does not create an unavailable strike: ${boundary}`, () => {
    const x = comboFixture(true);
    if (boundary === 'cooldown') x.options.canStartWeaponAction = false;
    if (boundary === 'busy') x.options.frame.weaponState = 'recovering';
    if (boundary === 'protected') x.options.targetProtected = true;
    if (boundary === 'dead') x.options.target.hp = 0;
    resolveAIComboOrchestrationForCombatant(x.options);
    assert.equal(x.counts().attacks, 0);
    assert.equal(x.counts().swaps, 1, 'unavailable strike must not reserve the old weapon');
  });

test('Stadium carrier interception retains committed weapons through impact and earns possession', async t => {
  const manifest = createSuiteManifest('quick');
  manifest.cases = [{ id: 'carrier-interception', mode: 'match', scenario: null, mapId: 'championship_stadium',
    roster: 'scripted-4v4', difficulty: 'normal', seeds: [102], opponents: ['aggressive'], mirrored: false,
    fixedHz: 60, simulationSeconds: 300, watchdogSeconds: 900 }];
  const plan = await createSuitePlan(manifest, { commit: 'a'.repeat(40), dirty: false, workingTreeHash: 'b'.repeat(64), scope: ['src'] });
  const job = plan.jobs.find(j => j.variant === 'candidate')!, host = createAutonomousValidationRuntime(plan.cases[0], job);
  let checked = 0, otherCommitments = 0;
  try {
    for (let tick = 0; tick < job.simulationTicks; tick++) {
      const s = host.state, holder = s.grifball.ball.holderId;
      const before = new Map([...s.otherPlayers.values()].map(p => [p.id, { weapon: p.activeWeapon, phase: p.weaponState, hp: p.hp }]));
      host.runtime.step();
      for (const p of s.otherPlayers.values()) {
        const b = before.get(p.id)!, a = s.aiMatchContext.grifballTeamPlan.assignments.get(p.id);
        if (b.hp > 0 && p.hp > 0 && b.weapon !== 'ball' && p.activeWeapon !== 'ball' &&
          ['swing_up', 'swing_down', 'melee_up', 'melee_down'].includes(b.phase ?? '') &&
          !(holder && a?.defense?.targetId === holder && (a.defense.mode === 'intercept' || a.defense.emergency))) {
          otherCommitments++;
          assert.equal(p.activeWeapon, b.weapon, `${tick + 1}/${p.id}: non-interception strikes also retain their weapon`);
        }
        if (holder && holder === s.grifball.ball.holderId && b.hp > 0 && p.hp > 0 &&
          a?.defense?.targetId === holder && (a.defense.mode === 'intercept' || a.defense.emergency) &&
          ['swing_up', 'swing_down', 'melee_up', 'melee_down'].includes(b.phase ?? '')) {
          checked++;
          assert.equal(p.activeWeapon, b.weapon, `${tick + 1}/${p.id}: do not cancel interception strike with a swap`);
        }
      }
      if (s.grifball.phase === 'matchEnd') break;
    }
    const result = await host.runtime.done;
    assert.equal(result.termination, 'match-end'); assert.equal(result.check.verdict, 'pass');
    assert.ok(checked > 0, 'must exercise committed interceptions');
    assert.ok(otherCommitments > 0, 'must exercise commitments outside carrier interception');
    assert.ok(result.metrics!.red.turnovers > 0, 'defenders must stop a carrier');
    assert.ok(result.metrics!.blue.possessions > 0, 'the earlier 0-possession regression must recover the ball');
    t.diagnostic(JSON.stringify({ ticks: result.end!.tick, checked, otherCommitments, goals: result.behavior!.goals, possessions: result.metrics!.blue.possessions }));
  } finally { host.runtime.dispose(); }
});

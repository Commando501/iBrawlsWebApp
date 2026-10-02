import test from 'node:test';
import assert from 'node:assert/strict';
import { createSuiteManifest } from '../../src/game/grifballValidation/profiles';
import { createSuitePlan } from '../../src/game/grifballValidation/plan';
import type { ValidationCase } from '../../src/game/grifballValidation/types';
import { createComposedValidationMatch, createComposedMatchStepper } from './grifballComposedMatch';
import { createAutonomousValidationRuntime } from './grifballAutonomousRuntime';

// Development integration fixtures, not held-out quality evidence. A separate
// frozen horizon requires an actual two-goal win; pilot caps remain unchanged.
const variants: Pick<ValidationCase, 'mapId' | 'roster' | 'difficulty'>[] = [
  { mapId: 'championship_stadium', roster: 'scripted-4v4', difficulty: 'normal' },
  { mapId: 'forerunner_canyon', roster: 'scripted-4v4', difficulty: 'normal' },
  { mapId: 'forerunner_canyon', roster: 'scripted-4v4', difficulty: 'hard' },
  { mapId: 'forerunner_canyon', roster: 'local-4v4', difficulty: 'normal' },
];
const near = (a: number, b: number, label: string) => assert.ok(Math.abs(a - b) <= 1e-6, `${label}: ${a} != ${b}`);
for (const variant of variants) for (const mirrored of [false, true])
  test(`complete match variant ${variant.mapId}/${variant.roster}/${variant.difficulty}/${mirrored}`, async t => {
    const manifest = createSuiteManifest('standard');
    manifest.cases = [{ ...manifest.cases.find(c => c.mode === 'match')!, ...variant,
      id: `complete-${variant.mapId}-${variant.roster}-${variant.difficulty}`.replaceAll('_', '-'), seeds: [101], mirrored,
      simulationSeconds: 900, watchdogSeconds: 1800 }];
    const plan = await createSuitePlan(manifest, { commit: null, dirty: null, workingTreeHash: null, scope: [] });
    const fixture = plan.cases[0], job = plan.jobs.find(j => j.variant === 'candidate' && j.mirrored === mirrored)!;
    const live = createAutonomousValidationRuntime(fixture, job);
    const { checkpoint } = createComposedValidationMatch(fixture, job);
    const step = createComposedMatchStepper(fixture, job, checkpoint);
    let restored = structuredClone(checkpoint), replay = createComposedMatchStepper(fixture, job, restored), replayTicks = 30;
    let kills = 0, revivals = 0, goals = 0, resets = 0, restoredTicks = 0;
    try {
      while (checkpoint.state.tick < job.simulationTicks && checkpoint.state.match.phase !== 'matchEnd') {
        const dead = new Set(checkpoint.state.combatants.filter(c => !c.alive).map(c => c.id));
        const event = step()!; live.runtime.step();
        kills += event.kills.length; goals += Number(!!event.goal); resets += Number(event.roundReset);
        revivals += checkpoint.state.combatants.filter(c => c.alive && dead.has(c.id)).length;
        if (replayTicks > 0) {
          assert.deepEqual(replay(), event); assert.deepEqual(restored, checkpoint, 'restored full frame');
          replayTicks--; restoredTicks++;
        }
        const state = checkpoint.state, tick = state.tick;
        assert.equal(state.match.phase, live.state.grifball.phase, `phase at ${tick}`);
        assert.equal(state.match.ball.holderId, live.state.grifball.ball.holderId, `holder at ${tick}`);
        for (const actor of live.state.otherPlayers.values()) {
          const sim = state.combatants.find(c => c.id === actor.id)!;
          assert.equal(sim.hp, actor.hp, `${tick}/${actor.id}/HP`);
          assert.equal(sim.weapon, actor.activeWeapon, `${tick}/${actor.id}/weapon`);
          near(checkpoint.memories[actor.id].swayTimer, actor.aiSwayTimer ?? 0, `${tick}/${actor.id}/sway clock including trade deaths`);
          for (const axis of ['x', 'y', 'z'] as const) near(sim.pos[axis], actor.pos[axis], `${tick}/${actor.id}/${axis}`);
        }
        if (variant.roster === 'local-4v4') {
          const player = state.combatants.find(c => c.id === state.localPlayerId)!;
          assert.equal(player.hp, live.state.playerHP, `${tick}/local HP`);
          assert.equal(player.weapon, live.state.activeWeapon, `${tick}/local weapon`);
          for (const axis of ['x', 'y', 'z'] as const) near(player.pos[axis], live.state.playerPos[axis], `${tick}/local/${axis}`);
        }
        if (event.roundReset || tick === 180 || event.kills.length && kills === event.kills.length) {
          restored = structuredClone(checkpoint); replay = createComposedMatchStepper(fixture, job, restored); replayTicks = 30;
        }
      }
      const result = await live.runtime.done;
      t.diagnostic(JSON.stringify({ ...variant, mirrored, ticks: checkpoint.state.tick, termination: result.termination,
        kills, revivals, goals, resets, restoredTicks }));
      assert.equal(result.termination, 'match-end', 'simulation caps do not satisfy complete-match coverage');
      assert.equal(result.check.verdict, 'pass'); assert.equal(checkpoint.state.match.phase, 'matchEnd');
      assert.equal(result.end!.tick, checkpoint.state.tick);
      assert.ok(goals >= 2 && resets >= 1 && kills > 0 && revivals > 0 && restoredTicks >= 90,
        'complete match must exercise goals, combat, respawn, round reset and checkpoint continuation');
    } finally { live.runtime.dispose(); }
  });

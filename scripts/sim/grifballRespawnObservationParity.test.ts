import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { defaultGrifballMap } from '../../src/sim/factory';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { createLiveGrifballTacticalSnapshot } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { tickRespawns } from '../../src/sim/weapons';
import { createGrifballTeamPlanState, updateGrifballTeamPlan } from '../../src/game/aiGrifballTeamPlan';

// Heading trigonometry differs at roundoff scale between camera/model conventions.
const normalized = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, v) => typeof v === 'number'
  ? Number.isFinite(v) ? Math.round(v * 1e9) / 1e9 : { $number: String(v) } : v));

for (const team of ['blue', 'red'] as const) for (const playerState of ['alive', 'dead', 'observer'] as const)
  for (const reverse of [false, true]) for (const layout of ['team', 'fallback', 'elevated'] as const)
    test(`respawn observation matches live revival ${team}/${playerState}/${reverse}/${layout}`, () => {
      const z = team === 'blue' ? -10 : 10;
      const points = [{ x: -10, y: layout === 'elevated' ? 2 : 0, z }, { x: 10, y: layout === 'elevated' ? 5 : 0, z }];
      const map = structuredClone(defaultGrifballMap());
      map.spawnPoints = points;
      map.teamSpawns = layout === 'fallback' ? {} : { blue: points, red: points };
      const f = createBotParityFixture('main_ai', playerState === 'observer', { aiDifficulty: 'normal' }, 'target', map);
      const { state, sim, bot, target } = f, [actor, blocker] = sim.combatants;
      actor.id = bot.id; actor.controller = 'ai'; blocker.id = target.id; blocker.controller = 'ai';
      bot.team = actor.team = team; target.team = blocker.team = team === 'blue' ? 'red' : 'blue';
      sim.spawns.blue = structuredClone(points); sim.spawns.red = structuredClone(points);
      sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'player'; sim.match.phase = 'playing';
      state.grifball = structuredClone(sim.match); state.arenaRadius = map.arenaRadius;
      state.localPlayerTeam = team;
      state.playerHP = playerState === 'dead' ? 0 : 20; state.playerRespawnTimer = playerState === 'dead' ? 10 : 0;
      state.activeWeapon = 'hammer'; state.pWeaponState = 'ready'; state.pWeaponTimer = 0;
      state.swapLockoutTimer = 0; state.playerPickupRequested = undefined;
      for (const [a, b] of [[bot, actor], [target, blocker]] as const) {
        b.pos = { x: a.pos.x, y: a.pos.y, z: a.pos.z }; b.vel = { x: 0, y: 0, z: 0 }; b.yaw = a.yaw - Math.PI;
        b.weaponReadyTimer = b.attackCooldown = b.swapLockoutTimer = 0; a.swapLockoutTimer = 0; a.pickupRequested = undefined;
      }
      bot.hp = actor.hp = 0; actor.alive = false; bot.respawnTimer = actor.respawnTimer = .5;
      const player = { ...structuredClone(blocker), id: 'player', team, controller: 'remote' as const,
        yaw: state.yaw - Math.PI, alive: playerState === 'alive', hp: state.playerHP, respawnTimer: state.playerRespawnTimer };
      if (playerState !== 'observer') sim.combatants.push(player);
      if (reverse) { sim.combatants.reverse(); state.otherPlayers = new Map([...state.otherPlayers].reverse()); }
      const goals = (t: string | undefined) => sim.goalPlates.find(p => p.team !== t)?.position ?? null;
      const scriptedBots = { main_ai: 'normal', target: 'normal' };
      const livePlan = createGrifballTeamPlanState(), simPlan = createGrifballTeamPlanState();
      for (const blockedIndex of [0, 1]) {
        const occupied = points[blockedIndex], playerPoint = points[1 - blockedIndex];
        target.pos.set(occupied.x + (blockedIndex ? -1 : 1), occupied.y, occupied.z);
        blocker.pos = { x: target.pos.x, y: target.pos.y, z: target.pos.z };
        state.playerPos.set(playerPoint.x, playerPoint.y, playerPoint.z); player.pos = { ...playerPoint };
        const before = normalized(sim);
        const runtime = createLiveGrifballTacticalSnapshot(state, goals, map);
        const headless = createSimGrifballTacticalSnapshot(sim, { scriptedBots });
        const expected = points[playerState === 'alive' ? blockedIndex : 1 - blockedIndex];
        for (const snapshot of [runtime, headless]) {
          const prediction = snapshot.respawns!.find(r => r.id === bot.id)!;
          assert.deepEqual(prediction.pos, { x: expected.x, z: expected.z });
          assert.equal(prediction.seconds, .5);
        }
        assert.deepEqual(normalized(sim), before, 'observations must not change revival occupancy');
        assert.deepEqual(normalized(runtime), normalized(headless), 'independent snapshots');
        updateGrifballTeamPlan(livePlan, runtime, .25); updateGrifballTeamPlan(simPlan, headless, .25);
        assert.deepEqual(normalized([...livePlan.assignments]), normalized([...simPlan.assignments]), 'independent team plans');
      }
      const expected = points[playerState === 'alive' ? 1 : 0];
      f.respawns(.5); tickRespawns(sim, sim.settings, .5, [actor]);
      assert.deepEqual(bot.pos.toArray(), [expected.x, expected.y, expected.z]);
      assert.deepEqual(actor.pos, expected);
      assert.ok(bot.hp > 0 && actor.alive);
    });

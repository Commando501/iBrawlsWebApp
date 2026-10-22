import { defaultGrifballTactics as openingTactics } from '../../src/game/grifballTacticsConfig';
import { setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { setSimCarrier } from '../../src/sim/grifball';
import { resolveBehaviorTuning } from '../../src/game/aiBehaviorTuning';
import { resolveAICombatRangeFrame } from '../../src/components/grifball/aiCombatRangeRuntime';
import { resolveAITargetPredictionFrame } from '../../src/components/grifball/aiTargetPredictionRuntime';
import { getTacticalTargetByIdFromState } from '../../src/components/grifball/tacticalTargets';
import {
  createGrifballTeamPlanState,
  updateGrifballTeamPlan,
  selectGrifballAssignmentThreat,
} from '../../src/game/aiGrifballTeamPlan';
import { resolveSimGrifballAssignedCombatInput } from '../../src/sim/grifballAssignedCombatInput';
import type { AIBehaviorState } from '../../src/types';
import { idleAction } from '../../src/sim/actions';
import { resolveSimGrifballGroundAttackInput } from '../../src/sim/grifballGroundAttackInput';
import { canStartAIWeaponAction } from '../../src/game/aiWeaponTiming';
import { resolveAIGroundAttackOpportunityForCombatant } from '../../src/components/grifball/aiGroundAttackOpportunityRuntime';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { createOfflineBotCombatant } from '../../src/game/roster';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';

import { updateGrifballTeamPlanForState } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { updateGrifballObjectiveForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { resolvePrimaryGrifballAIObjectiveMovementForCombatant } from '../../src/components/grifball/grifballAIObjectiveMovement';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { resolveSimGrifballSupportInput } from '../../src/sim/grifballSupportInput';
import { stepSimulation } from '../../src/sim/step';
import { SCRIPTED_OBJECTIVE_INPUT_VERSION, type ScriptedObjectiveInput } from '../../src/sim/scriptedObjectiveInput';
import type { ActionInput } from '../../src/sim/actions';
import type { GrifballPlayerStyle } from '../../src/game/grifballPlayerStyles';

const dt = 1 / 60;
const rounded = (value: unknown) =>
  value === undefined
    ? undefined
    : JSON.parse(
        JSON.stringify(value, (_k, v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e8) / 1e8 : v)),
      );
const near = (a: number, b: number, label: string) => assert.ok(Math.abs(a - b) < 1e-7, `${label}: ${a} != ${b}`);
function trace(
  main: boolean,
  mirror: boolean,
  reverse: boolean,
  style?: GrifballPlayerStyle,
  laneStyle?: GrifballPlayerStyle,
  regroup = false,
  recoveryStyle?: GrifballPlayerStyle,
  handoff?: boolean,
) {
  const id = main && !laneStyle ? 'main_ai' : 'collector',
    screenId = main && laneStyle ? 'main_ai' : 'screen',
    team = mirror ? 'red' : 'blue',
    sign = mirror ? -1 : 1;
  const f = createBotParityFixture(id, true, { aiDifficulty: 'normal' }, screenId);
  const { state, sim, bot, target } = f,
    [self, other] = sim.combatants;
  sim.combatExecution = 'live-roster-v2';
  sim.match.phase = 'playing';
  state.grifball = structuredClone(sim.match);
  state.grifballTactics = defaultGrifballTactics();
  Object.assign(state.grifballTactics.defaults, {
    tipoffEnabled: true,
    stylesEnabled: false,
    tankingEnabled: false,
    passingEnabled: false,
    tipoffRegroupSeconds: regroup ? 0.5 : 0,
    tipoffScreenHandoffEnabled: handoff ?? false,
  });
  state.grifballTactics.teams.red = { tipoffSpacing: 7 };
  if (style) {
    state.grifballTactics.botStyles[id] = style;
    state.grifballTactics.teams[team] = {
      ...state.grifballTactics.teams[team],
      tipoffAgencyStrength: 1,
    };
  }
  if (laneStyle) {
    Object.assign(state.grifballTactics.botStyles, {
      [screenId]: laneStyle,
      other: laneStyle,
      back: laneStyle,
      [id]: laneStyle,
    });
    state.grifballTactics.teams[team] = { ...state.grifballTactics.teams[team], tipoffPositionAgencyStrength: 1 };
  }
  if (recoveryStyle) {
    state.grifballTactics.botStyles[screenId] = recoveryStyle;
    // Keep lane preferences off so only the recovery interval changes movement.
    state.grifballTactics.teams[team] = {
      ...state.grifballTactics.teams[team],
      tipoffPositionAgencyStrength: 0,
      tipoffRecoveryAgencyStrength: 1,
    };
  }

  self.id = id;
  other.id = screenId;
  for (const [c, live, x, z] of [
    [self, bot, -5, 0],
    [other, target, -8, -9],
  ] as const) {
    c.team = live.team = team;
    c.controller = live.controller = 'ai';
    c.pos = { x: x * sign, y: 0, z: z * sign };
    live.pos.set(c.pos.x, 0, c.pos.z);
    c.vel = { x: 0, y: 0, z: 0 };
    live.vel.set(0, 0, 0);
    c.yaw = 0;
    live.yaw = Math.PI;
    c.hp = c.maxHp = live.hp;
    c.weaponReadyTimer = c.invulnerabilityTimer = 0;
    c.weaponState = 'idle';
  }
  for (const [name, x, z, t] of [
    ['back', -18, 0, team],
    ['other', -9, 9, team],
    ['enemy', 40, 0, mirror ? 'blue' : 'red'],
  ] as const) {
    const c = structuredClone(other);
    c.id = name;
    c.team = t;
    c.pos = { x: x * sign, y: 0, z: z * sign };
    sim.combatants.push(c);
    const live = createOfflineBotCombatant({
      id: name,
      playerName: name,
      team: t,
      spawnPos: bot.pos.clone().set(c.pos.x, 0, c.pos.z),
      yaw: Math.PI,
      hue: 0,
      difficulty: 'normal',
      settings: state.settings,
    });
    live.invulnerabilityTimer = 0;
    live.weaponState = 'ready';
    live.weaponTimer = 0;
    state.otherPlayers.set(name, live);
  }
  state.grifball.ball.state = sim.match.ball.state = 'idle';
  if (reverse) {
    sim.combatants.reverse();
    state.otherPlayers = new Map([...state.otherPlayers].reverse());
  }
  const tactics = structuredClone(state.grifballTactics),
    plan = createGrifballTeamPlanState();
  const scriptedBots = Object.fromEntries(sim.combatants.map((c) => [c.id, 'normal']));
  // A real opponent at the edge of a 0.30 s pickup window distinguishes an
  // Enforcer claim from more cautious styles. Each engine observes that actor.
  if (style) {
    const snap = createSimGrifballTacticalSnapshot(sim, {
      scriptedBots,
      tactics,
    });
    const o = snap.players.find((p) => p.id === 'enemy')!.space!;
    const speed = snap.players.find((p) => p.id === id)!.space!.speed;
    const x = sign * (o.reach + o.speed * (5 / speed + 0.3 - o.attackIn));
    sim.combatants.find((c) => c.id === 'enemy')!.pos.x = x;
    state.otherPlayers.get('enemy')!.pos.x = x;
  }
  const goal = (t: string | undefined) => sim.goalPlates.find((p) => p.team !== t)!.position;
  const frames: unknown[] = [];
  const lanePositions: { x: number; y: number; z: number }[] = [];
  const screenPositions: { x: number; y: number; z: number }[] = [];
  let regroupFrames = 0,
    resumedFrames = 0;
  let personalRecoveryFrames = 0;
  let handoffFrames = 0;
  let receipt = 0,
    applied = 0,
    moved = 0,
    waited = 0,
    positioned = 0,
    screenPositioned = 0;
  // Opponents remain stationary. Both engines independently plan and execute
  // every friendly ground order through actual pickup and the next possession.
  for (let tick = 1; tick <= 180; tick++) {
    if (handoff !== undefined && tick >= 5 && tick <= 20) {
      // Controlled visible recovery in both hosts. The resulting role, real
      // steering and pickup are independently executed below.
      other.weaponState = tick < 20 ? 'recovering' : 'idle';
      other.weaponTimer = tick < 20 ? sim.settings.hammerReloadTime : 0;
      target.weaponState = tick < 20 ? 'recovering' : 'ready';
      target.weaponTimer = 0;
    }
    if (regroup && tick === 5) {
      // Controlled casualty; each real snapshot adapter must omit the actor and
      // independently trigger recovery. This is not a claim about kill rates.
      const lost = sim.combatants.find((c) => c.id === 'other')!;
      const liveLost = state.otherPlayers.get('other')!;
      lost.alive = false;
      lost.hp = liveLost.hp = 0;
      lost.respawnTimer = liveLost.respawnTimer = 20;
    }
    if (style && tick === 25) {
      sim.combatants.find((c) => c.id === 'enemy')!.pos.x = 40 * sign;
      state.otherPlayers.get('enemy')!.pos.x = 40 * sign;
    }
    updateGrifballTeamPlanForState(state, dt, goal, f.map);
    updateGrifballTeamPlan(plan, createSimGrifballTacticalSnapshot(sim, { scriptedBots, tactics }), dt);
    const orders = [...plan.assignments.values()].filter((a) => a.team === team);
    if (handoff && tick >= 5) {
      assert.equal(plan.assignments.get('other')!.tipoff!.job, 'screen');
      assert.equal(plan.assignments.get(screenId)!.tipoff!.job, 'support');
      handoffFrames++;
    }
    if (laneStyle) {
      assert.ok(!plan.assignments.get(id)!.tipoff!.positioning);
      assert.ok(!plan.assignments.get('back')!.tipoff!.positioning);
      positioned += orders.filter((a) => a.tipoff!.positioning?.applied).length;
      if (plan.assignments.get(screenId)!.tipoff!.positioning?.applied) screenPositioned++;
    }
    const claiming = plan.assignments.get(id)!.role === 'retriever';
    const recovering = orders.every((a) => a.tipoff!.phase === 'regroup');
    const personal = plan.assignments.get(screenId)!.tipoff!.recoveryAgency;
    if (personal?.holding && !plan.assignments.get(screenId)!.tipoff!.recovery) {
      personalRecoveryFrames++;
      assert.equal(plan.assignments.get(screenId)!.tipoff!.job, 'support');
      assert.equal(plan.assignments.get(screenId)!.tipoff!.attack, false);
    }
    if (recovering) regroupFrames++;
    if (regroupFrames && !recovering) resumedFrames++;
    if (regroup && tick >= 5 && tick < 35) {
      assert.ok(recovering);
      assert.deepEqual(plan.tipoff!.recovery![team].affectedIds, ['other']);
      assert.ok(orders.every((a) => a.tipoff!.job !== 'screen'));
    }
    if (regroup && tick === 35) assert.equal(recovering, false);
    assert.deepEqual(
      orders.filter((a) => a.role === 'retriever').map((a) => a.botId),
      claiming ? [id] : [],
    );
    assert.deepEqual(
      orders.filter((a) => a.role === 'safety').map((a) => a.botId),
      ['back'],
    );
    const collector = plan.assignments.get(id)!;
    assert.equal(collector.tipoff!.job, 'collector');
    if (!style) assert.equal(collector.tipoff!.phase, recovering ? 'regroup' : 'claim');
    if (style && tick === 1) {
      assert.equal(claiming, style === 'enforcer');
      assert.equal(collector.tipoff!.agency!.style, style);
    }
    if (!claiming) waited++;
    assert.equal(collector.tipoff!.reserveId, 'back');
    assert.ok(orders.every((a) => !a.tipoff!.attack));
    applied++;
    const actions: Record<string, ActionInput> = {},
      objective: ScriptedObjectiveInput = {
        version: SCRIPTED_OBJECTIVE_INPUT_VERSION,
        scriptedBots,
        movement: {},
      };
    const friendly = sim.combatants.filter((c) => c.team === team && c.alive && c.hp > 0);
    for (const c of friendly) {
      const a = plan.assignments.get(c.id)!,
        b = state.aiMatchContext.grifballTeamPlan.assignments.get(c.id)!;
      assert.deepEqual(rounded(a.tipoff), rounded(b.tipoff), `${tick}/${c.id}/defense`);
      assert.deepEqual(rounded(a.destination), rounded(b.destination), `${tick}/${c.id}/destination`);
      const input = resolveSimGrifballSupportInput(sim, plan, c.id, scriptedBots, dt);
      assert.ok(input, `${c.id} must execute ground steering`);
      assert.equal(
        input.action.pickup,
        c.id === id && claiming,
        'only a collector with an earned window can request pickup',
      );
      actions[c.id] = input.action;
      Object.assign(objective.movement, input.scriptedObjective.movement);
    }
    for (const c of friendly) {
      const live = state.otherPlayers.get(c.id)!;
      const frame = {
        pos: live.pos,
        vel: live.vel,
        yaw: live.yaw,
        aiState: live.aiState,
        timer: live.aiTimer ?? 0,
        dashRemaining: 0,
        slideActive: false,
        weaponState: live.weaponState ?? 'ready',
        pickupRequested: false,
      };
      assert.ok(
        resolvePrimaryGrifballAIObjectiveMovementForCombatant({
          state,
          botId: c.id,
          self: live,
          frame,
          alliesList: [...state.otherPlayers.values()]
            .filter((p) => p.team === team && p.id !== c.id)
            .map((p) => p.pos),
          enemiesList: [...state.otherPlayers.values()].filter((p) => p.team !== team).map((p) => p.pos),
          dt,
          canStartWeaponAction: true,
          triggerCombatantAttack: () => assert.fail('ground support must not start an attack'),
          getEnemyGoalPos: goal,
          constrainCombatantToArena: (pos, vel) =>
            constrainCombatantToArenaBounds({
              pos,
              vel,
              activeCustomMap: f.map,
              arenaRadius: state.arenaRadius,
            }),
        }),
      );
      live.yaw = frame.yaw;
      live.aiState = frame.aiState;
      live.aiTimer = frame.timer;
      live.pickupRequested = frame.pickupRequested;
    }
    updateGrifballObjectiveForState({
      state,
      refs: f.refs,
      ballMeshRef: { current: null },
      ballChargingRef: { current: false },
      ballChargeTimerRef: { current: 0 },
      dt,
      isMultiplayer: false,
      activeCustomMap: f.map,
      placeCombatantsAtGrifballSpawns: () => assert.fail('unexpected round reset'),
      pushStatsUpdate: () => {},
    });
    stepSimulation(sim, actions, {
      settings: sim.settings,
      scriptedObjective: objective,
    });
    for (const c of friendly) {
      const live = state.otherPlayers.get(c.id)!;
      for (const axis of ['x', 'y', 'z'] as const) {
        near(c.pos[axis], live.pos[axis], `${tick}/${c.id}/pos/${axis}`);
        near(c.vel[axis], live.vel[axis], `${tick}/${c.id}/vel/${axis}`);
      }
    }
    assert.equal(sim.match.ball.state, state.grifball.ball.state);
    assert.equal(sim.match.ball.holderId, state.grifball.ball.holderId);
    lanePositions.push({ ...sim.combatants.find((c) => c.id === 'other')!.pos });
    screenPositions.push({ ...other.pos });
    if (Math.hypot(self.vel.x, self.vel.z) > 0.01) moved++;
    frames.push({
      tick,
      holder: sim.match.ball.holderId,
      positions: friendly.map((c) => ({ id: c.id, pos: rounded(c.pos) })),
    });
    if (sim.match.ball.holderId) {
      receipt = tick;
      break;
    }
  }
  assert.ok(receipt > 0, 'the team retriever must actually collect the ball');
  assert.equal(sim.match.ball.holderId, id);
  assert.ok(moved > 0, 'the supporting bot must actually move');
  assert.ok(applied > 0);
  updateGrifballTeamPlanForState(state, dt, goal, f.map);
  updateGrifballTeamPlan(plan, createSimGrifballTacticalSnapshot(sim, { scriptedBots, tactics }), dt);
  assert.ok([...plan.assignments.values()].every((a) => !a.tipoff));
  assert.ok([...state.aiMatchContext.grifballTeamPlan.assignments.values()].every((a) => !a.tipoff));
  return {
    receipt,
    holder: sim.match.ball.holderId,
    frames,
    waited,
    positioned,
    screenPositioned,
    lanePositions,
    screenPositions,
    regroupFrames,
    resumedFrames,
    personalRecoveryFrames,
    handoffFrames,
  };
}

for (const main of [false, true])
  for (const mirror of [false, true])
    test(`live/sim screen handoff executes new support lanes through pickup ${main}/${mirror}`, () => {
      const baseline = trace(main, mirror, false, undefined, 'balanced', false, undefined, false);
      const handoff = trace(main, mirror, true, undefined, 'balanced', false, undefined, true);
      assert.ok(handoff.handoffFrames > 0);
      assert.notDeepEqual(handoff.screenPositions[10], baseline.screenPositions[10]);
      assert.notDeepEqual(handoff.lanePositions[10], baseline.lanePositions[10]);
      assert.equal(handoff.holder, baseline.holder);
      assert.equal(handoff.receipt, baseline.receipt, 'handoff cannot delay a safe pickup');
    });

for (const main of [false, true])
  for (const mirror of [false, true])
    test(`live/sim personal regroup changes real movement without delaying a safe pickup ${main}/${mirror}`, () => {
      const fast = trace(main, mirror, false, undefined, 'balanced', true, 'enforcer');
      assert.equal(fast.personalRecoveryFrames, 0);
      for (const style of ['opportunist', 'guardian'] as const) {
        const cautious = trace(main, mirror, true, undefined, 'balanced', true, style);
        assert.ok(cautious.personalRecoveryFrames > 0);
        assert.notDeepEqual(cautious.screenPositions[36], fast.screenPositions[36]);
        assert.equal(cautious.receipt, fast.receipt);
        assert.equal(cautious.holder, fast.holder);
      }
    });

for (const main of [false, true])
  for (const mirror of [false, true])
    test(`live/sim regroup after a casualty changes movement, resumes and preserves safe pickup ${main}/${mirror}`, () => {
      const baseline = trace(main, mirror, false, undefined, 'balanced');
      const recovery = trace(main, mirror, true, undefined, 'balanced', true);
      assert.ok(recovery.regroupFrames > 0);
      assert.ok(recovery.resumedFrames > 0);
      assert.notDeepEqual(recovery.screenPositions[10], baseline.screenPositions[10]);
      assert.equal(recovery.holder, baseline.holder);
      assert.equal(recovery.receipt, baseline.receipt, 'a clear pickup must not wait for recovery');
    });

for (const main of [false, true])
  for (const mirror of [false, true])
    for (const reverse of [false, true])
      test(`live/sim tip-off movement, pickup and possession handoff ${main}/${mirror}/${reverse}`, () => {
        trace(main, mirror, reverse);
      });

for (const main of [false, true])
  for (const mirror of [false, true])
    test(`live/sim personal tip-off actual wait, movement and pickup ${main}/${mirror}`, () => {
      const fast = trace(main, mirror, mirror, 'enforcer');
      for (const style of ['opportunist', 'guardian'] as const) {
        const cautious = trace(main, mirror, !mirror, style);
        assert.ok(cautious.waited > 0);
        assert.ok(cautious.receipt > fast.receipt, 'personal caution must change actual collection time');
      }
      assert.equal(fast.waited, 0);
    });

for (const main of [false, true])
  for (const mirror of [false, true])
    test(`live/sim personal opening lanes move through first possession ${main}/${mirror}`, () => {
      const baseline = trace(main, mirror, false, undefined, 'balanced');
      assert.equal(baseline.positioned, 0);
      for (const style of ['enforcer', 'opportunist', 'guardian'] as const) {
        const personal = trace(main, mirror, true, undefined, style);
        assert.ok(personal.positioned > 0, `${style} needs accepted lane decisions`);
        assert.ok(personal.screenPositioned > 0, `${style} must move the ${main ? 'main_ai' : 'ordinary'} screen`);
        assert.notDeepEqual(
          personal.lanePositions[10],
          baseline.lanePositions[10],
          `${style} must change executed movement`,
        );
        assert.equal(personal.holder, baseline.holder);
      }
    });

const unexpected = () => {
  throw new Error('Stationary commitment must not invoke another attack branch');
};

for (const [assigned, regroupCombat] of [
  [true, false],
  [true, true],
] as const)
  for (const id of ['main_ai', 'bot_2'])
    for (const weapon of ['hammer'] as const)
      for (const multiplier of [1])
        test(`${assigned ? 'assigned' : 'authored'}/${id}/${weapon}/${multiplier}/regroup=${regroupCombat}: tip-off combat permission, commitment, impact and recovery`, () => {
          const f = createBotParityFixture(id, true);
          const { sim, bot, target } = f,
            [self, rival] = sim.combatants;
          sim.combatExecution = 'live-roster-v2';
          sim.match.phase = 'playing';
          self.id = id;
          self.controller = 'ai';
          rival.id = target.id;
          self.pos = { x: 0, y: 0, z: 0 };
          rival.pos = { x: 0, y: 0, z: 2 };
          self.weapon = bot.activeWeapon = weapon;
          self.yaw = 0;
          self.invulnerabilityTimer = rival.invulnerabilityTimer = rival.weaponReadyTimer = 0;
          self.weaponReadyTimer = bot.swapCooldownTimer = 3 * dt;
          rival.hp = rival.maxHp = target.hp;
          const plan = createGrifballTeamPlanState();
          const owners = {
            [id]: 'normal',
            collector: 'normal',
            reserve: 'normal',
            support: 'normal',
            [target.id]: 'normal',
          };
          const tuning = {
            effectiveReactionLatency: 0.1,
            tunedAnticipationFactor: 0.5,
            movementComplexity: 80,
            playstyleFactor: 0.5,
          };
          const behavior = resolveBehaviorTuning(sim.settings);
          const goal = (team: string | undefined) => sim.goalPlates.find((p) => p.team !== team)?.position ?? null;
          if (assigned) {
            // The selected threat is off the initial facing axis; a missing aim
            // translation must miss these real impacts rather than pass by accident.
            rival.pos = { x: 2, y: 0, z: 0 };
            target.pos.set(2, 0, 0);
            for (const [name, x, z] of [
              ['collector', -3, 7],
              ['reserve', -15, 7],
              ['support', -10, 14],
            ] as const) {
              const live = {
                ...bot,
                id: name,
                pos: bot.pos.clone().set(x, 0, z),
                vel: bot.vel.clone().set(0, 0, 0),
              };
              f.state.otherPlayers.set(name, live);
              sim.combatants.push({
                ...structuredClone(self),
                id: name,
                pos: { x, y: 0, z },
                weaponReadyTimer: 0,
              });
            }
            f.state.grifball = structuredClone(sim.match);
            f.state.arenaRadius = sim.map.arenaRadius;
            for (const ball of [sim.match.ball, f.state.grifball.ball]) {
              ball.pos = { x: 0, y: 0.35, z: 7 };
              ball.home = { x: 0, y: 0.35, z: 7 };
              ball.state = 'idle';
            }
            f.state.grifballTactics = openingTactics();
            f.state.grifballTactics.defaults.tipoffEnabled = true;
            f.state.grifballTactics.defaults.tipoffScreenHandoffEnabled = true;
            f.state.grifballTactics.defaults.tipoffRegroupSeconds = regroupCombat ? 0.25 : 0;
            f.state.grifballTactics.defaults.tipoffRecoveryAgencyStrength = regroupCombat ? 1 : 0;
            f.state.grifballTactics.defaults.tipoffAgencyStrength = 1;
            f.state.grifballTactics.defaults.tipoffPositionAgencyStrength = 1;
            f.state.grifballTactics.botStyles[id] = 'guardian';
            f.state.grifballTactics.defaults.stylesEnabled = false;
          }
          let liveMemory: { aiState: AIBehaviorState; timer: number } = {
            aiState: 'COOLDOWN',
            timer: dt / 2,
          };
          let simMemory = { ...liveMemory };
          let liveCommit = 0,
            simCommit = 0,
            liveHit = 0,
            simHit = 0;
          let liveAttacks = 0,
            simAttacks = 0;
          let regroupFrames = 0;
          let personalDefenseFrames = 0;
          let continuation: typeof sim | undefined;
          let continuationPlan: typeof plan | undefined;
          let continuationMemory: typeof simMemory | undefined;
          for (let tick = 1; tick <= 180; tick++) {
            if (regroupCombat && tick === 2) {
              const lost = sim.combatants.find((c) => c.id === 'support')!;
              const liveLost = f.state.otherPlayers.get('support')!;
              lost.alive = false;
              lost.hp = liveLost.hp = 0;
              lost.respawnTimer = liveLost.respawnTimer = 20;
            }
            // Each host owns its plan, observations, readiness and AI memory. Only
            // the original cases author range; assigned cases use current target data.
            let liveTargetId: string | null = null;
            let livePrediction: ReturnType<typeof resolveAITargetPredictionFrame> | undefined;
            let liveRange: ReturnType<typeof resolveAICombatRangeFrame> | undefined;
            f.frame(false, false, () => {
              // The main actor's swap clock belongs to weaponFrame; ordinary roster
              // readiness belongs to its AI prelude. Never advance either twice.
              if (id !== 'main_ai') bot.swapCooldownTimer = Math.max(0, bot.swapCooldownTimer! - dt);
              if (assigned) {
                updateGrifballTeamPlanForState(f.state, dt, goal, f.map);
                const livePlan = f.state.aiMatchContext.grifballTeamPlan;
                const assignment = livePlan.assignments.get(id)!;
                assert.ok(assignment.tipoff, 'the opening must own this combat decision');
                if (assignment.tipoff.recovery) {
                  regroupFrames++;
                  assert.equal(assignment.tipoff.attack, false);
                }
                if (assignment.tipoff.recoveryAgency?.holding && !assignment.tipoff.recovery) {
                  personalDefenseFrames++;
                  assert.equal(assignment.tipoff.attack, false);
                }
                assert.equal(
                  [...livePlan.assignments.values()].filter((a) => a.team === bot.team && a.tipoff?.job === 'reserve')
                    .length,
                  1,
                );
                liveTargetId = selectGrifballAssignmentThreat(assignment, bot.pos, livePlan.snapshot!.players);
                assert.equal(liveTargetId, target.id);
                const observed = getTacticalTargetByIdFromState(f.state, id, liveTargetId!, [
                  ...f.state.otherPlayers.values(),
                ])!;
                livePrediction = resolveAITargetPredictionFrame({
                  ...tuning,
                  botPos: bot.pos,
                  target: observed,
                  predictionAnticipationBonus: behavior.predictionAnticipationBonus,
                  predictionLandingWeight: behavior.predictionLandingWeight,
                  aimAtCurrentTarget: ['swing_up', 'swing_down', 'melee_up', 'melee_down'].includes(bot.weaponState!),
                  activeCustomMap: f.map,
                  arenaRadius: f.state.arenaRadius,
                });
                bot.yaw = livePrediction.yaw;
                liveRange = resolveAICombatRangeFrame({
                  botPos: bot.pos,
                  botVel: bot.vel,
                  botIsCrouching: !!bot.isCrouching,
                  botIsJumping: !!bot.isJumping,
                  targetIsCrouching: observed.isCrouching,
                  targetHp: observed.hp,
                  targetProtected: (observed.invulnerabilityTimer ?? 0) > 0,
                  predictedTargetPos: livePrediction.predictedTargetPos,
                  distanceToTarget: livePrediction.distanceToTarget,
                  activeWeapon: weapon,
                  attackRange: f.state.settings.attackRange,
                  attackRadius: f.state.settings.attackRadius,
                  resolvedAiReach:
                    (f.state.settings.attackRange + f.state.settings.attackRadius * 0.75) *
                    (0.8 + 0.4 * tuning.playstyleFactor),
                });
              }
              const frame = {
                pos: bot.pos,
                vel: bot.vel,
                ...liveMemory,
                weaponState: bot.weaponState!,
              };
              const result = resolveAIGroundAttackOpportunityForCombatant({
                state: f.state,
                self: bot,
                frame,
                botId: id,
                target: {
                  ...target,
                  weaponState: target.weaponState ?? 'ready',
                  isLunging: !!target.isLunging,
                  isCrouching: !!target.isCrouching,
                },
                targetAirborne: false,
                targetProtected: false,
                activeWeapon: weapon,
                canStartWeaponAction: canStartAIWeaponAction({
                  ...liveMemory,
                  swapCooldownTimer: bot.swapCooldownTimer,
                }),
                enemyInKillRange: assigned ? liveRange!.enemyInKillRange : !liveCommit,
                selfGrounded: assigned ? liveRange!.selfGrounded : true,
                slideActive: false,
                cooldownMultiplier: multiplier,
                swordForbidden: true,
                swapLockoutRemaining: 0,
                swapFeintActive: false,
                comboActive: false,
                feintChance: 0,
                lungeDistanceToTarget: 2,
                hasVerticalLungeLine: false,
                minLungeRange: 10,
                maxLungeRange: 15,
                combatDistanceToTarget: 2,
                distanceToTarget: 2,
                resolvedAiReach: 3,
                aggressiveLungeMult: 1,
                tunedAnticipationFactor: 0,
                playstyleFactor: 0.5,
                tuning: {
                  weaponSwapFeintDelay: 0,
                  lungeChanceAirborneBase: 0,
                  lungeChanceAirborneAnticipation: 0,
                  lungeChanceGroundBase: 0,
                  lungeChanceGroundAnticipation: 0,
                  lungeFakeoutForwardTimer: 0,
                },
                constrainCombatantToArena: () => {},
                triggerCombatantAttack: () => f.attack(),
                applyTacticalWeapon: unexpected,
                startWeaponSwapFeintTimer: unexpected,
                commitFeint: unexpected,
                tryFeintRoll: unexpected,
                getTargetPlayerModel: unexpected,
                triggerCombatantLunge: unexpected,
                recordCombatantObservation: unexpected,
              });
              if (result.mode === 'sync_return') {
                liveCommit ||= tick;
                liveAttacks++;
                liveMemory = { aiState: result.aiState!, timer: result.timer! };
                assert.deepEqual([frame.vel.x, frame.vel.z], [0, 0]);
              } else liveMemory.timer = Math.max(0, liveMemory.timer - dt);
            });
            if (assigned)
              updateGrifballTeamPlan(
                plan,
                createSimGrifballTacticalSnapshot(sim, {
                  scriptedBots: owners,
                  tactics: f.state.grifballTactics,
                }),
                dt,
              );
            const decision = assigned
              ? resolveSimGrifballAssignedCombatInput(sim, plan, id, owners, tuning, {
                  ...simMemory,
                  cooldownMultiplier: multiplier,
                })
              : null;
            if (assigned) {
              assert.equal(decision?.targetId, liveTargetId);
              assert.deepEqual(decision!.range, liveRange);
              assert.equal(decision!.prediction.aim, livePrediction!.yaw - Math.PI);
            }
            const input = assigned
              ? decision!.input
              : resolveSimGrifballGroundAttackInput(sim, id, owners, {
                  ...simMemory,
                  enemyInKillRange: !simCommit,
                  cooldownMultiplier: multiplier,
                });
            const actions = {
              [id]: input?.action ?? {
                ...idleAction(),
                aim: decision?.prediction.aim ?? self.yaw,
              },
            };
            const options = input ? { scriptedObjective: input.scriptedObjective } : {};
            if (input) {
              simCommit ||= tick;
              simAttacks++;
              simMemory = { aiState: input.aiState, timer: input.timer };
            } else simMemory.timer = Math.max(0, simMemory.timer - dt);
            stepSimulation(sim, actions, options);
            if (continuation) {
              if (assigned) {
                updateGrifballTeamPlan(
                  continuationPlan!,
                  createSimGrifballTacticalSnapshot(continuation, {
                    scriptedBots: owners,
                    tactics: f.state.grifballTactics,
                  }),
                  dt,
                );
                const restored = resolveSimGrifballAssignedCombatInput(
                  continuation,
                  continuationPlan!,
                  id,
                  owners,
                  tuning,
                  {
                    ...continuationMemory!,
                    cooldownMultiplier: multiplier,
                  },
                );
                assert.deepEqual(restored, decision, `restored decision at ${tick}`);
                const command = restored!.input;
                if (command)
                  continuationMemory = {
                    aiState: command.aiState,
                    timer: command.timer,
                  };
                else continuationMemory!.timer = Math.max(0, continuationMemory!.timer - dt);
                stepSimulation(
                  continuation,
                  {
                    [id]: command?.action ?? {
                      ...idleAction(),
                      aim: restored!.prediction.aim,
                    },
                  },
                  command ? { scriptedObjective: command.scriptedObjective } : {},
                );
                assert.deepEqual(continuationMemory, simMemory);
                // JSON persistence canonicalizes signed zero and omits undefined.
                // Compare the complete persisted plan, including Map entries, while
                // actual decisions, AI memory and engine state stay strict below.
                const persisted = (p: typeof plan) => JSON.stringify({ ...p, assignments: [...p.assignments] });
                assert.equal(persisted(continuationPlan!), persisted(plan));
              } else stepSimulation(continuation, actions, options);
              assert.deepEqual(continuation, sim);
            }
            if (tick === 4) {
              continuation = JSON.parse(JSON.stringify(sim));
              const restoredPlan = JSON.parse(JSON.stringify({ ...plan, assignments: [...plan.assignments] }));
              continuationPlan = {
                ...restoredPlan,
                assignments: new Map(restoredPlan.assignments),
              };
              continuationMemory = JSON.parse(JSON.stringify(simMemory));
            }
            if (!liveHit && target.hp < 20) liveHit = tick;
            if (!simHit && rival.hp < 20) simHit = tick;
            assert.deepEqual(simMemory, liveMemory, `AI memory at ${tick}`);
            const phase =
              bot.weaponState === 'ready'
                ? 'idle'
                : bot.weaponState === 'swing_up'
                  ? 'windup'
                  : bot.weaponState === 'swing_down'
                    ? 'active'
                    : 'recovering';
            assert.equal(self.weaponState, phase, `weapon phase at ${tick}`);
            assert.ok(
              Math.abs((self.weaponPhaseElapsed ?? 0) - (bot.weaponTimer ?? 0)) < 1e-6,
              `phase clock at ${tick}`,
            );
            assert.equal(rival.hp, target.hp, `target health at ${tick}`);
            assert.deepEqual(self.pos, {
              x: bot.pos.x,
              y: bot.pos.y,
              z: bot.pos.z,
            });
          }
          // Repeated subtraction leaves a positive floating-point remainder on tick 3.
          assert.equal(liveCommit, 4);
          assert.equal(simCommit, 4);
          assert.ok(liveHit > liveCommit);
          assert.equal(simHit, liveHit);
          assert.equal(simAttacks, liveAttacks);
          if (regroupCombat)
            assert.ok(regroupFrames > 0, 'real immediate-defense impacts must occur during regrouping');
          if (regroupCombat)
            assert.ok(personalDefenseFrames > 0, 'immediate defense must survive the personal recovery interval');
          if (assigned) {
            assert.ok(liveAttacks >= 2);
            assert.ok(target.hp <= 18);
          } else {
            assert.equal(target.hp, 19);
            assert.equal(rival.hp, 19);
            assert.equal(self.weaponState, 'idle');
          }
        });

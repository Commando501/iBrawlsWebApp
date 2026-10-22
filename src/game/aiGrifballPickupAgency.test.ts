import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { buildGrifballSpaceGeometry } from './grifballSpaceGeometry';
import { defaultGrifballTactics, resolveTeamTactics, validateGrifballTactics } from './grifballTacticsConfig';
import { createInitialBall } from './grifballBall';
import { GRIFBALL_PLAYER_STYLES, type GrifballPlayerStyle } from './grifballPlayerStyles';
import {
  createGrifballTeamPlanState,
  updateGrifballTeamPlan,
  type GrifballTacticalPlayer,
  type GrifballTacticalSnapshot,
} from './aiGrifballTeamPlan';

const actor = (id: string, x: number, z = 0, team = 'blue'): GrifballTacticalPlayer => ({
  id,
  team,
  pos: { x, z },
  vel: { x: 0, z: 0 },
  scripted: true,
  space: {
    weapon: 'hammer',
    phase: 'ready',
    speed: 5,
    reach: 3,
    blastRadius: 2,
    attackIn: 0.3,
    lungeReach: 0,
    lungeSpeed: 0,
    mobileIn: 0,
  },
});
const geometry = (objects: Partial<CustomMapData['objects'][number]>[] = []) =>
  buildGrifballSpaceGeometry(
    { mapShape: 'rectangular', arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 }, objects } as CustomMapData,
    52,
  );
function fixture(style: GrifballPlayerStyle = 'enforcer') {
  const config = defaultGrifballTactics();
  Object.assign(config.defaults, { pickupAgencyStrength: 1, stylesEnabled: false, tankingEnabled: false, passingEnabled: false });
  config.botStyles.b = style;
  const a = actor('a', -5),
    b = actor('b', -5.5),
    enemy = actor('enemy', 20, 0, 'red');
  const snapshot: GrifballTacticalSnapshot = {
    round: 1,
    playing: true,
    ball: { x: 0, z: 0 },
    ballPhysics: createInitialBall({ x: 0, y: 0.35, z: 0 }),
    holderId: null,
    spacing: 4,
    tactics: config,
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } },
    geometry: geometry(),
    players: [a, b, actor('back', -15), enemy],
  };
  const state = createGrifballTeamPlanState();
  const run = (dt = 0.2) => {
    updateGrifballTeamPlan(state, structuredClone(snapshot), dt);
    return [...state.assignments.values()].filter((a) => a.team === aTeam());
  };
  const aTeam = () => a.team;
  const retriever = () => [...state.assignments.values()].find((o) => o.team === a.team && o.role === 'retriever')!;
  return { config, snapshot, a, b, enemy, state, run, retriever };
}
const decision = (f: ReturnType<typeof fixture>) => f.retriever().pickupAgency!;
const candidate = (f: ReturnType<typeof fixture>, id = 'b') => decision(f).candidates.find((c) => c.botId === id)!;
const styles = Object.keys(GRIFBALL_PLAYER_STYLES) as GrifballPlayerStyle[];

for (const style of styles)
  test(`${style} bids only on a closely matched ordinary recovery`, () => {
    const f = fixture(style);
    f.run();
    assert.equal(f.retriever().botId, style === 'enforcer' || style === 'opportunist' ? 'b' : 'a');
    assert.equal(candidate(f).bonus, { balanced: 0, enforcer: 0.15, opportunist: 0.25, guardian: -0.15 }[style]);
    assert.equal(candidate(f).style, style);
    assert.equal(candidate(f).eligible, true);
    const orders = f.run();
    assert.equal(orders.filter((a) => a.role === 'retriever').length, 1);
    assert.equal(orders.filter((a) => a.role === 'safety').length, 1);
  });
test('Guardian yields a marginal pickup but still takes a clearly faster or solo recovery', () => {
  const f = fixture('balanced');
  f.config.botStyles.a = 'guardian';
  f.run();
  assert.equal(f.retriever().botId, 'b');
  const fast = fixture('balanced');
  fast.config.botStyles.a = 'guardian';
  fast.b.pos.x = -9;
  fast.run();
  assert.equal(fast.retriever().botId, 'a');
  fast.snapshot.players = fast.snapshot.players.filter((p) => p === fast.a || p === fast.enemy);
  fast.run();
  assert.equal(fast.retriever().botId, 'a');
});
test('Opportunist needs the visible half-second attack window', () => {
  const f = fixture('opportunist');
  f.enemy.pos.x = 8;
  f.enemy.space!.reach = 7;
  f.enemy.space!.attackIn = 0.1;
  f.run();
  assert.equal(candidate(f).eligible, true);
  assert.equal(candidate(f).opening, false);
  assert.equal(candidate(f).bonus, 0);
  assert.equal(f.retriever().botId, 'a');
  f.enemy.space!.phase = 'recovering';
  f.enemy.space!.attackIn = 2;
  f.state.assignments.clear();
  f.run();
  assert.equal(candidate(f).opening, true);
  assert.equal(f.retriever().botId, 'b');
});
test('half strength blends preference; zero strength exactly preserves assignments across styles', () => {
  const f = fixture();
  f.config.defaults.pickupAgencyStrength = 0.5;
  f.run();
  assert.equal(candidate(f).bonus, 0.075);
  assert.equal(f.retriever().botId, 'a');
  f.config.defaults.pickupAgencyStrength = 0;
  f.run();
  const expected = structuredClone(f.state.assignments);
  for (const style of styles) {
    f.config.botStyles.b = style;
    f.run();
    assert.deepEqual(f.state.assignments, expected);
  }
});
test('arrival lead cannot be surrendered to an opponent, including already-lost races', () => {
  for (const x of [5.75, 5.25, 4]) {
    const f = fixture();
    f.enemy.pos.x = x;
    f.run();
    assert.equal(f.retriever().botId, 'a');
    assert.equal(candidate(f).eligible, false);
    assert.match(candidate(f).reason, /arrival margin/);
  }
});
test('clear speed advantages and unavailable routes override even opposing style extremes', () => {
  const f = fixture('opportunist');
  f.config.botStyles.a = 'guardian';
  f.b.pos.x = -7;
  f.run();
  assert.equal(f.retriever().botId, 'a');
  assert.match(candidate(f).reason, /0.25/);
  const blocked = fixture('opportunist');
  blocked.snapshot.geometry = geometry([
    { type: 'box', position: { x: -5.5, y: 2, z: 0 }, scale: { x: 0.4, y: 4, z: 0.4 }, isCollidable: true },
  ]);
  blocked.run();
  assert.equal(candidate(blocked).eligible, false);
  assert.match(candidate(blocked).reason, /ground recovery/);
});
for (const mode of ['airborne', 'lunging', 'mobile-delay'] as const)
  test(`${mode} cannot win an individual pickup bid`, () => {
    const f = fixture('opportunist');
    if (mode === 'airborne') f.b.height = 1;
    if (mode === 'lunging') f.b.space!.phase = 'lunging';
    if (mode === 'mobile-delay') f.b.space!.mobileIn = 0.1;
    f.run();
    assert.equal(f.retriever().botId, 'a');
    assert.equal(candidate(f).eligible, false);
    assert.match(candidate(f).reason, /Committed movement/);
  });
test('an unavailable baseline keeps the ordinary future-recovery decision', () => {
  const f = fixture('opportunist');
  f.a.height = 1;
  f.a.space!.mobileIn = 0.1;
  f.run();
  assert.equal(f.retriever().botId, 'a');
  assert.match(decision(f).reason, /readiness or existing commitment/);
});
test('recovery near our goal preserves the team choice', () => {
  const f = fixture('opportunist');
  f.snapshot.goals.blue = { x: -7, z: 0 };
  f.run();
  assert.equal(f.retriever().botId, 'a');
  assert.match(decision(f).reason, /defended goal/);
});
test('existing recovery commitment resists small style edits and relinquishes a substantially slower pickup', () => {
  const f = fixture('balanced');
  f.run();
  assert.equal(f.retriever().botId, 'a');
  f.config.botStyles.b = 'enforcer';
  for (let i = 0; i < 10; i++) {
    f.run();
    assert.equal(f.retriever().botId, 'a');
  }
  assert.equal(candidate(f, 'a').commitment, 0.4);
  f.a.pos.x = -10;
  f.run();
  assert.equal(f.retriever().botId, 'b');
  for (let i = 0; i < 5; i++) {
    f.run();
    assert.equal(f.retriever().botId, 'b');
  }
});
test('zero team commitment allows a changed bid to take effect immediately', () => {
  const f = fixture('balanced');
  f.config.defaults.reassignmentAdvantage = 0;
  f.run();
  f.config.botStyles.b = 'enforcer';
  f.run(0);
  assert.equal(f.retriever().botId, 'b');
  f.config.defaults.pickupAgencyStrength = 0;
  f.run(0);
  assert.equal(f.retriever().botId, 'a');
  assert.equal(f.retriever().pickupAgency, undefined);
});
for (const mode of ['request', 'approaching', 'neural'] as const)
  test(`${mode} observed pursuit keeps pickup priority`, () => {
    const f = fixture();
    const human = actor('human', mode === 'request' ? 1 : 4);
    human.scripted = false;
    if (mode === 'request') human.pickupRequested = true;
    else human.vel.x = -2;
    if (mode === 'neural') human.difficulty = 'neural';
    f.snapshot.players.push(human);
    f.run();
    assert.equal(f.retriever(), undefined);
    assert.ok(f.run().every((a) => !a.pickupAgency));
    assert.equal(f.state.assignments.has('human'), false);
  });
test('a slower personal candidate cannot steal an observed pickup that the earlier team candidate would still contest', () => {
  const f = fixture();
  const human = actor('human', 6.25);
  human.scripted = false;
  human.vel.x = -2;
  f.snapshot.players.push(human);
  f.run();
  assert.equal(f.retriever().botId, 'a');
  assert.match(candidate(f).reason, /Observed human or neural/);
});
for (const key of ['enabled', 'spaceEnabled'] as const)
  test(`individual recovery requires ${key}`, () => {
    const f = fixture();
    f.config.defaults[key] = false;
    f.run();
    assert.ok([...f.state.assignments.values()].every((a) => !a.pickupAgency));
  });
test('passing, defense, tanking and other individuality controls remain independent', () => {
  const f = fixture();
  f.config.defaults.defenseEnabled = false;
  f.run();
  assert.equal(f.retriever().botId, 'b');
  assert.equal(candidate(f).bonus, 0.15);
});
for (const mode of ['held', 'thrown', 'elevated', 'rising', 'unknown', 'inactive', 'reserved'] as const)
  test(`${mode} ball state leaves ordinary pickup individuality inactive`, () => {
    const f = fixture();
    if (mode === 'held') {
      f.snapshot.holderId = 'enemy';
      f.snapshot.ballPhysics!.holderId = 'enemy';
      f.snapshot.ballPhysics!.state = 'held';
    }
    if (mode === 'thrown') f.snapshot.ballPhysics!.state = 'thrown';
    if (mode === 'elevated') f.snapshot.ballPhysics!.pos.y = 2;
    if (mode === 'rising') f.snapshot.ballPhysics!.vel.y = 1;
    if (mode === 'unknown') delete f.snapshot.ballPhysics;
    if (mode === 'inactive') f.snapshot.playing = false;
    if (mode === 'reserved') {
      f.run();
      f.snapshot.ballPhysics!.state = 'loose';
      f.state.passFlight = { team: 'blue', carrierId: 'back', receiverId: 'a' };
    }
    f.run();
    assert.ok(f.run().every((a) => !a.pickupAgency));
  });
test('pass reservations retain their receiver when passing is enabled', () => {
  const f = fixture('opportunist');
  f.config.defaults.passingEnabled = true;
  f.snapshot.ballPhysics!.state = 'loose';
  f.run();
  f.state.passFlight = { team: 'blue', carrierId: 'back', receiverId: 'a' };
  f.run();
  assert.equal(f.retriever().botId, 'a');
  assert.equal(f.retriever().pickupAgency, undefined);
});
test('team scopes, mirrored teams, roster ordering, main_ai and checkpoints preserve individual identity', () => {
  for (const main of [false, true])
    for (const mirror of [false, true])
      for (const reverse of [false, true]) {
        const f = fixture();
        if (main) {
          f.b.id = 'main_ai';
          f.config.botStyles = { main_ai: 'enforcer' };
        }
        if (mirror)
          for (const p of f.snapshot.players) {
            p.team = p.team === 'blue' ? 'red' : 'blue';
            p.pos.x *= -1;
            p.pos.z *= -1;
          }
        if (reverse) f.snapshot.players.reverse();
        f.config.teams[f.a.team] = { pickupAgencyStrength: 0.8 };
        f.run();
        assert.equal(f.retriever().botId, f.b.id);
        assert.equal(decision(f).strength, 0.8);
        const copy = structuredClone(f.state);
        f.enemy.space!.attackIn = 0.1;
        for (const state of [f.state, copy]) updateGrifballTeamPlan(state, structuredClone(f.snapshot), 0.2);
        assert.deepEqual(f.state, copy);
        f.config.teams[f.a.team] = { pickupAgencyStrength: 0 };
        f.run(0);
        assert.equal(f.retriever().pickupAgency, undefined);
      }
});
test('pickup and a fresh round clear the old bid without carrying a retriever across possession', () => {
  const f = fixture();
  f.run();
  f.snapshot.holderId = f.b.id;
  f.snapshot.ballPhysics!.state = 'held';
  f.run();
  assert.ok(f.run().every((a) => !a.pickupAgency));
  f.snapshot.round++;
  f.snapshot.holderId = null;
  f.snapshot.ballPhysics!.state = 'idle';
  f.config.botStyles.b = 'guardian';
  f.run();
  assert.equal(f.retriever().botId, 'a');
});
test('schema 1–25 migrations default recovery individuality off and retain previous settings', () => {
  const current = defaultGrifballTactics();
  assert.equal(current.schemaVersion, 36);
  assert.equal(current.defaults.pickupAgencyStrength, 0);
  for (let version = 1; version <= 25; version++) {
    const old = JSON.parse(JSON.stringify(current));
    old.schemaVersion = version;
    delete old.defaults.pickupAgencyStrength;
    old.defaults.markAgencyStrength = 0.8;
    old.botStyles.main_ai = 'enforcer';
    old.teams.red = { markAgencyStrength: 0.4 };
    const next = validateGrifballTactics(old);
    assert.equal(next.defaults.pickupAgencyStrength, 0);
    assert.equal(next.defaults.markAgencyStrength, 0.8);
    assert.equal(next.botStyles.main_ai, 'enforcer');
    assert.equal(resolveTeamTactics(next, 'red').markAgencyStrength, 0.4);
  }
  current.teams.blue = { pickupAgencyStrength: 0.7 };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(current))), current);
  for (const value of [-0.1, 1.1, NaN, '1'])
    assert.throws(() => validateGrifballTactics({ ...current, teams: { blue: { pickupAgencyStrength: value } } }));
  const invalid = JSON.parse(JSON.stringify(current));
  delete invalid.defaults.pickupAgencyStrength;
  assert.throws(() => validateGrifballTactics(invalid));
});

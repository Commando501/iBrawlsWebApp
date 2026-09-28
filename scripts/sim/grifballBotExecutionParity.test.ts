import test from 'node:test';
import assert from 'node:assert/strict';
import { BOT_PARITY_CASES, createBotParityFixture, runBotExecutionParityTrace } from './grifballBotExecutionParity';

for (const id of ['main_ai', 'bot_2']) for (const observer of [false, true]) for (const spec of BOT_PARITY_CASES) {
  test(`bot parity ${id} observer=${observer} ${spec.name}`, () => {
    const trace = runBotExecutionParityTrace(spec, id, observer);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 5)));
  });
}

for (const id of ['main_ai', 'bot_2']) for (const observer of [false, true]) {
  test(`${id} observer=${observer}: a slash advances exactly once per frame`, () => {
    const f = createBotParityFixture(id, observer); f.bot.activeWeapon = 'sword';
    const damageTicks: number[] = [];
    for (let tick = 1; tick <= 60; tick++) {
      const before = f.target.hp; f.frame(tick === 1);
      if (f.target.hp < before) damageTicks.push(tick);
    }
    assert.deepEqual(damageTicks, [7]);
    assert.equal(f.bot.weaponState, 'ready');
  });
  test(`${id} observer=${observer}: triggered melee completes once and recovers`, () => {
    const f = createBotParityFixture(id, observer);
    for (let i = 0; i < 65; i++) f.frame(i === 0, true);
    assert.equal(f.target.hp, 19);
    assert.equal(f.bot.weaponState, 'ready');
  });
}
test('visual updates cannot advance or terminate an offline bot lunge', () => {
  const f = createBotParityFixture();
  f.bot.isLunging = true; f.bot.lungeTimer = .7;
  f.visuals(.2);
  assert.equal(f.bot.lungeTimer, .7);
  assert.equal(f.bot.isLunging, true);
});
test('dead bots cancel their pending attack instead of resuming it after respawn', () => {
  const f = createBotParityFixture(); f.attack(); f.bot.hp = 0; f.bot.respawnTimer = 3;
  f.visuals(.05);
  assert.equal(f.bot.weaponState, 'ready'); assert.equal(f.bot.weaponTimer, 0);
  assert.equal(f.target.hp, 20);
});

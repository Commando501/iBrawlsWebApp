import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTACK_STAGGER_STEP,
  clearBotEngagements,
  createBotCoordinator,
  getAttackPhaseDelay,
  getBotCoordRole,
  getCoordinatedTargetBonus,
  getEngagingBotIds,
  getPincerApproachOffset,
  isCoordinationEnabled,
  notifyBotDamageTag,
  PRIORITY_TARGET_TTL,
  registerBotEngagement,
  resetBotCoordinator,
  shouldDeferCoordinatedAttack,
  shouldPunisherHold,
  tickBotCoordinator,
} from './aiBotCoordinator';

test('isCoordinationEnabled skips easy difficulty', () => {
  assert.equal(isCoordinationEnabled('easy'), false);
  assert.equal(isCoordinationEnabled('hard'), true);
});

test('notifyBotDamageTag sets shared priority target', () => {
  const coordinator = createBotCoordinator();
  notifyBotDamageTag(coordinator, 'bot_a', 'player');

  assert.equal(coordinator.priorityTargetId, 'player');
  assert.equal(coordinator.taggerBotId, 'bot_a');
  assert.ok(getCoordinatedTargetBonus({
    coordinator,
    botId: 'bot_b',
    targetId: 'player',
    difficulty: 'hard',
  }) >= 420);
});

test('priority target expires after TTL', () => {
  const coordinator = createBotCoordinator();
  notifyBotDamageTag(coordinator, 'main_ai', 'player');
  tickBotCoordinator(coordinator, PRIORITY_TARGET_TTL + 0.1);

  assert.equal(coordinator.priorityTargetId, undefined);
  assert.equal(getCoordinatedTargetBonus({
    coordinator,
    botId: 'bot_a',
    targetId: 'player',
    difficulty: 'hard',
  }), 0);
});

test('getEngagingBotIds tracks per-tick focus registrations', () => {
  const coordinator = createBotCoordinator();
  registerBotEngagement(coordinator, 'main_ai', 'player');
  registerBotEngagement(coordinator, 'bot_1', 'player');
  registerBotEngagement(coordinator, 'bot_2', 'main_ai');

  assert.deepEqual(getEngagingBotIds(coordinator, 'player'), ['bot_1', 'main_ai']);
  clearBotEngagements(coordinator);
  assert.deepEqual(getEngagingBotIds(coordinator, 'player'), []);
});

test('pincer offsets flankers to opposite sides', () => {
  const coordinator = createBotCoordinator();
  registerBotEngagement(coordinator, 'bot_a', 'player');
  registerBotEngagement(coordinator, 'bot_b', 'player');

  const offsetA = getPincerApproachOffset({
    coordinator,
    botId: 'bot_a',
    targetId: 'player',
    difficulty: 'hard',
  });
  const offsetB = getPincerApproachOffset({
    coordinator,
    botId: 'bot_b',
    targetId: 'player',
    difficulty: 'hard',
  });

  assert.equal(getBotCoordRole({ coordinator, botId: 'bot_a', targetId: 'player', difficulty: 'hard' }), 'pressure');
  assert.equal(getBotCoordRole({ coordinator, botId: 'bot_b', targetId: 'player', difficulty: 'hard' }), 'flanker');
  assert.equal(offsetA, 0);
  assert.notEqual(Math.sign(offsetA), Math.sign(offsetB));
  assert.ok(Math.abs(offsetB) > 0);
});

test('three bots assign pressure, flanker, and punisher roles', () => {
  const coordinator = createBotCoordinator();
  registerBotEngagement(coordinator, 'bot_a', 'player');
  registerBotEngagement(coordinator, 'bot_b', 'player');
  registerBotEngagement(coordinator, 'bot_c', 'player');

  assert.equal(getBotCoordRole({ coordinator, botId: 'bot_a', targetId: 'player', difficulty: 'hard' }), 'pressure');
  assert.equal(getBotCoordRole({ coordinator, botId: 'bot_b', targetId: 'player', difficulty: 'hard' }), 'flanker');
  assert.equal(getBotCoordRole({ coordinator, botId: 'bot_c', targetId: 'player', difficulty: 'hard' }), 'punisher');
});

test('attack stagger defers later phases until delay elapsed', () => {
  const coordinator = createBotCoordinator();
  registerBotEngagement(coordinator, 'bot_a', 'player');
  registerBotEngagement(coordinator, 'bot_b', 'player');

  const roleInput = { coordinator, botId: 'bot_b', targetId: 'player', difficulty: 'hard' as const };
  const delay = getAttackPhaseDelay(roleInput);
  assert.equal(delay, ATTACK_STAGGER_STEP);

  assert.equal(shouldDeferCoordinatedAttack({
    ...roleInput,
    commitTimer: 0.1,
    allyAttacking: false,
  }), true);

  assert.equal(shouldDeferCoordinatedAttack({
    ...roleInput,
    commitTimer: delay + 0.05,
    allyAttacking: false,
  }), false);
});

test('punisher holds until target is recovering with three allies', () => {
  const coordinator = createBotCoordinator();
  registerBotEngagement(coordinator, 'bot_a', 'player');
  registerBotEngagement(coordinator, 'bot_b', 'player');
  registerBotEngagement(coordinator, 'bot_c', 'player');

  assert.equal(shouldPunisherHold({
    coordinator,
    botId: 'bot_c',
    targetId: 'player',
    difficulty: 'hard',
    targetWeaponState: 'ready',
    targetRecovering: false,
  }), true);

  assert.equal(shouldPunisherHold({
    coordinator,
    botId: 'bot_c',
    targetId: 'player',
    difficulty: 'hard',
    targetWeaponState: 'recovering',
    targetRecovering: true,
  }), false);
});

test('resetBotCoordinator clears all state', () => {
  const coordinator = createBotCoordinator();
  notifyBotDamageTag(coordinator, 'bot_a', 'player');
  registerBotEngagement(coordinator, 'bot_a', 'player');

  resetBotCoordinator(coordinator);

  assert.equal(coordinator.priorityTargetId, undefined);
  assert.equal(coordinator.recentTags.size, 0);
  assert.equal(coordinator.engagements.size, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { type Combatant } from '../../types';
import { updateRadarDomForState } from './overlayDom';
import { type GrifballRuntimeState } from './runtimeState';

class TestElement {
  className = '';
  id = '';
  parentElement: TestElement | null = null;
  readonly children: TestElement[] = [];
  readonly style: Record<string, string> = {};
  private readonly attributes = new Map<string, string>();

  constructor(readonly tagName: string) {}

  appendChild(child: TestElement): TestElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    if (name === 'class') {
      this.className = value;
    } else {
      this.attributes.set(name, value);
    }
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
}

class TestDocument {
  readonly elements = new Map<string, TestElement>();

  createElement(tagName: string): TestElement {
    return new TestElement(tagName);
  }

  getElementById(id: string): TestElement | null {
    return this.elements.get(id) ?? null;
  }

  register(id: string): TestElement {
    const element = new TestElement('div');
    element.id = id;
    this.elements.set(id, element);
    return element;
  }
}

function installRadarDocument(): { document: TestDocument; restore: () => void } {
  const previousDocument = (globalThis as { document?: unknown }).document;
  const document = new TestDocument();
  document.register('radar-enemies-container');
  (globalThis as { document?: unknown }).document = document;

  return {
    document,
    restore: () => {
      (globalThis as { document?: unknown }).document = previousDocument;
    },
  };
}

function createCombatant(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'contact',
    playerName: 'Contact',
    hue: 0,
    controller: 'remote',
    team: 'red',
    pos: new THREE.Vector3(4, 0, 0),
    vel: new THREE.Vector3(0, 0, 0),
    yaw: 0,
    isCrouching: false,
    hp: 1,
    maxHp: 1,
    respawnTimer: 0,
    score: 0,
    kills: 0,
    deaths: 0,
    activeWeapon: 'hammer',
    ...overrides,
  };
}

function createRadarState(contacts: Combatant[], overrides: Partial<GrifballRuntimeState> = {}): GrifballRuntimeState {
  return {
    playerPos: new THREE.Vector3(0, 0, 0),
    playerVel: new THREE.Vector3(0, 0, 0),
    yaw: 0,
    playerHP: 1,
    isCrouching: false,
    localPlayerTeam: 'blue',
    isMultiplayer: true,
    otherPlayers: new Map(contacts.map((contact) => [contact.id, contact])),
    ...overrides,
  } as GrifballRuntimeState;
}

function updateRadar(state: GrifballRuntimeState, pool = new Map<string, HTMLElement>()): Map<string, HTMLElement> {
  updateRadarDomForState({
    state,
    mainAI: undefined,
    radarDotPool: pool,
  });
  return pool;
}

test('radar renders same-team non-local contacts as blue friendly circles', () => {
  const fakeDom = installRadarDocument();
  try {
    const pool = updateRadar(createRadarState([
      createCombatant({ id: 'ally', team: 'blue' }),
    ]));

    const dot = pool.get('ally') as unknown as TestElement | undefined;

    assert.ok(dot);
    assert.match(dot.className, /\bbg-blue-500\b/);
    assert.doesNotMatch(dot.className, /\bbg-red-500\b/);
    assert.match(dot.className, /\brounded-full\b/);
    assert.equal(dot.parentElement, fakeDom.document.getElementById('radar-enemies-container'));
  } finally {
    fakeDom.restore();
  }
});

test('radar renders opposing-team contacts as existing red hostile circles', () => {
  const fakeDom = installRadarDocument();
  try {
    const pool = updateRadar(createRadarState([
      createCombatant({ id: 'hostile', team: 'red' }),
    ]));

    const dot = pool.get('hostile') as unknown as TestElement | undefined;

    assert.ok(dot);
    assert.match(dot.className, /\bbg-red-500\b/);
    assert.doesNotMatch(dot.className, /\bbg-blue-500\b/);
    assert.match(dot.className, /\brounded-full\b/);
  } finally {
    fakeDom.restore();
  }
});

test('radar reapplies marker classes when a pooled contact changes teams', () => {
  const fakeDom = installRadarDocument();
  try {
    const pool = updateRadar(createRadarState([
      createCombatant({ id: 'slot', team: 'red' }),
    ]));
    const dot = pool.get('slot') as unknown as TestElement;

    assert.match(dot.className, /\bbg-red-500\b/);

    updateRadar(createRadarState([
      createCombatant({ id: 'slot', team: 'blue' }),
    ]), pool);

    assert.match(dot.className, /\bbg-blue-500\b/);
    assert.doesNotMatch(dot.className, /\bbg-red-500\b/);
  } finally {
    fakeDom.restore();
  }
});

test('radar keeps inactive contacts hidden for offline player, death, range, and stealth movement', () => {
  const fakeDom = installRadarDocument();
  try {
    const pool = updateRadar(createRadarState([
      createCombatant({ id: 'contact', team: 'blue' }),
    ]));
    const dot = pool.get('contact') as unknown as TestElement;

    assert.equal(dot.style.display, 'flex');

    updateRadar(createRadarState([
      createCombatant({ id: 'contact', team: 'blue' }),
    ], { playerHP: 0 }), pool);
    assert.equal(dot.style.display, 'none');

    updateRadar(createRadarState([
      createCombatant({ id: 'contact', team: 'blue', hp: 0 }),
    ]), pool);
    assert.equal(dot.style.display, 'none');

    updateRadar(createRadarState([
      createCombatant({ id: 'contact', team: 'blue', pos: new THREE.Vector3(40, 0, 0) }),
    ]), pool);
    assert.equal(dot.style.display, 'none');

    updateRadar(createRadarState([
      createCombatant({
        id: 'contact',
        team: 'blue',
        isCrouching: true,
        vel: new THREE.Vector3(0.2, 0, 0),
      }),
    ]), pool);
    assert.equal(dot.style.display, 'none');
  } finally {
    fakeDom.restore();
  }
});

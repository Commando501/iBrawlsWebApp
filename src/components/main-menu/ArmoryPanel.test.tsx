import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArmoryPanel } from './ArmoryPanel';
import { ArmorModelEditor } from './ArmorModelEditor';
import { DEFAULT_LOADOUT } from '../VoxelModels';
import {
  CUSTOM_ARMOR_MAX_CATALOG_PIECES,
  type CustomArmorCatalog,
  type CustomArmorPiece,
} from '../customArmor';

const noop = () => {};

class FakeDomEvent {
  type: string;
  bubbles: boolean;
  cancelable: boolean;
  defaultPrevented = false;
  cancelBubble = false;
  target: FakeDomElement | null = null;
  currentTarget: FakeDomElement | FakeDomDocument | null = null;

  constructor(type: string, init: { bubbles?: boolean; cancelable?: boolean } = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? true;
    this.cancelable = init.cancelable ?? true;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }

  stopPropagation() {
    this.cancelBubble = true;
  }
}

class FakeTextNode {
  nodeType = 3;
  nodeValue: string;
  data: string;
  ownerDocument: FakeDomDocument;
  parentNode: FakeDomElement | null = null;

  constructor(text: string, ownerDocument: FakeDomDocument) {
    this.nodeValue = text;
    this.data = text;
    this.ownerDocument = ownerDocument;
  }

  get textContent() {
    return this.nodeValue;
  }

  set textContent(value: string) {
    this.nodeValue = String(value);
    this.data = String(value);
  }
}

const FAKE_GL = {
  VERSION: 7938,
  SHADING_LANGUAGE_VERSION: 35724,
  VENDOR: 7936,
  RENDERER: 7937,
  ALIASED_LINE_WIDTH_RANGE: 33902,
  ALIASED_POINT_SIZE_RANGE: 33901,
  MAX_TEXTURE_IMAGE_UNITS: 34930,
  MAX_VERTEX_TEXTURE_IMAGE_UNITS: 35660,
  MAX_TEXTURE_SIZE: 3379,
  MAX_CUBE_MAP_TEXTURE_SIZE: 34076,
  MAX_VERTEX_ATTRIBS: 34921,
  MAX_VERTEX_UNIFORM_VECTORS: 36347,
  MAX_VARYING_VECTORS: 36348,
  MAX_FRAGMENT_UNIFORM_VECTORS: 36349,
  DEPTH_BITS: 3414,
  STENCIL_BITS: 3415,
  MAX_SAMPLES: 36183,
};

function createFakeGlContext(canvas: FakeDomElement) {
  const target = {
    ...FAKE_GL,
    canvas,
    drawingBufferWidth: 520,
    drawingBufferHeight: 420,
    getContextAttributes: () => ({ alpha: true }),
    getExtension: () => null,
    getParameter: (parameter: number) => {
      if (parameter === FAKE_GL.VERSION) return 'WebGL 1.0';
      if (parameter === FAKE_GL.SHADING_LANGUAGE_VERSION) return 'WebGL GLSL ES 1.0';
      if (parameter === FAKE_GL.VENDOR) return 'Fake';
      if (parameter === FAKE_GL.RENDERER) return 'Fake';
      if (parameter === FAKE_GL.ALIASED_LINE_WIDTH_RANGE || parameter === FAKE_GL.ALIASED_POINT_SIZE_RANGE) {
        return [1, 1];
      }
      return 8;
    },
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
  };

  return new Proxy(target, {
    get(current, property) {
      if (property in current) return current[property as keyof typeof current];
      if (typeof property === 'string' && property.toUpperCase() === property) return 0;
      return () => 0;
    },
  });
}

type FakeDomNode = FakeDomElement | FakeTextNode;

class FakeDomElement {
  nodeType = 1;
  tagName: string;
  nodeName: string;
  localName: string;
  ownerDocument: FakeDomDocument;
  parentNode: FakeDomElement | FakeDomDocument | null = null;
  childNodes: FakeDomNode[] = [];
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  value = '';
  checked = false;
  disabled = false;
  multiple = false;
  selected = false;
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  className = '';
  private listeners = new Map<string, Array<(event: FakeDomEvent) => void>>();

  constructor(tagName: string, ownerDocument: FakeDomDocument) {
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.localName = tagName.toLowerCase();
    this.ownerDocument = ownerDocument;
  }

  appendChild(node: FakeDomNode) {
    node.parentNode?.removeChild(node);
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }

  insertBefore(node: FakeDomNode, before: FakeDomNode | null) {
    if (!before) return this.appendChild(node);
    node.parentNode?.removeChild(node);
    const index = this.childNodes.indexOf(before);
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, node);
    node.parentNode = this;
    return node;
  }

  removeChild(node: FakeDomNode) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  setAttribute(name: string, value: unknown) {
    this.attributes[name] = String(value);
    if (name === 'class') this.className = String(value);
    if (name === 'value') this.value = String(value);
    if (name === 'disabled') this.disabled = true;
    if (name === 'multiple') this.multiple = true;
  }

  removeAttribute(name: string) {
    delete this.attributes[name];
    if (name === 'disabled') this.disabled = false;
    if (name === 'multiple') this.multiple = false;
  }

  addEventListener(type: string, callback: (event: FakeDomEvent) => void) {
    const callbacks = this.listeners.get(type) ?? [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }

  removeEventListener(type: string, callback: (event: FakeDomEvent) => void) {
    const callbacks = this.listeners.get(type) ?? [];
    this.listeners.set(type, callbacks.filter((entry) => entry !== callback));
  }

  dispatchEvent(event: FakeDomEvent) {
    if (!event.target) event.target = this;
    for (let node: FakeDomElement | FakeDomDocument | null = this; node; node = node.parentNode) {
      event.currentTarget = node;
      for (const callback of [...(node.listeners.get(event.type) ?? [])]) {
        callback.call(node, event);
      }
      if (event.cancelBubble || !event.bubbles) break;
    }
    return !event.defaultPrevented;
  }

  click() {
    return this.dispatchEvent(new FakeDomEvent('click'));
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    this.childNodes = [];
    if (value !== '') {
      this.appendChild(new FakeTextNode(String(value), this.ownerDocument));
    }
  }

  get firstChild() {
    return this.childNodes[0] ?? null;
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get options() {
    return this.childNodes.filter((child): child is FakeDomElement => (
      child.nodeType === 1 && child instanceof FakeDomElement && child.tagName === 'OPTION'
    ));
  }

  get clientWidth() {
    return 520;
  }

  get clientHeight() {
    return 420;
  }

  getContext() {
    return createFakeGlContext(this);
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 520, height: 420, right: 520, bottom: 420 };
  }
}

class FakeDomDocument extends FakeDomElement {
  nodeType = 9;
  documentElement: FakeDomElement;
  body: FakeDomElement;
  defaultView: any = null;

  constructor() {
    super('#document', undefined as unknown as FakeDomDocument);
    this.ownerDocument = this;
    this.documentElement = new FakeDomElement('html', this);
    this.body = new FakeDomElement('body', this);
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName: string) {
    return new FakeDomElement(tagName, this);
  }

  createElementNS(namespaceURI: string, tagName: string) {
    const element = new FakeDomElement(tagName, this);
    element.namespaceURI = namespaceURI;
    return element;
  }

  createTextNode(text: string) {
    return new FakeTextNode(text, this);
  }

  createComment(text: string) {
    const comment = new FakeTextNode(text, this);
    comment.nodeType = 8;
    return comment;
  }
}

function installFakeDom() {
  const previous = {
    document: (globalThis as any).document,
    window: (globalThis as any).window,
    navigator: (globalThis as any).navigator,
    HTMLElement: (globalThis as any).HTMLElement,
    Event: (globalThis as any).Event,
    localStorage: (globalThis as any).localStorage,
    requestAnimationFrame: (globalThis as any).requestAnimationFrame,
    cancelAnimationFrame: (globalThis as any).cancelAnimationFrame,
  };
  const document = new FakeDomDocument();
  const animationFrames = new Set<ReturnType<typeof setTimeout>>();
  const window = {
    document,
    navigator: { userAgent: 'Node' },
    addEventListener: noop,
    removeEventListener: noop,
    Event: FakeDomEvent,
    HTMLElement: FakeDomElement,
    HTMLIFrameElement: class {},
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
  };
  document.defaultView = window;

  (globalThis as any).document = document;
  (globalThis as any).window = window;
  (globalThis as any).navigator = window.navigator;
  (globalThis as any).HTMLElement = FakeDomElement;
  (globalThis as any).Event = FakeDomEvent;
  (globalThis as any).localStorage = {
    getItem: () => null,
    setItem: noop,
    removeItem: noop,
  };
  (globalThis as any).requestAnimationFrame = (callback: (now: number) => void) => {
    const id = setTimeout(() => {
      animationFrames.delete(id);
      callback(Date.now());
    }, 16);
    animationFrames.add(id);
    return id;
  };
  (globalThis as any).cancelAnimationFrame = (id: ReturnType<typeof setTimeout>) => {
    animationFrames.delete(id);
    clearTimeout(id);
  };

  return {
    document,
    restore: () => {
      animationFrames.forEach((id) => clearTimeout(id));
      animationFrames.clear();
      (globalThis as any).document = previous.document;
      (globalThis as any).window = previous.window;
      (globalThis as any).navigator = previous.navigator;
      (globalThis as any).HTMLElement = previous.HTMLElement;
      (globalThis as any).Event = previous.Event;
      (globalThis as any).localStorage = previous.localStorage;
      (globalThis as any).requestAnimationFrame = previous.requestAnimationFrame;
      (globalThis as any).cancelAnimationFrame = previous.cancelAnimationFrame;
    },
  };
}

function collectElements(root: FakeDomElement): FakeDomElement[] {
  const elements: FakeDomElement[] = [];
  const visit = (node: FakeDomNode) => {
    if (node instanceof FakeDomElement) {
      elements.push(node);
      node.childNodes.forEach(visit);
    }
  };
  visit(root);
  return elements;
}

function findButtonByText(root: FakeDomElement, text: string): FakeDomElement {
  const button = collectElements(root).find((element) => (
    element.tagName === 'BUTTON' && element.textContent.trim() === text
  ));
  assert.ok(button, `Expected button "${text}" to exist`);
  return button;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const flushEffects = async () => {
  await tick();
  await tick();
  await tick();
};

const baseProps = (modelSystem: 'v1' | 'v2' | 'v3'): ComponentProps<typeof ArmoryPanel> => ({
  isPainting: false,
  playerLoadout: { ...DEFAULT_LOADOUT, modelSystem },
  customArmorCatalog: { version: 1, pieces: [] },
  playerHue: 200,
  customizerWeapon: 'hammer',
  setPlayerLoadout: noop as React.Dispatch<React.SetStateAction<any>>,
  setIsPainting: noop as React.Dispatch<React.SetStateAction<boolean>>,
  setCustomizerWeapon: noop as React.Dispatch<React.SetStateAction<any>>,
  setAdminSettings: noop as React.Dispatch<React.SetStateAction<any>>,
});

test('ArmoryPanel renders V3 material role controls only for V3 loadouts', () => {
  const v3Html = renderToStaticMarkup(<ArmoryPanel {...baseProps('v3')} />);
  const v2Html = renderToStaticMarkup(<ArmoryPanel {...baseProps('v2')} />);

  assert.match(v3Html, /V3 Material Roles/);
  assert.match(v3Html, /Primary/);
  assert.match(v3Html, /Emissive/);
  assert.doesNotMatch(v2Html, /V3 Material Roles/);
});

test('ArmoryPanel presents original sword preset labels', () => {
  const html = renderToStaticMarkup(<ArmoryPanel {...baseProps('v2')} />);

  assert.match(html, /Cyan Classic/);
  assert.match(html, /Twin Arc/);
  assert.match(html, /Prism Edge/);
  assert.match(html, /Emberline/);
  assert.match(html, /Aurum V/);
  assert.doesNotMatch(html, /Halo 2/);
  assert.doesNotMatch(html, /Halo 3/);
  assert.doesNotMatch(html, /Halo 4/);
  assert.doesNotMatch(html, /Halo 5/);
});

test('ArmorModelEditor exposes V3 armor preview mode without removing voxel edit tools', () => {
  const html = renderToStaticMarkup(
    <ArmorModelEditor
      catalog={{ version: 1, pieces: [] }}
      playerLoadout={{ ...DEFAULT_LOADOUT, modelSystem: 'v3' }}
      playerHue={200}
      onCatalogChange={noop as React.Dispatch<React.SetStateAction<any>>}
      onLoadoutChange={noop}
      onClose={noop}
    />
  );

  assert.match(html, /Voxel Edit/);
  assert.match(html, /Armor Preview/);
  assert.match(html, /Rig Preview/);
  assert.match(html, /Read/);
  assert.match(html, /Visual QA/);
  assert.match(html, /Voxel/);
  assert.match(html, /Box/);
  assert.match(html, /Suggested Fixes/);
  assert.match(html, /Smart V3/);
  assert.match(html, /Suit Workspace/);
  assert.match(html, /Start Full Suit/);
  assert.match(html, /Preview Full Suit/);
  assert.match(html, /Save &amp; Equip Suit/);
  assert.match(html, /Shoulder Left/);
  assert.match(html, /Draft/);
  assert.match(html, /Start Shape/);
  assert.match(html, /Panel Stripe/);
  assert.match(html, /Edge Accent/);
  assert.match(html, /Carve Seam/);
  assert.match(html, /Trim Corners/);
  assert.match(html, /Taper Mass/);
  assert.match(html, /Mirror X/);
  assert.match(html, /Smart Tool Preview/);
  assert.match(html, /Apply Smart Tool/);
  assert.match(html, /Strength/);
  assert.match(html, /Stripe Width/);
  assert.match(html, /Mirror Scope/);
  assert.match(html, /Mirror Overwrite/);
  assert.match(html, /aria-pressed/);
  assert.match(html, /Boost readability/);
  assert.match(html, /Reduce dark coverage/);
  assert.match(html, /Improve paneling/);
  assert.match(html, /Polish silhouette/);
  assert.match(html, /Center/);
  assert.match(html, /Fit/);
  assert.match(html, /No Floating/);
  assert.match(html, /Seed Anchor/);
});

test('ArmorModelEditor hides suggested fixes for V2 armor editing', () => {
  const html = renderToStaticMarkup(
    <ArmorModelEditor
      catalog={{ version: 1, pieces: [] }}
      playerLoadout={{ ...DEFAULT_LOADOUT, modelSystem: 'v2' }}
      playerHue={200}
      onCatalogChange={noop as React.Dispatch<React.SetStateAction<any>>}
      onLoadoutChange={noop}
      onClose={noop}
    />
  );

  assert.doesNotMatch(html, /Suggested Fixes/);
  assert.doesNotMatch(html, /Smart V3/);
  assert.doesNotMatch(html, /Suit Workspace/);
  assert.doesNotMatch(html, /Start Full Suit/);
  assert.doesNotMatch(html, /Preview Full Suit/);
  assert.doesNotMatch(html, /Save &amp; Equip Suit/);
  assert.doesNotMatch(html, /Full Suit/);
  assert.doesNotMatch(html, /suitDrafts/);
  assert.doesNotMatch(html, /kit object/);
  assert.doesNotMatch(html, /Start Shape/);
  assert.doesNotMatch(html, /Panel Stripe/);
  assert.doesNotMatch(html, /Smart Tool Preview/);
  assert.doesNotMatch(html, /Apply Smart Tool/);
  assert.doesNotMatch(html, /Strength/);
  assert.doesNotMatch(html, /Stripe Width/);
  assert.doesNotMatch(html, /Mirror Scope/);
  assert.doesNotMatch(html, /Mirror Overwrite/);
  assert.doesNotMatch(html, /Boost readability/);
});

test('ArmorModelEditor preserves active V3 suit draft through start and saves against current catalog', async () => {
  const fakeDom = installFakeDom();
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;

  let root: { render: (children: React.ReactNode) => void; unmount: () => void } | undefined;
  try {
    const { createRoot } = await import('react-dom/client');
    const { flushSync } = await import('react-dom');
    const container = fakeDom.document.createElement('div');
    fakeDom.document.body.appendChild(container);

    const currentCatalogPiece: CustomArmorPiece = {
      version: 1,
      id: 'current_catalog_sentinel',
      name: 'Current Catalog Sentinel',
      slot: 'chest',
      modelSystem: 'v3',
      gridScale: 2,
      voxels: Array.from({ length: 80 }, (_, index) => ({
        x: index % 4,
        y: Math.floor(index / 4),
        z: 0,
        role: 'primary' as const,
      })),
      thumbnail: 'V3:80',
      createdAt: 1,
      updatedAt: 1,
      history: [],
    };
    const currentCatalog: CustomArmorCatalog = { version: 1, pieces: [currentCatalogPiece] };
    let nextCatalog: CustomArmorCatalog | undefined;
    let loadoutPatch: any;

    root = createRoot(container) as typeof root;
    flushSync(() => {
      root!.render(
        <ArmorModelEditor
          catalog={{ version: 1, pieces: [] }}
          playerLoadout={{ ...DEFAULT_LOADOUT, modelSystem: 'v3' }}
          playerHue={200}
          onCatalogChange={(updater) => {
            nextCatalog = typeof updater === 'function' ? updater(currentCatalog) : updater;
          }}
          onLoadoutChange={(patch) => {
            loadoutPatch = patch;
          }}
          onClose={noop}
        />
      );
    });
    await tick();

    now = 1_000;
    findButtonByText(container, 'Start Shape').click();
    await flushEffects();

    now = 2_000;
    findButtonByText(container, 'Start Full Suit').click();
    await flushEffects();

    now = 3_000;
    findButtonByText(container, 'Save & Equip Suit').click();
    await flushEffects();

    assert.equal(loadoutPatch?.customArmor?.helmet?.id, 'v3_template_helmet_rs');
    assert.equal(nextCatalog?.pieces.some((piece) => piece.id === 'current_catalog_sentinel'), true);
    assert.equal(nextCatalog?.pieces.some((piece) => piece.id === 'v3_template_helmet_rs'), true);
    assert.match(container.textContent, /Full suit saved and equipped/);
  } finally {
    root?.unmount();
    await tick();
    Date.now = originalNow;
    fakeDom.restore();
  }
});

test('ArmorModelEditor does not equip full suit when live catalog rejects batch save', async () => {
  const fakeDom = installFakeDom();
  const originalNow = Date.now;
  Date.now = () => 4_000;

  let root: { render: (children: React.ReactNode) => void; unmount: () => void } | undefined;
  try {
    const { createRoot } = await import('react-dom/client');
    const { flushSync } = await import('react-dom');
    const container = fakeDom.document.createElement('div');
    fakeDom.document.body.appendChild(container);

    const fullCatalog: CustomArmorCatalog = {
      version: 1,
      pieces: Array.from({ length: CUSTOM_ARMOR_MAX_CATALOG_PIECES }, (_, index): CustomArmorPiece => ({
        version: 1,
        id: `existing_piece_${index}`,
        name: `Existing Piece ${index}`,
        slot: 'helmet',
        modelSystem: 'v3',
        gridScale: 2,
        voxels: [
          { x: 0, y: 0, z: 0, role: 'primary' },
          { x: 1, y: 0, z: 0, role: 'secondary' },
          { x: 0, y: 1, z: 0, role: 'accent' },
        ],
        thumbnail: 'V3:3',
        createdAt: index,
        updatedAt: index,
        history: [],
      })),
    };
    let nextCatalog: CustomArmorCatalog | undefined;
    let loadoutPatch: any;

    root = createRoot(container) as typeof root;
    flushSync(() => {
      root!.render(
        <ArmorModelEditor
          catalog={{ version: 1, pieces: [] }}
          playerLoadout={{ ...DEFAULT_LOADOUT, modelSystem: 'v3' }}
          playerHue={200}
          onCatalogChange={(updater) => {
            nextCatalog = typeof updater === 'function' ? updater(fullCatalog) : updater;
          }}
          onLoadoutChange={(patch) => {
            loadoutPatch = patch;
          }}
          onClose={noop}
        />
      );
    });
    await flushEffects();

    findButtonByText(container, 'Start Full Suit').click();
    await flushEffects();

    findButtonByText(container, 'Save & Equip Suit').click();
    await flushEffects();

    assert.equal(loadoutPatch, undefined);
    assert.equal(nextCatalog?.pieces.length, CUSTOM_ARMOR_MAX_CATALOG_PIECES);
    assert.equal(nextCatalog?.pieces.some((piece) => piece.id === 'v3_template_helmet_4000'), false);
    assert.match(container.textContent, /Full suit save blocked/);
    assert.doesNotMatch(container.textContent, /Full suit saved and equipped/);
  } finally {
    root?.unmount();
    await tick();
    Date.now = originalNow;
    fakeDom.restore();
  }
});

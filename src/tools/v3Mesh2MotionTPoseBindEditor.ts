import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { buildV3SpartanModel } from '../components/v3/VoxelModelsV3';
import { V3_MESH2MOTION_ARMOR_RIG } from '../components/v3/v3Mesh2MotionArmorRig.generated';
import { V3_CHARACTER_SLOT_IDS, type V3CharacterSlotId } from '../components/v3/v3ModelTypes';
import {
  buildV3Mesh2MotionTPoseBindDiagnostics,
  getV3Mesh2MotionTPoseBindGeneratedPlacement,
  mirrorV3Mesh2MotionTPoseBindSelectedPlacement,
  normalizeV3Mesh2MotionTPoseBindDocument,
  parseV3Mesh2MotionTPoseBindDocumentJson,
  resolveV3Mesh2MotionTPoseBindEditorHotkey,
  serializeV3Mesh2MotionTPoseBindDocument,
  snapV3Mesh2MotionTPoseBindSelectedToSegmentCenter,
  type V3Mesh2MotionTPoseBindDocument,
  type V3Mesh2MotionTPoseBindPlacement,
  type V3Mesh2MotionTPoseBindTransformMode,
} from './v3Mesh2MotionTPoseBindEditorCore';

const SOURCE_HASH = V3_MESH2MOTION_ARMOR_RIG.source.sha256;
const LOCAL_STORAGE_KEY = `ibrawls_v3_mesh2motion_tpose_bind_editor:${SOURCE_HASH}`;

const canvas = document.getElementById('bind-canvas') as HTMLCanvasElement;
const statusElement = document.getElementById('status') as HTMLSpanElement;
const slotSelect = document.getElementById('slot-select') as HTMLSelectElement;
const saveLocalButton = document.getElementById('save-local') as HTMLButtonElement;
const copyJsonButton = document.getElementById('copy-json') as HTMLButtonElement;
const downloadJsonButton = document.getElementById('download-json') as HTMLButtonElement;
const importJsonButton = document.getElementById('import-json') as HTMLButtonElement;
const chooseJsonButton = document.getElementById('choose-json') as HTMLButtonElement;
const clearLocalButton = document.getElementById('clear-local') as HTMLButtonElement;
const mirrorSelectedButton = document.getElementById('mirror-selected') as HTMLButtonElement;
const snapSelectedButton = document.getElementById('snap-selected') as HTMLButtonElement;
const resetSelectedButton = document.getElementById('reset-selected') as HTMLButtonElement;
const resetAllButton = document.getElementById('reset-all') as HTMLButtonElement;
const soloSelectedButton = document.getElementById('solo-selected') as HTMLButtonElement;
const toggleSkeletonButton = document.getElementById('toggle-skeleton') as HTMLButtonElement;
const toggleArmorButton = document.getElementById('toggle-armor') as HTMLButtonElement;
const toggleDiagnosticsButton = document.getElementById('toggle-diagnostics') as HTMLButtonElement;
const importFileInput = document.getElementById('import-file') as HTMLInputElement;
const transformButtons: Record<V3Mesh2MotionTPoseBindTransformMode, HTMLButtonElement> = {
  translate: document.getElementById('transform-translate') as HTMLButtonElement,
  rotate: document.getElementById('transform-rotate') as HTMLButtonElement,
  scale: document.getElementById('transform-scale') as HTMLButtonElement,
};
const positionInputs = [
  document.getElementById('slot-x') as HTMLInputElement,
  document.getElementById('slot-y') as HTMLInputElement,
  document.getElementById('slot-z') as HTMLInputElement,
] as const;
const rotationInputs = [
  document.getElementById('slot-rx') as HTMLInputElement,
  document.getElementById('slot-ry') as HTMLInputElement,
  document.getElementById('slot-rz') as HTMLInputElement,
] as const;
const scaleInputs = [
  document.getElementById('slot-sx') as HTMLInputElement,
  document.getElementById('slot-sy') as HTMLInputElement,
  document.getElementById('slot-sz') as HTMLInputElement,
] as const;
const selectedSummaryElement = document.getElementById('selected-summary') as HTMLPreElement;
const diagnosticsElement = document.getElementById('diagnostics') as HTMLPreElement;
const jsonOutput = document.getElementById('json-output') as HTMLTextAreaElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x061116, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 80);
camera.position.set(1.8, 1.45, 3.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.9, 0);

scene.add(new THREE.HemisphereLight(0xdff9ff, 0x13242c, 1.55));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.25);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x67e8f9, 0.85);
fillLight.position.set(-4, 2, -3);
scene.add(fillLight);

const floor = new THREE.GridHelper(4, 16, 0x2a4b55, 0x173038);
floor.position.y = -0.02;
scene.add(floor);

const model = buildV3SpartanModel({
  isEnemy: false,
  customHue: 188,
  v3QualityTier: 'desktop',
  v3Distance: 0,
  v3SourceFidelity: 'exact',
});
scene.add(model);
const skeletonRoot = model.userData.v3Mesh2MotionSkeletonRoot as THREE.Group | undefined;
if (skeletonRoot) skeletonRoot.visible = false;

const slotPivots = model.userData.v3PartGroups as Record<V3CharacterSlotId, THREE.Group>;
const geometryGroups = model.userData.v3PartGeometryGroups as Record<V3CharacterSlotId, THREE.Group>;

const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setSpace('local');
scene.add(transformControls.getHelper());
transformControls.addEventListener('dragging-changed', (event) => {
  controls.enabled = !(event as { value?: boolean }).value;
});
transformControls.addEventListener('objectChange', () => {
  captureSelectedTransform();
});

const skeletonLines = (() => {
  const joints = new Map<string, (typeof V3_MESH2MOTION_ARMOR_RIG.skeleton.joints)[number]>(
    V3_MESH2MOTION_ARMOR_RIG.skeleton.joints.map((joint) => [joint.name, joint])
  );
  const values: number[] = [];
  for (const joint of V3_MESH2MOTION_ARMOR_RIG.skeleton.joints) {
    const parent = joint.parent ? joints.get(joint.parent) : null;
    if (!parent) continue;
    values.push(...parent.restWorldPosition, ...joint.restWorldPosition);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(values, 3));
  const lines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.72, depthTest: false })
  );
  lines.renderOrder = 20;
  return lines;
})();
scene.add(skeletonLines);

const jointEndpointGroup = new THREE.Group();
jointEndpointGroup.name = 'v3Mesh2MotionTPoseJointEndpoints';
const jointEndpointMaterial = new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.9, depthTest: false });
for (const joint of V3_MESH2MOTION_ARMOR_RIG.skeleton.joints) {
  const endpoint = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), jointEndpointMaterial);
  endpoint.name = `v3Mesh2MotionTPoseJointEndpoint:${joint.name}`;
  endpoint.position.fromArray(joint.restWorldPosition);
  endpoint.renderOrder = 24;
  jointEndpointGroup.add(endpoint);
}
scene.add(jointEndpointGroup);

const slotMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xfacc15, depthTest: false });
const slotDiagnosticMaterial = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.85, depthTest: false });
const slotEnvelopeMaterial = new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.32, depthTest: false });
const slotSegmentMaterial = new THREE.LineBasicMaterial({ color: 0xa7f3d0, transparent: true, opacity: 0.72, depthTest: false });
const slotEnvelopeHelpers: Partial<Record<V3CharacterSlotId, THREE.LineSegments>> = {};
const slotAxisHelpers: Partial<Record<V3CharacterSlotId, THREE.AxesHelper>> = {};
const slotSegmentHelpers: Partial<Record<V3CharacterSlotId, THREE.Line>> = {};
const slotDiagnosticMarkers: Partial<Record<V3CharacterSlotId, THREE.Mesh>> = {};
const jointByName = new Map(V3_MESH2MOTION_ARMOR_RIG.skeleton.joints.map((joint) => [joint.name, joint]));

for (const slot of V3_CHARACTER_SLOT_IDS) {
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8), slotMarkerMaterial);
  marker.name = `v3Mesh2MotionTPoseSlotMarker:${slot}`;
  marker.renderOrder = 25;
  slotPivots[slot].add(marker);

  const generatedSlot = V3_MESH2MOTION_ARMOR_RIG.slots[slot];
  const envelope = generatedSlot.localEnvelope;
  const envelopeGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(
    envelope.size[0],
    envelope.size[1],
    envelope.size[2]
  ));
  const envelopeHelper = new THREE.LineSegments(envelopeGeometry, slotEnvelopeMaterial);
  envelopeHelper.name = `v3Mesh2MotionTPoseSlotEnvelope:${slot}`;
  envelopeHelper.position.set(
    (envelope.min[0] + envelope.max[0]) * 0.5,
    (envelope.min[1] + envelope.max[1]) * 0.5,
    (envelope.min[2] + envelope.max[2]) * 0.5
  );
  envelopeHelper.renderOrder = 22;
  slotPivots[slot].add(envelopeHelper);
  slotEnvelopeHelpers[slot] = envelopeHelper;

  const axes = new THREE.AxesHelper(0.08);
  axes.name = `v3Mesh2MotionTPosePivotAxes:${slot}`;
  axes.renderOrder = 23;
  slotPivots[slot].add(axes);
  slotAxisHelpers[slot] = axes;

  const startJoint = jointByName.get(generatedSlot.sourceJointName);
  const endJoint = generatedSlot.endJointName ? jointByName.get(generatedSlot.endJointName) : null;
  if (startJoint && endJoint) {
    const segmentGeometry = new THREE.BufferGeometry();
    segmentGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      ...startJoint.restWorldPosition,
      ...endJoint.restWorldPosition,
    ], 3));
    const segmentLine = new THREE.Line(segmentGeometry, slotSegmentMaterial);
    segmentLine.name = `v3Mesh2MotionTPoseSlotSegment:${slot}`;
    segmentLine.renderOrder = 21;
    scene.add(segmentLine);
    slotSegmentHelpers[slot] = segmentLine;
  }

  const diagnosticMarker = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), slotDiagnosticMaterial);
  diagnosticMarker.name = `v3Mesh2MotionTPoseDiagnosticMarker:${slot}`;
  diagnosticMarker.renderOrder = 30;
  diagnosticMarker.visible = false;
  slotPivots[slot].add(diagnosticMarker);
  slotDiagnosticMarkers[slot] = diagnosticMarker;
}

const generatedDocument = (): V3Mesh2MotionTPoseBindDocument => normalizeV3Mesh2MotionTPoseBindDocument({
  source: { meshHash: SOURCE_HASH, authoringSpace: 'mesh2motion-native-v3' },
  selectedSlot: 'helmet',
  placements: Object.fromEntries(V3_CHARACTER_SLOT_IDS.map((slot) => [
    slot,
    getV3Mesh2MotionTPoseBindGeneratedPlacement(slot),
  ])),
});

const sourceForCurrentMesh = (
  source: V3Mesh2MotionTPoseBindDocument['source']
): V3Mesh2MotionTPoseBindDocument['source'] => ({
  ...source,
  meshHash: SOURCE_HASH,
  authoringSpace: 'mesh2motion-native-v3',
});

const sourceClearingMissingSlot = (
  slot: V3CharacterSlotId
): V3Mesh2MotionTPoseBindDocument['source'] => {
  const remaining = bindDocument.source.missingPlacementSlots?.filter((candidate) => candidate !== slot) ?? [];
  return remaining.length > 0
    ? { ...bindDocument.source, missingPlacementSlots: remaining }
    : {
      meshHash: bindDocument.source.meshHash,
      authoringSpace: 'mesh2motion-native-v3',
    };
};

const loadInitialDocument = (): V3Mesh2MotionTPoseBindDocument => {
  const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!stored) return generatedDocument();
  try {
    const parsed = parseV3Mesh2MotionTPoseBindDocumentJson(stored);
    return normalizeV3Mesh2MotionTPoseBindDocument({
      ...parsed,
      source: sourceForCurrentMesh(parsed.source),
    });
  } catch {
    return generatedDocument();
  }
};

let bindDocument = loadInitialDocument();
let transformMode: V3Mesh2MotionTPoseBindTransformMode = 'translate';
let soloSelected = false;
let showSkeleton = true;
let showArmor = true;
let showDiagnosticsOverlay = true;

const tupleFromInputs = (inputs: readonly HTMLInputElement[]): [number, number, number] => [
  Number(inputs[0].value),
  Number(inputs[1].value),
  Number(inputs[2].value),
];

const setTupleInputs = (inputs: readonly HTMLInputElement[], value: readonly number[]): void => {
  for (let index = 0; index < inputs.length; index += 1) {
    inputs[index].value = String(Number((value[index] ?? 0).toFixed(6)));
  }
};

const applyPlacementToSlot = (slot: V3CharacterSlotId, placement: V3Mesh2MotionTPoseBindPlacement): void => {
  const geometry = geometryGroups[slot];
  geometry.position.fromArray(placement.position);
  geometry.rotation.set(...placement.rotation, 'XYZ');
  geometry.scale.fromArray(placement.scale);
};

const applyDocumentToModel = (): void => {
  for (const slot of V3_CHARACTER_SLOT_IDS) {
    applyPlacementToSlot(slot, bindDocument.placements[slot]);
  }
  model.updateWorldMatrix(true, true);
};

const selectedSlot = (): V3CharacterSlotId => bindDocument.selectedSlot;

const selectedGeometry = (): THREE.Group => geometryGroups[selectedSlot()];

const refreshVisualToggles = (): void => {
  const selected = selectedSlot();
  skeletonLines.visible = showSkeleton;
  jointEndpointGroup.visible = showSkeleton;
  if (skeletonRoot) skeletonRoot.visible = false;
  soloSelectedButton.classList.toggle('active', soloSelected);
  toggleSkeletonButton.classList.toggle('active', showSkeleton);
  toggleArmorButton.classList.toggle('active', showArmor);
  toggleDiagnosticsButton.classList.toggle('active', showDiagnosticsOverlay);

  for (const slot of V3_CHARACTER_SLOT_IDS) {
    const slotIsVisible = !soloSelected || slot === selected;
    geometryGroups[slot].visible = showArmor && slotIsVisible;
    slotPivots[slot].visible = slotIsVisible;
    if (!showArmor) slotPivots[slot].visible = slotIsVisible;
    if (slotEnvelopeHelpers[slot]) slotEnvelopeHelpers[slot]!.visible = showDiagnosticsOverlay && slotIsVisible;
    if (slotAxisHelpers[slot]) slotAxisHelpers[slot]!.visible = showDiagnosticsOverlay && slotIsVisible;
    if (slotSegmentHelpers[slot]) slotSegmentHelpers[slot]!.visible = showDiagnosticsOverlay && slotIsVisible;
    if (slotDiagnosticMarkers[slot]) {
      slotDiagnosticMarkers[slot]!.visible = showDiagnosticsOverlay && slotDiagnosticMarkers[slot]!.userData.hasDiagnostic === true && slotIsVisible;
    }
  }
};

const refreshSlotSelect = (): void => {
  slotSelect.replaceChildren(...V3_CHARACTER_SLOT_IDS.map((slot) => {
    const option = document.createElement('option');
    option.value = slot;
    option.textContent = slot;
    option.selected = slot === selectedSlot();
    return option;
  }));
};

const syncInputsFromDocument = (): void => {
  const placement = bindDocument.placements[selectedSlot()];
  setTupleInputs(positionInputs, placement.position);
  setTupleInputs(rotationInputs, placement.rotation);
  setTupleInputs(scaleInputs, placement.scale);
};

const updateTransformButtons = (): void => {
  for (const [mode, button] of Object.entries(transformButtons) as [V3Mesh2MotionTPoseBindTransformMode, HTMLButtonElement][]) {
    button.classList.toggle('active', mode === transformMode);
  }
  transformControls.setMode(transformMode);
};

const setSelectedSlot = (slot: V3CharacterSlotId): void => {
  bindDocument = normalizeV3Mesh2MotionTPoseBindDocument({
    ...bindDocument,
    selectedSlot: slot,
  });
  refreshAll();
};

const updateSelectedPlacement = (placement: Partial<V3Mesh2MotionTPoseBindPlacement>): void => {
  const slot = selectedSlot();
  bindDocument = normalizeV3Mesh2MotionTPoseBindDocument({
    ...bindDocument,
    placements: {
      ...bindDocument.placements,
      [slot]: {
        ...bindDocument.placements[slot],
        ...placement,
        slot,
      },
    },
    source: sourceClearingMissingSlot(slot),
  });
  applyDocumentToModel();
};

function captureSelectedTransform(): void {
  const geometry = selectedGeometry();
  updateSelectedPlacement({
    position: geometry.position.toArray() as [number, number, number],
    rotation: [geometry.rotation.x, geometry.rotation.y, geometry.rotation.z],
    scale: geometry.scale.toArray() as [number, number, number],
  });
  syncInputsFromDocument();
  refreshDiagnosticsAndJson();
}

const applyInputsToSelected = (): void => {
  updateSelectedPlacement({
    position: tupleFromInputs(positionInputs),
    rotation: tupleFromInputs(rotationInputs),
    scale: tupleFromInputs(scaleInputs),
  });
  refreshAll();
};

const refreshDiagnosticsAndJson = (): void => {
  const diagnostics = buildV3Mesh2MotionTPoseBindDiagnostics(bindDocument);
  const diagnosticSlots = new Set(diagnostics.items.map((item) => item.slot));
  for (const slot of V3_CHARACTER_SLOT_IDS) {
    if (slotDiagnosticMarkers[slot]) {
      slotDiagnosticMarkers[slot]!.userData.hasDiagnostic = diagnosticSlots.has(slot);
    }
  }
  diagnosticsElement.textContent = diagnostics.items.length === 0
    ? 'ready'
    : diagnostics.items.map((item) => `${item.severity.toUpperCase()} ${item.slot} ${item.code}: ${item.message}`).join('\n');
  jsonOutput.value = serializeV3Mesh2MotionTPoseBindDocument(bindDocument);
  const placement = bindDocument.placements[selectedSlot()];
  const pivot = V3_MESH2MOTION_ARMOR_RIG.slots[selectedSlot()];
  selectedSummaryElement.textContent = [
    `slot: ${selectedSlot()}`,
    `source joint: ${pivot.sourceJointName}`,
    `end joint: ${pivot.endJointName ?? 'none'}`,
    `center joints: ${pivot.centerJointNames.join(', ')}`,
    `segment length: ${pivot.segmentLength.toFixed(4)}`,
    `joint clearance: ${pivot.jointClearance.toFixed(4)}`,
    `envelope size: ${pivot.localEnvelope.size.map((value) => value.toFixed(4)).join(', ')}`,
    `position: ${placement.position.map((value) => value.toFixed(4)).join(', ')}`,
    `rotation: ${placement.rotation.map((value) => value.toFixed(4)).join(', ')}`,
    `scale: ${placement.scale.map((value) => value.toFixed(4)).join(', ')}`,
  ].join('\n');
  statusElement.textContent = diagnostics.ready
    ? `Editing ${selectedSlot()} from Mesh2Motion TPose (${SOURCE_HASH.slice(0, 10)})`
    : `${diagnostics.items.length} diagnostic item(s) for ${selectedSlot()}`;
  refreshVisualToggles();
};

function refreshAll(): void {
  applyDocumentToModel();
  refreshSlotSelect();
  syncInputsFromDocument();
  updateTransformButtons();
  transformControls.attach(selectedGeometry());
  refreshDiagnosticsAndJson();
  refreshVisualToggles();
}

const saveLocal = (): void => {
  window.localStorage.setItem(LOCAL_STORAGE_KEY, serializeV3Mesh2MotionTPoseBindDocument(bindDocument));
  statusElement.textContent = `saved local draft for ${SOURCE_HASH.slice(0, 10)}`;
};

const importDocumentFromText = (text: string): void => {
  try {
    const parsed = parseV3Mesh2MotionTPoseBindDocumentJson(text);
    bindDocument = normalizeV3Mesh2MotionTPoseBindDocument({
      ...parsed,
      source: sourceForCurrentMesh(parsed.source),
    });
    refreshAll();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown import error';
    statusElement.textContent = `import failed: ${message}`;
  }
};

slotSelect.addEventListener('change', () => {
  setSelectedSlot(slotSelect.value as V3CharacterSlotId);
});
for (const input of [...positionInputs, ...rotationInputs, ...scaleInputs]) {
  input.addEventListener('change', applyInputsToSelected);
}
for (const [mode, button] of Object.entries(transformButtons) as [V3Mesh2MotionTPoseBindTransformMode, HTMLButtonElement][]) {
  button.addEventListener('click', () => {
    transformMode = mode;
    updateTransformButtons();
  });
}
mirrorSelectedButton.addEventListener('click', () => {
  bindDocument = mirrorV3Mesh2MotionTPoseBindSelectedPlacement(bindDocument);
  refreshAll();
});
snapSelectedButton.addEventListener('click', () => {
  bindDocument = snapV3Mesh2MotionTPoseBindSelectedToSegmentCenter(bindDocument);
  refreshAll();
});
resetSelectedButton.addEventListener('click', () => {
  const slot = selectedSlot();
  const generated = generatedDocument();
  bindDocument = normalizeV3Mesh2MotionTPoseBindDocument({
    ...bindDocument,
    source: sourceClearingMissingSlot(slot),
    placements: {
      ...bindDocument.placements,
      [slot]: generated.placements[slot],
    },
  });
  refreshAll();
});
resetAllButton.addEventListener('click', () => {
  bindDocument = generatedDocument();
  refreshAll();
});
soloSelectedButton.addEventListener('click', () => {
  soloSelected = !soloSelected;
  refreshVisualToggles();
});
toggleSkeletonButton.addEventListener('click', () => {
  showSkeleton = !showSkeleton;
  refreshVisualToggles();
});
toggleArmorButton.addEventListener('click', () => {
  showArmor = !showArmor;
  refreshVisualToggles();
});
toggleDiagnosticsButton.addEventListener('click', () => {
  showDiagnosticsOverlay = !showDiagnosticsOverlay;
  refreshVisualToggles();
});
saveLocalButton.addEventListener('click', saveLocal);
clearLocalButton.addEventListener('click', () => {
  window.localStorage.removeItem(LOCAL_STORAGE_KEY);
  bindDocument = generatedDocument();
  refreshAll();
});
copyJsonButton.addEventListener('click', async () => {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(serializeV3Mesh2MotionTPoseBindDocument(bindDocument));
    statusElement.textContent = 'copied placement JSON';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'clipboard unavailable';
    statusElement.textContent = `copy failed: ${message}`;
  }
});
downloadJsonButton.addEventListener('click', () => {
  const blob = new Blob([serializeV3Mesh2MotionTPoseBindDocument(bindDocument)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `v3-mesh2motion-tpose-bind-${SOURCE_HASH.slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});
importJsonButton.addEventListener('click', () => importDocumentFromText(jsonOutput.value));
chooseJsonButton.addEventListener('click', () => importFileInput.click());
importFileInput.addEventListener('change', async () => {
  const file = importFileInput.files?.[0];
  if (!file) return;
  try {
    importDocumentFromText(await file.text());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown file error';
    statusElement.textContent = `import failed: ${message}`;
  } finally {
    importFileInput.value = '';
  }
});

window.addEventListener('keydown', (event) => {
  const action = resolveV3Mesh2MotionTPoseBindEditorHotkey({
    key: event.key,
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    targetTagName: (event.target as HTMLElement | null)?.tagName ?? null,
    targetIsContentEditable: (event.target as HTMLElement | null)?.isContentEditable,
  });
  if (!action) return;
  event.preventDefault();
  if (action.type === 'clearSelection') transformControls.detach();
  if (action.type === 'resetSelected') resetSelectedButton.click();
  if (action.type === 'resetAll') resetAllButton.click();
  if (action.type === 'mirrorSelected') mirrorSelectedButton.click();
  if (action.type === 'snapSelectedToSegmentCenter') snapSelectedButton.click();
  if (action.type === 'commit') saveLocal();
  if (action.type === 'transformMode') {
    transformMode = action.mode;
    updateTransformButtons();
  }
  if (action.type === 'selectAdjacentSlot') {
    const index = V3_CHARACTER_SLOT_IDS.indexOf(selectedSlot());
    const next = (index + action.direction + V3_CHARACTER_SLOT_IDS.length) % V3_CHARACTER_SLOT_IDS.length;
    setSelectedSlot(V3_CHARACTER_SLOT_IDS[next]);
  }
});

const resize = (): void => {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
};
window.addEventListener('resize', resize);

const animate = (): void => {
  resize();
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
};

refreshAll();
animate();

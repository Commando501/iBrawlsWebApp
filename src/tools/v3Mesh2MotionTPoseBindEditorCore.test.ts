import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  V3_MESH2MOTION_TPOSE_BIND_DOCUMENT_KIND,
  V3_MESH2MOTION_TPOSE_BIND_EDITOR_DEFAULT_DOCUMENT,
  V3_MESH2MOTION_TPOSE_BIND_LEGACY_DOCUMENT_KIND,
  buildV3Mesh2MotionTPoseBindLocalStorageKey,
  buildV3Mesh2MotionTPoseBindDiagnostics,
  normalizeV3Mesh2MotionTPoseBindDocument,
  parseV3Mesh2MotionTPoseBindDocumentJson,
  resetV3Mesh2MotionTPoseBindPlacements,
  resolveV3Mesh2MotionTPoseBindEditorHotkey,
  serializeV3Mesh2MotionTPoseBindDocument,
  type V3Mesh2MotionTPoseBindDocument,
} from './v3Mesh2MotionTPoseBindEditorCore';
import { V3_CHARACTER_SLOT_IDS } from '../components/v3/v3ModelTypes';

describe('v3Mesh2MotionTPoseBindEditorCore', () => {
  it('normalizes canonical V3 bind placement imports and round-trips deterministic JSON', () => {
    const normalized = normalizeV3Mesh2MotionTPoseBindDocument({
      kind: V3_MESH2MOTION_TPOSE_BIND_LEGACY_DOCUMENT_KIND,
      version: 1,
      source: { meshHash: 'source-abc', authoringSpace: 'mesh2motion-native-v3' },
      selectedSlot: 'handRight',
      placements: {
        handRight: {
          slot: 'handRight',
          position: [0.1234567, Number.NaN, -999],
          rotation: [Math.PI * 4, -Math.PI * 4, 0.3333333],
          scale: [0, 10, Number.POSITIVE_INFINITY],
          mirrorOf: 'handLeft',
        },
        unknownSlot: {
          position: [1, 1, 1],
        },
      },
    });

    assert.equal(normalized.kind, V3_MESH2MOTION_TPOSE_BIND_DOCUMENT_KIND);
    assert.equal(normalized.version, 2);
    assert.equal(normalized.source.meshHash, 'source-abc');
    assert.equal(normalized.selectedSlot, 'handRight');
    assert.deepEqual(normalized.selectedArmorSlots, []);
    assert.deepEqual(normalized.selectedSectionIds, []);
    assert.deepEqual(normalized.armorEdits, {});
    assert.deepEqual(normalized.placements.handRight.position, [0.123457, 0, -2]);
    assert.deepEqual(normalized.placements.handRight.rotation, [Math.PI, -Math.PI, 0.333333]);
    assert.deepEqual(normalized.placements.handRight.scale, [0.1, 4, 1]);
    assert.equal(normalized.placements.handRight.mirrorOf, 'handLeft');
    assert.equal('unknownSlot' in normalized.placements, false);

    const parsed = parseV3Mesh2MotionTPoseBindDocumentJson(
      serializeV3Mesh2MotionTPoseBindDocument(normalized)
    );

    assert.deepEqual(parsed, normalized);
  });

  it('normalizes v2 editor armor edits and clamps finite section transforms', () => {
    const normalized = normalizeV3Mesh2MotionTPoseBindDocument({
      kind: V3_MESH2MOTION_TPOSE_BIND_DOCUMENT_KIND,
      version: 2,
      source: { meshHash: 'source-abc', authoringSpace: 'mesh2motion-native-v3' },
      selectedSlot: 'helmet',
      selectedArmorSlots: ['helmet', 'bad-slot', 'chest'],
      selectedSectionIds: ['upper', '', 'lower'],
      armorEdits: {
        helmet: {
          slot: 'helmet',
          piece: {
            version: 1,
            id: 'v3_foundation_exact_helmet_test',
            name: 'Helmet Test',
            slot: 'helmet',
            modelSystem: 'v3',
            gridScale: 2,
            sourcePreset: 'v3-foundation-exact:helmet:test',
            voxels: [
              { x: 0, y: 0, z: 0, role: 'primary' },
              { x: 0, y: 1, z: 0, role: 'secondary' },
            ],
            updatedAt: 123,
          },
          sections: [
            {
              id: 'upper',
              label: 'Upper',
              slot: 'helmet',
              voxelKeys: ['0:1:0'],
              bounds: {
                min: [0, 1, 0],
                max: [0, 1, 0],
                center: [0, 1, 0],
                size: [1, 1, 1],
                voxelCount: 1,
                roles: ['secondary'],
              },
            },
            {
              id: 'lower',
              label: 'Lower',
              slot: 'helmet',
              voxelKeys: ['0:0:0'],
              bounds: {
                min: [0, 0, 0],
                max: [0, 0, 0],
                center: [0, 0, 0],
                size: [1, 1, 1],
                voxelCount: 1,
                roles: ['primary'],
              },
            },
          ],
          sectionTransforms: {
            upper: {
              sectionId: 'upper',
              position: [99, -99, 0.1234567],
              rotation: [99, -99, 0.5],
              scale: [0, 10, Number.NaN],
            },
          },
        },
        footLeft: {
          slot: 'helmet',
        },
      },
    });

    assert.deepEqual(normalized.selectedArmorSlots, ['helmet', 'chest']);
    assert.deepEqual(normalized.selectedSectionIds, ['upper', 'lower']);
    assert.equal(normalized.armorEdits.helmet?.piece.id, 'v3_foundation_exact_helmet_test');
    assert.equal(normalized.armorEdits.footLeft, undefined);
    assert.deepEqual(normalized.armorEdits.helmet?.sectionTransforms.upper, {
      sectionId: 'upper',
      position: [2, -2, 0.123457],
      rotation: [Math.PI, -Math.PI, 0.5],
      scale: [0.1, 4, 1],
    });
    assert.deepEqual(normalized.armorEdits.helmet?.sectionTransforms.lower, {
      sectionId: 'lower',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    });
  });

  it('fills every V3 character slot with independent identity placements', () => {
    const normalized = normalizeV3Mesh2MotionTPoseBindDocument({
      placements: {
        helmet: {
          position: [0.1, 0.2, 0.3],
        },
      },
    });

    assert.deepEqual(Object.keys(normalized.placements), [...V3_CHARACTER_SLOT_IDS].sort());
    assert.deepEqual(normalized.placements.helmet.position, [0.1, 0.2, 0.3]);
    assert.deepEqual(normalized.placements.chest.position, [0, 0, 0]);
    assert.notEqual(normalized.placements.chest, normalized.placements.pelvis);
  });

  it('resets selected or all bind placements without changing import metadata', () => {
    const document = normalizeV3Mesh2MotionTPoseBindDocument({
      source: { meshHash: 'source-abc', authoringSpace: 'mesh2motion-native-v3' },
      selectedSlot: 'handRight',
      placements: {
        handRight: {
          position: [0.4, 0.2, -0.1],
          rotation: [0.2, 0.1, -0.3],
          scale: [1.3, 1.1, 0.9],
        },
        handLeft: {
          position: [-0.4, 0.2, -0.1],
          rotation: [0.2, -0.1, 0.3],
          scale: [1.3, 1.1, 0.9],
        },
      },
    });

    const resetSelected = resetV3Mesh2MotionTPoseBindPlacements(document, {
      mode: 'selected',
      selectedSlot: 'handRight',
    });

    assert.deepEqual(resetSelected.placements.handRight, {
      slot: 'handRight',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    });
    assert.deepEqual(resetSelected.placements.handLeft, document.placements.handLeft);
    assert.deepEqual(resetSelected.source, document.source);
    assert.equal(resetSelected.selectedSlot, 'handRight');

    const resetAll = resetV3Mesh2MotionTPoseBindPlacements(document, { mode: 'all' });
    assert.deepEqual(resetAll.placements.handLeft.position, [0, 0, 0]);
    assert.deepEqual(resetAll.placements.handRight.scale, [1, 1, 1]);
    assert.deepEqual(resetAll.source, document.source);
  });

  it('diagnoses mirrored, inverted, and extreme bind slots with stable severities', () => {
    const document: V3Mesh2MotionTPoseBindDocument = normalizeV3Mesh2MotionTPoseBindDocument({
      placements: {
        handRight: {
          position: [0.45, 0, 0],
          scale: [1, 1, 1],
          mirrorOf: 'handLeft',
        },
        handLeft: {
          position: [0.55, 0, 0],
          scale: [1, 1, 1],
          mirrorOf: 'handRight',
        },
        footLeft: {
          scale: [-1, 1, 1],
        },
        helmet: {
          position: [1.8, 0, 0],
          rotation: [0, 2.7, 0],
          scale: [3.6, 1, 1],
        },
      },
    });

    const report = buildV3Mesh2MotionTPoseBindDiagnostics(document);

    assert.equal(report.kind, 'v3-mesh2motion-tpose-bind-diagnostics');
    assert.equal(report.ready, false);
    assert.ok(report.items.some((item) => item.slot === 'handRight' && item.code === 'mirrored-position'));
    assert.ok(report.items.some((item) => item.slot === 'footLeft' && item.code === 'inverted-scale'));
    assert.ok(report.items.some((item) => item.slot === 'helmet' && item.code === 'extreme-position'));
    assert.ok(report.items.some((item) => item.slot === 'helmet' && item.code === 'extreme-rotation'));
    assert.ok(report.items.some((item) => item.slot === 'helmet' && item.code === 'extreme-scale'));
  });

  it('does not flag generated source-pose correction rotations or fit scales as manual extremes', () => {
    const document: V3Mesh2MotionTPoseBindDocument = normalizeV3Mesh2MotionTPoseBindDocument({
      placements: {
        handLeft: {
          rotation: [0, 0, 2.8],
          scale: [0.2, 1, 1],
        },
      },
    });

    const generatedReport = buildV3Mesh2MotionTPoseBindDiagnostics(document, {
      referencePlacements: {
        handLeft: {
          rotation: [0, 0, 2.8],
          scale: [0.2, 1, 1],
        },
      },
    });
    const editedReport = buildV3Mesh2MotionTPoseBindDiagnostics(document, {
      referencePlacements: {
        handLeft: {
          rotation: [0, 0, 2.5],
          scale: [0.35, 1, 1],
        },
      },
    });

    assert.equal(generatedReport.items.some((item) => item.slot === 'handLeft' && item.code === 'extreme-rotation'), false);
    assert.equal(generatedReport.items.some((item) => item.slot === 'handLeft' && item.code === 'extreme-scale'), false);
    assert.equal(editedReport.items.some((item) => item.slot === 'handLeft' && item.code === 'extreme-rotation'), true);
    assert.equal(editedReport.items.some((item) => item.slot === 'handLeft' && item.code === 'extreme-scale'), true);
  });

  it('diagnoses missing slots from sparse imported bind documents', () => {
    const document = parseV3Mesh2MotionTPoseBindDocumentJson(JSON.stringify({
      source: { meshHash: 'source-abc', authoringSpace: 'mesh2motion-native-v3' },
      selectedSlot: 'helmet',
      placements: {
        helmet: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      },
    }));

    const report = buildV3Mesh2MotionTPoseBindDiagnostics(document);

    assert.equal(report.ready, false);
    assert.equal(document.source.missingPlacementSlots?.includes('chest'), true);
    assert.ok(report.items.some((item) => item.slot === 'chest' && item.code === 'missing-placement'));
    assert.equal(report.items.some((item) => item.slot === 'helmet' && item.code === 'missing-placement'), false);
  });

  it('normalizes bind editor hotkeys and ignores typing targets or modified shortcuts', () => {
    const resolve = resolveV3Mesh2MotionTPoseBindEditorHotkey;

    assert.deepEqual(resolve({ key: 'Escape' }), { type: 'clearSelection' });
    assert.deepEqual(resolve({ key: 'r' }), { type: 'resetSelected' });
    assert.deepEqual(resolve({ key: 'R', shiftKey: true }), { type: 'resetAll' });
    assert.deepEqual(resolve({ key: 'w' }), { type: 'transformMode', mode: 'translate' });
    assert.deepEqual(resolve({ key: 'E' }), { type: 'transformMode', mode: 'rotate' });
    assert.deepEqual(resolve({ key: 's' }), { type: 'transformMode', mode: 'scale' });
    assert.deepEqual(resolve({ key: 'ArrowLeft' }), { type: 'selectAdjacentSlot', direction: -1 });
    assert.deepEqual(resolve({ key: 'ArrowRight' }), { type: 'selectAdjacentSlot', direction: 1 });
    assert.deepEqual(resolve({ key: 'Enter' }), { type: 'commit' });
    assert.equal(resolve({ key: 'r', targetTagName: 'INPUT' }), null);
    assert.equal(resolve({ key: 'w', targetIsContentEditable: true }), null);
    assert.equal(resolve({ key: 'r', ctrlKey: true }), null);
    assert.equal(resolve({ key: 'Backspace' }), null);
  });

  it('ships a frozen default document with canonical identity placements', () => {
    assert.equal(V3_MESH2MOTION_TPOSE_BIND_EDITOR_DEFAULT_DOCUMENT.kind, V3_MESH2MOTION_TPOSE_BIND_DOCUMENT_KIND);
    assert.equal(V3_MESH2MOTION_TPOSE_BIND_EDITOR_DEFAULT_DOCUMENT.version, 2);
    assert.equal(V3_MESH2MOTION_TPOSE_BIND_EDITOR_DEFAULT_DOCUMENT.selectedSlot, 'helmet');
    assert.deepEqual(V3_MESH2MOTION_TPOSE_BIND_EDITOR_DEFAULT_DOCUMENT.selectedArmorSlots, []);
    assert.deepEqual(V3_MESH2MOTION_TPOSE_BIND_EDITOR_DEFAULT_DOCUMENT.selectedSectionIds, []);
    assert.deepEqual(V3_MESH2MOTION_TPOSE_BIND_EDITOR_DEFAULT_DOCUMENT.armorEdits, {});
    assert.deepEqual(
      V3_MESH2MOTION_TPOSE_BIND_EDITOR_DEFAULT_DOCUMENT.placements.handRight,
      {
        slot: 'handRight',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      }
    );
    assert.throws(() => {
      (V3_MESH2MOTION_TPOSE_BIND_EDITOR_DEFAULT_DOCUMENT.placements.handRight.position as number[])[0] = 1;
    });
  });

  it('builds stable bind-editor local storage keys from source and foundation hashes', () => {
    assert.equal(
      buildV3Mesh2MotionTPoseBindLocalStorageKey('source-hash', 'foundation-hash'),
      'ibrawls_v3_mesh2motion_tpose_bind_editor:source-hash:foundation-hash:all-slot-mannequin-envelope-fit-v2'
    );
  });

  it('wires the standalone TPose bind editor into browser and service-worker routes', () => {
    const html = readFileSync('v3-mesh2motion-tpose-bind-editor.html', 'utf8');
    const viteConfig = readFileSync('vite.config.ts', 'utf8');
    const serviceWorker = readFileSync('public/sw.js', 'utf8');
    const devServer = readFileSync('server.ts', 'utf8');

    assert.equal(html.includes('/src/tools/v3Mesh2MotionTPoseBindEditor.ts'), true);
    assert.equal(html.includes('V3 Mesh2Motion TPose Bind Editor'), true);
    assert.equal(html.includes('slot-select'), true);
    assert.equal(html.includes('review-mannequin-only'), true);
    assert.equal(html.includes('review-armor-ghost'), true);
    assert.equal(html.includes('review-armor-visible'), true);
    assert.equal(html.includes('toggle-skeleton-lines'), true);
    assert.equal(html.includes('toggle-slot-pivots'), true);
    assert.equal(html.includes('toggle-finger-joints'), true);
    assert.equal(html.includes('armor-slot-menu-button'), true);
    assert.equal(html.includes('armor-slot-options'), true);
    assert.equal(html.includes('regenerate-armor'), true);
    assert.equal(html.includes('transform-scope-piece'), true);
    assert.equal(html.includes('transform-scope-section'), true);
    assert.equal(html.includes('mirror-transform-mode'), true);
    assert.equal(html.includes('section-buttons'), true);
    assert.equal(html.includes('Editor JSON'), true);
    assert.equal(html.includes('json-output'), true);
    assert.equal(readFileSync('src/tools/v3Mesh2MotionTPoseBindEditor.ts', 'utf8').includes('review=mannequin'), true);
    assert.equal(readFileSync('src/tools/v3Mesh2MotionTPoseBindEditor.ts', 'utf8').includes("value === 'side'"), true);
    assert.equal(
      readFileSync('src/tools/v3Mesh2MotionTPoseBindEditor.ts', 'utf8').includes('v3ResolvedMannequinFitPlacement'),
      true
    );
    assert.equal(viteConfig.includes('v3Mesh2MotionTPoseBindEditor'), true);
    assert.equal(serviceWorker.includes('/v3-mesh2motion-tpose-bind-editor.html'), true);
    assert.equal(devServer.includes('/v3-mesh2motion-tpose-bind-editor.html'), true);
  });
});

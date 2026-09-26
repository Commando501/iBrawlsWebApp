import type {
  CustomArmorMaterialRole,
  CustomArmorPieceSnapshot,
  CustomArmorVoxel,
} from '../components/customArmor';
import {
  V3_ARMOR_FOUNDATION,
  createV3FoundationRenderableCustomArmorVoxels,
} from '../components/v3/v3ArmorFoundation';
import type { V3CharacterSlotId } from '../components/v3/v3ModelTypes';
import {
  identityV3Mesh2MotionTPoseBindSectionTransform,
  type V3Mesh2MotionTPoseBindArmorEdit,
  type V3Mesh2MotionTPoseBindArmorSection,
  type V3Mesh2MotionTPoseBindSectionTransform,
} from './v3Mesh2MotionTPoseBindEditorCore';

type SectionAxis = 'x' | 'y' | 'z';
type AxisBand = {
  id: string;
  label: string;
  minRatio: number;
  maxRatio: number;
};

const AXIS_INDEX: Record<SectionAxis, 0 | 1 | 2> = {
  x: 0,
  y: 1,
  z: 2,
};

const AXIS_BANDS: Record<SectionAxis, AxisBand[]> = {
  x: [
    { id: 'left', label: 'Left', minRatio: 0, maxRatio: 0.34 },
    { id: 'core', label: 'Core', minRatio: 0.34, maxRatio: 0.67 },
    { id: 'right', label: 'Right', minRatio: 0.67, maxRatio: 1 },
  ],
  y: [
    { id: 'lower', label: 'Lower', minRatio: 0, maxRatio: 0.34 },
    { id: 'middle', label: 'Middle', minRatio: 0.34, maxRatio: 0.67 },
    { id: 'upper', label: 'Upper', minRatio: 0.67, maxRatio: 1 },
  ],
  z: [
    { id: 'rear', label: 'Rear', minRatio: 0, maxRatio: 0.34 },
    { id: 'core', label: 'Core', minRatio: 0.34, maxRatio: 0.67 },
    { id: 'front', label: 'Front', minRatio: 0.67, maxRatio: 1 },
  ],
};

const SECTION_ORDER: Record<string, number> = {
  lower: 0,
  middle: 1,
  upper: 2,
  rear: 0,
  core: 1,
  front: 2,
  left: 0,
  right: 2,
};

export const v3Mesh2MotionTPoseBindVoxelKey = (
  voxel: Pick<CustomArmorVoxel, 'x' | 'y' | 'z'>
): string => `${voxel.x}:${voxel.y}:${voxel.z}`;

const slotFromPiece = (piece: CustomArmorPieceSnapshot): V3CharacterSlotId =>
  piece.slot as V3CharacterSlotId;

const boundsForVoxels = (voxels: readonly CustomArmorVoxel[]) => {
  const min: [number, number, number] = [
    Math.min(...voxels.map((voxel) => voxel.x)),
    Math.min(...voxels.map((voxel) => voxel.y)),
    Math.min(...voxels.map((voxel) => voxel.z)),
  ];
  const max: [number, number, number] = [
    Math.max(...voxels.map((voxel) => voxel.x)),
    Math.max(...voxels.map((voxel) => voxel.y)),
    Math.max(...voxels.map((voxel) => voxel.z)),
  ];
  return { min, max };
};

const sectionBoundsForVoxels = (voxels: readonly CustomArmorVoxel[]) => {
  const { min, max } = boundsForVoxels(voxels);
  return {
    min,
    max,
    center: [
      Number(((min[0] + max[0]) / 2).toFixed(6)),
      Number(((min[1] + max[1]) / 2).toFixed(6)),
      Number(((min[2] + max[2]) / 2).toFixed(6)),
    ] as [number, number, number],
    size: [
      max[0] - min[0] + 1,
      max[1] - min[1] + 1,
      max[2] - min[2] + 1,
    ] as [number, number, number],
    voxelCount: voxels.length,
    roles: [...new Set(voxels.map((voxel) => voxel.role))].sort() as CustomArmorMaterialRole[],
  };
};

const selectSectionAxis = (voxels: readonly CustomArmorVoxel[]): SectionAxis => {
  const { min, max } = boundsForVoxels(voxels);
  const span = {
    x: max[0] - min[0],
    y: max[1] - min[1],
    z: max[2] - min[2],
  };
  if (span.y >= span.x && span.y >= span.z) return 'y';
  if (span.z >= span.x) return 'z';
  return 'x';
};

const bandForVoxel = (
  voxel: CustomArmorVoxel,
  axis: SectionAxis,
  min: readonly number[],
  max: readonly number[]
): AxisBand => {
  const axisIndex = AXIS_INDEX[axis];
  const span = Math.max(1, (max[axisIndex] ?? 0) - (min[axisIndex] ?? 0));
  const ratio = ((voxel[axis] ?? 0) - (min[axisIndex] ?? 0)) / span;
  return AXIS_BANDS[axis].find((band, index) =>
    index === AXIS_BANDS[axis].length - 1
      ? ratio >= band.minRatio && ratio <= band.maxRatio
      : ratio >= band.minRatio && ratio < band.maxRatio
  ) ?? AXIS_BANDS[axis][1];
};

export function buildV3Mesh2MotionTPoseBindArmorSections(
  piece: CustomArmorPieceSnapshot
): V3Mesh2MotionTPoseBindArmorSection[] {
  if (piece.voxels.length === 0) return [];
  const slot = slotFromPiece(piece);
  const axis = selectSectionAxis(piece.voxels);
  const { min, max } = boundsForVoxels(piece.voxels);
  const grouped = new Map<string, { band: AxisBand; voxels: CustomArmorVoxel[] }>();

  for (const voxel of piece.voxels) {
    const band = bandForVoxel(voxel, axis, min, max);
    const existing = grouped.get(band.id);
    if (existing) existing.voxels.push(voxel);
    else grouped.set(band.id, { band, voxels: [voxel] });
  }

  const sections = [...grouped.values()]
    .filter(({ voxels }) => voxels.length > 0)
    .sort((left, right) => (
      (SECTION_ORDER[left.band.id] ?? 99) - (SECTION_ORDER[right.band.id] ?? 99) ||
      left.band.id.localeCompare(right.band.id)
    ));

  if (sections.length <= 1) {
    return [{
      id: 'core',
      label: 'Core',
      slot,
      voxelKeys: piece.voxels.map(v3Mesh2MotionTPoseBindVoxelKey).sort(),
      bounds: sectionBoundsForVoxels(piece.voxels),
    }];
  }

  return sections.map(({ band, voxels }) => ({
    id: band.id,
    label: band.label,
    slot,
    voxelKeys: voxels.map(v3Mesh2MotionTPoseBindVoxelKey).sort(),
    bounds: sectionBoundsForVoxels(voxels),
  }));
}

export function createV3Mesh2MotionTPoseBindArmorEdit(
  piece: CustomArmorPieceSnapshot
): V3Mesh2MotionTPoseBindArmorEdit {
  const sections = buildV3Mesh2MotionTPoseBindArmorSections(piece);
  return {
    slot: slotFromPiece(piece),
    piece,
    sections,
    sectionTransforms: Object.fromEntries(sections.map((section) => [
      section.id,
      identityV3Mesh2MotionTPoseBindSectionTransform(section.id),
    ])),
  };
}

export function createV3Mesh2MotionTPoseBindSectionRenderPiece(
  piece: CustomArmorPieceSnapshot,
  section: V3Mesh2MotionTPoseBindArmorSection
): CustomArmorPieceSnapshot {
  const sectionKeys = new Set(section.voxelKeys);
  return {
    ...piece,
    voxels: createV3FoundationRenderableCustomArmorVoxels({
      ...piece,
      voxels: piece.voxels.filter((voxel) => sectionKeys.has(v3Mesh2MotionTPoseBindVoxelKey(voxel))),
    }),
  };
}

export function measureV3Mesh2MotionTPoseBindVoxelBounds(
  voxels: readonly Pick<CustomArmorVoxel, 'x' | 'y' | 'z'>[]
): Pick<V3Mesh2MotionTPoseBindArmorSection['bounds'], 'min' | 'max' | 'center' | 'size'> {
  if (voxels.length === 0) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
      center: [0, 0, 0],
      size: [1, 1, 1],
    };
  }
  return sectionBoundsForVoxels(voxels.map((voxel) => ({
    ...voxel,
    role: 'primary' as const,
  })));
}

export function resolveV3Mesh2MotionTPoseBindMirrorSlot(
  slot: V3CharacterSlotId
): V3CharacterSlotId | null {
  const directMirror = V3_ARMOR_FOUNDATION.slots[slot].mirrorOf;
  if (directMirror) return directMirror;
  const reverseMirror = Object.values(V3_ARMOR_FOUNDATION.slots)
    .find((candidate) => candidate.mirrorOf === slot)?.slot;
  if (reverseMirror) return reverseMirror;
  const namedMirror = slot.endsWith('Left')
    ? slot.replace(/Left$/, 'Right')
    : slot.endsWith('Right')
      ? slot.replace(/Right$/, 'Left')
      : null;
  return namedMirror && namedMirror in V3_ARMOR_FOUNDATION.slots
    ? namedMirror as V3CharacterSlotId
    : null;
}

export function mirrorV3Mesh2MotionTPoseBindTransform(
  transform: V3Mesh2MotionTPoseBindSectionTransform
): V3Mesh2MotionTPoseBindSectionTransform {
  return {
    sectionId: transform.sectionId,
    position: [-transform.position[0], transform.position[1], transform.position[2]],
    rotation: [transform.rotation[0], -transform.rotation[1], -transform.rotation[2]],
    scale: [...transform.scale],
  };
}

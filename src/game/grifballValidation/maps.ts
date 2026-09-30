import type { CustomMapData, CustomMapObject } from '../../types';
import { toGrifballArena } from '../grifballMaps';
import { PREMADE_MAPS } from '../premadeMaps';
import type { ValidationCase } from './types';

/** Fixed validation fixtures, separate from tuning presets and player map selection.
 * Change the versioned ID when changing a layout; never reuse its held-out status
 * after using gameplay results to tune a policy.
 */
export const RESERVED_VALIDATION_MAPS = ['validation-staggered-lanes-v1', 'validation-split-midfield-v1'] as const;

function obstacle(id: string, x: number, z: number, width: number, depth: number): CustomMapObject {
  return { id, name: id, type: 'box', position: { x, y: 1.5, z },
    rotation: { x: 0, y: 0, z: 0 }, scale: { x: width, y: 3, z: depth },
    color: '#475569', texture: 'none', metalness: 0.2, roughness: 0.8, opacity: 1,
    transparent: false, emissive: '#000000', emissiveIntensity: 0, isCollidable: true };
}

/** Return an independent map before plan hashing/freezing. No mutable global cache. */
export function createValidationMap(id: ValidationCase['mapId']): CustomMapData {
  const builtin = PREMADE_MAPS.find(map => map.id === id);
  if (builtin) return structuredClone(toGrifballArena(builtin));
  if (!RESERVED_VALIDATION_MAPS.includes(id as typeof RESERVED_VALIDATION_MAPS[number]))
    throw new Error(`Missing validation map ${id}`);
  const base = PREMADE_MAPS.find(map => map.id === 'championship_stadium');
  if (!base) throw new Error('Validation layouts require the championship court');
  const map = structuredClone(toGrifballArena(base));
  map.id = id;
  map.author = 'Grifball validation';
  map.name = id === 'validation-staggered-lanes-v1' ? 'Validation · Staggered lanes v1' : 'Validation · Split midfield v1';
  map.description = 'Reserved evaluation layout. Geometry checks do not certify held-out policy quality.';
  const placements = id === 'validation-staggered-lanes-v1'
    ? [[-24, -6, 4, 16], [-8, 10, 4, 16]]
    : [[-12, -5, 3, 20], [-28, 12, 7, 5]];
  // Half-turn pairs preserve both goal approaches without a free straight midfield route.
  const obstacles = placements.flatMap(([x, z, width, depth], index) => [
    obstacle(`${id}-${index}-a`, x, z, width, depth),
    obstacle(`${id}-${index}-b`, -x, -z, width, depth),
  ]);
  map.objects = [...map.objects.filter(object => !object.isCollidable), ...obstacles];
  return map;
}

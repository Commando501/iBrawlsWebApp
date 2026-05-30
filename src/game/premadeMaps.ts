/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CustomMapData } from '../types';

export const PREMADE_MAPS: CustomMapData[] = [
  {
    id: 'cyber_hex_arena',
    name: 'Cyber Hex Grid',
    description: 'A sci-fi tactical holodeck featuring glowing neon pillars and a central energy core. Great for fast-paced skirmishes.',
    author: 'System Presets',
    theme: 'cyberpunk',
    arenaRadius: 20,
    skyboxHue: 280, // Magenta/purple twilight
    skyboxBrightness: 5,
    fogColor: '#0c0714',
    fogDensity: 0.02,
    spawnPoints: [
      { x: -12, y: 0, z: -12 },
      { x: 12, y: 0, z: 12 },
      { x: -12, y: 0, z: 12 },
      { x: 12, y: 0, z: -12 },
      { x: 0, y: 0, z: -14 },
      { x: 0, y: 0, z: 14 },
      { x: -14, y: 0, z: 0 },
      { x: 14, y: 0, z: 0 }
    ],
    lighting: {
      ambientColor: '#0f0c1b',
      ambientIntensity: 0.7,
      directColor: '#e0f2fe',
      directIntensity: 1.8,
      directPosition: { x: 5, y: 15, z: 5 },
      pointLights: [
        { id: 'core_glow', color: '#a855f7', intensity: 4.5, distance: 20, decay: 1.5, position: { x: 0, y: 3.5, z: 0 } },
        { id: 'left_vent', color: '#06b6d4', intensity: 2.5, distance: 10, decay: 1.2, position: { x: -8, y: 2, z: 0 } },
        { id: 'right_vent', color: '#06b6d4', intensity: 2.5, distance: 10, decay: 1.2, position: { x: 8, y: 2, z: 0 } }
      ]
    },
    objects: [
      // Central glowing energy core
      {
        id: 'obj_central_core',
        name: 'Plasma Core Reactor',
        type: 'sphere',
        position: { x: 0, y: 1.5, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 3.5, y: 3.5, z: 3.5 }, // Diameter
        color: '#a855f7',
        metalness: 0.2,
        roughness: 0.1,
        opacity: 0.95,
        transparent: true,
        emissive: '#7e22ce',
        emissiveIntensity: 3.0,
        isCollidable: true,
        texture: 'futuristic_shield'
      },
      // Corner carbon fiber pillars
      {
        id: 'obj_pillar_nw',
        name: 'Hex Tech Column NW',
        type: 'cylinder',
        position: { x: -8, y: 3, z: -8 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1.8, y: 6, z: 1.8 }, // scale.x is diameter
        color: '#1e293b',
        metalness: 0.9,
        roughness: 0.15,
        opacity: 1,
        transparent: false,
        emissive: '#06b6d4',
        emissiveIntensity: 1.2,
        isCollidable: true,
        texture: 'futuristic_hex'
      },
      {
        id: 'obj_pillar_ne',
        name: 'Hex Tech Column NE',
        type: 'cylinder',
        position: { x: 8, y: 3, z: -8 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1.8, y: 6, z: 1.8 },
        color: '#1e293b',
        metalness: 0.9,
        roughness: 0.15,
        opacity: 1,
        transparent: false,
        emissive: '#06b6d4',
        emissiveIntensity: 1.2,
        isCollidable: true,
        texture: 'futuristic_hex'
      },
      {
        id: 'obj_pillar_se',
        name: 'Hex Tech Column SE',
        type: 'cylinder',
        position: { x: 8, y: 3, z: 8 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1.8, y: 6, z: 1.8 },
        color: '#1e293b',
        metalness: 0.9,
        roughness: 0.15,
        opacity: 1,
        transparent: false,
        emissive: '#06b6d4',
        emissiveIntensity: 1.2,
        isCollidable: true,
        texture: 'futuristic_hex'
      },
      {
        id: 'obj_pillar_sw',
        name: 'Hex Tech Column SW',
        type: 'cylinder',
        position: { x: -8, y: 3, z: 8 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1.8, y: 6, z: 1.8 },
        color: '#1e293b',
        metalness: 0.9,
        roughness: 0.15,
        opacity: 1,
        transparent: false,
        emissive: '#06b6d4',
        emissiveIntensity: 1.2,
        isCollidable: true,
        texture: 'futuristic_hex'
      },
      // Carbon fiber defensive partitions
      {
        id: 'obj_barrier_north',
        name: 'Tactical Shield Block N',
        type: 'box',
        position: { x: 0, y: 1.25, z: -7 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 4, y: 2.5, z: 0.8 },
        color: '#0f172a',
        metalness: 0.8,
        roughness: 0.2,
        opacity: 1,
        transparent: false,
        emissive: '#000000',
        emissiveIntensity: 0,
        isCollidable: true,
        texture: 'futuristic_carbon'
      },
      {
        id: 'obj_barrier_south',
        name: 'Tactical Shield Block S',
        type: 'box',
        position: { x: 0, y: 1.25, z: 7 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 4, y: 2.5, z: 0.8 },
        color: '#0f172a',
        metalness: 0.8,
        roughness: 0.2,
        opacity: 1,
        transparent: false,
        emissive: '#000000',
        emissiveIntensity: 0,
        isCollidable: true,
        texture: 'futuristic_carbon'
      },
      // Low crates you can jump on top of
      {
        id: 'obj_crate_w',
        name: 'Recharge Substation W',
        type: 'box',
        position: { x: -6, y: 0.8, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1.6, y: 1.6, z: 1.6 },
        color: '#1e293b',
        metalness: 0.7,
        roughness: 0.3,
        opacity: 1,
        transparent: false,
        emissive: '#ec4899',
        emissiveIntensity: 0.8,
        isCollidable: true,
        texture: 'futuristic_carbon'
      },
      {
        id: 'obj_crate_e',
        name: 'Recharge Substation E',
        type: 'box',
        position: { x: 6, y: 0.8, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1.6, y: 1.6, z: 1.6 },
        color: '#1e293b',
        metalness: 0.7,
        roughness: 0.3,
        opacity: 1,
        transparent: false,
        emissive: '#ec4899',
        emissiveIntensity: 0.8,
        isCollidable: true,
        texture: 'futuristic_carbon'
      }
    ]
  },
  {
    id: 'botanical_outpost',
    name: 'Jungle Ruined Outpost',
    description: 'A crumbling modular training center overtaken by nature. Features stone boulders, wooden structures, and mossy cover.',
    author: 'System Presets',
    theme: 'nature',
    arenaRadius: 21,
    skyboxHue: 120, // Greenish atmospheric light
    skyboxBrightness: 6,
    fogColor: '#051208',
    fogDensity: 0.03,
    spawnPoints: [
      { x: -14, y: 0, z: -8 },
      { x: 14, y: 0, z: 8 },
      { x: -8, y: 0, z: 14 },
      { x: 8, y: 0, z: -14 },
      { x: -15, y: 0, z: 0 },
      { x: 15, y: 0, z: 0 },
      { x: 0, y: 0, z: -15 },
      { x: 0, y: 0, z: 15 }
    ],
    lighting: {
      ambientColor: '#0a1d0f',
      ambientIntensity: 0.8,
      directColor: '#fef08a', // Sunlight filtering through canopy
      directIntensity: 2.0,
      directPosition: { x: -6, y: 18, z: -4 },
      pointLights: [
        { id: 'crystal_1', color: '#10b981', intensity: 3.0, distance: 12, decay: 1.1, position: { x: 0, y: 2, z: 0 } },
        { id: 'crystal_2', color: '#eab308', intensity: 2.0, distance: 8, decay: 1.0, position: { x: -9, y: 1.5, z: -9 } },
        { id: 'crystal_3', color: '#eab308', intensity: 2.0, distance: 8, decay: 1.0, position: { x: 9, y: 1.5, z: 9 } }
      ]
    },
    objects: [
      // Central Mystical Totem Crystal
      {
        id: 'obj_nature_totem',
        name: 'Ancient emerald crystal',
        type: 'cylinder',
        position: { x: 0, y: 2, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1.2, y: 4, z: 1.2 },
        color: '#10b981',
        metalness: 0.1,
        roughness: 0.05,
        opacity: 0.85,
        transparent: true,
        emissive: '#047857',
        emissiveIntensity: 2.5,
        isCollidable: true,
        texture: 'fantasy_runed_stone'
      },
      // Giant natural mossy boulders
      {
        id: 'obj_rock_nw',
        name: 'Mossy Boulder NW',
        type: 'box',
        position: { x: -9, y: 1.5, z: -9 },
        rotation: { x: 0, y: 0.3, z: 0 },
        scale: { x: 3, y: 3, z: 3 },
        color: '#2d3748',
        metalness: 0.1,
        roughness: 0.9,
        opacity: 1,
        transparent: false,
        emissive: '#166534',
        emissiveIntensity: 0.3, // faint moss glow
        isCollidable: true,
        texture: 'nature_mossy_stone'
      },
      {
        id: 'obj_rock_se',
        name: 'Mossy Boulder SE',
        type: 'box',
        position: { x: 9, y: 1.5, z: 9 },
        rotation: { x: 0, y: -0.2, z: 0 },
        scale: { x: 3, y: 3, z: 3 },
        color: '#2d3748',
        metalness: 0.1,
        roughness: 0.9,
        opacity: 1,
        transparent: false,
        emissive: '#166534',
        emissiveIntensity: 0.3,
        isCollidable: true,
        texture: 'nature_mossy_stone'
      },
      // Massive Tree Trunks
      {
        id: 'obj_trunk_ne',
        name: 'Forest Giant NE',
        type: 'cylinder',
        position: { x: 9, y: 3.5, z: -9 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 2, y: 7, z: 2 },
        color: '#451a03',
        metalness: 0.05,
        roughness: 0.95,
        opacity: 1,
        transparent: false,
        emissive: '#000000',
        emissiveIntensity: 0,
        isCollidable: true,
        texture: 'nature_wood'
      },
      {
        id: 'obj_trunk_sw',
        name: 'Forest Giant SW',
        type: 'cylinder',
        position: { x: -9, y: 3.5, z: 9 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 2, y: 7, z: 2 },
        color: '#451a03',
        metalness: 0.05,
        roughness: 0.95,
        opacity: 1,
        transparent: false,
        emissive: '#000000',
        emissiveIntensity: 0,
        isCollidable: true,
        texture: 'nature_wood'
      },
      // Ruins of walls
      {
        id: 'obj_ruined_wall_n',
        name: 'Ruined Wall North',
        type: 'box',
        position: { x: -4, y: 1, z: -4 },
        rotation: { x: 0, y: 0.4, z: 0 },
        scale: { x: 3, y: 2, z: 0.6 },
        color: '#71717a',
        metalness: 0.1,
        roughness: 0.85,
        opacity: 1,
        transparent: false,
        emissive: '#000000',
        emissiveIntensity: 0,
        isCollidable: true,
        texture: 'fantasy_cobble'
      },
      {
        id: 'obj_ruined_wall_s',
        name: 'Ruined Wall South',
        type: 'box',
        position: { x: 4, y: 1, z: 4 },
        rotation: { x: 0, y: 0.4, z: 0 },
        scale: { x: 3, y: 2, z: 0.6 },
        color: '#71717a',
        metalness: 0.1,
        roughness: 0.85,
        opacity: 1,
        transparent: false,
        emissive: '#000000',
        emissiveIntensity: 0,
        isCollidable: true,
        texture: 'fantasy_cobble'
      }
    ]
  },
  {
    id: 'vanguard_starbase',
    name: 'Vanguard Asteroid Mine',
    description: 'An industrial mineral extraction outpost located on an asteroid. Heavy blast doors, steel containers, and amber floodlights.',
    author: 'System Presets',
    theme: 'space',
    arenaRadius: 19,
    skyboxHue: 210, // Cold starlight
    skyboxBrightness: 3,
    fogColor: '#04070f',
    fogDensity: 0.015,
    spawnPoints: [
      { x: -10, y: 0, z: -10 },
      { x: 10, y: 0, z: 10 },
      { x: -10, y: 0, z: 10 },
      { x: 10, y: 0, z: -10 },
      { x: -13, y: 0, z: 0 },
      { x: 13, y: 0, z: 0 },
      { x: 0, y: 0, z: -13 },
      { x: 0, y: 0, z: 13 }
    ],
    lighting: {
      ambientColor: '#0a0d17',
      ambientIntensity: 0.6,
      directColor: '#fffbeb',
      directIntensity: 2.2,
      directPosition: { x: 12, y: 22, z: 6 },
      pointLights: [
        { id: 'shaft_light_1', color: '#ea580c', intensity: 3.5, distance: 15, decay: 1.3, position: { x: -6, y: 3, z: 5 } },
        { id: 'shaft_light_2', color: '#ea580c', intensity: 3.5, distance: 15, decay: 1.3, position: { x: 6, y: 3, z: -5 } }
      ]
    },
    objects: [
      // Core processing drill
      {
        id: 'obj_extractor',
        name: 'Meteorite Ore Extractor',
        type: 'cylinder',
        position: { x: 0, y: 2.5, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 2.6, y: 5, z: 2.6 },
        color: '#334155',
        metalness: 0.95,
        roughness: 0.05,
        opacity: 1,
        transparent: false,
        emissive: '#ca8a04',
        emissiveIntensity: 1.0,
        isCollidable: true,
        texture: 'space_alloy'
      },
      // Massive asteroid crag meteorite blocks
      {
        id: 'obj_asteroid_1',
        name: 'Asteroid Ore Cluster 1',
        type: 'box',
        position: { x: -6, y: 1.5, z: 5 },
        rotation: { x: 0, y: 0.6, z: 0 },
        scale: { x: 2.2, y: 3.0, z: 2.2 },
        color: '#1e293b',
        metalness: 0.3,
        roughness: 0.8,
        opacity: 1,
        transparent: false,
        emissive: '#ca8a04', // glowing amber mineral veins
        emissiveIntensity: 1.8,
        isCollidable: true,
        texture: 'space_meteorite'
      },
      {
        id: 'obj_asteroid_2',
        name: 'Asteroid Ore Cluster 2',
        type: 'box',
        position: { x: 6, y: 1.5, z: -5 },
        rotation: { x: 0, y: -0.4, z: 0 },
        scale: { x: 2.2, y: 3.0, z: 2.2 },
        color: '#1e293b',
        metalness: 0.3,
        roughness: 0.8,
        opacity: 1,
        transparent: false,
        emissive: '#ca8a04',
        emissiveIntensity: 1.8,
        isCollidable: true,
        texture: 'space_meteorite'
      },
      // Metallic cargo containers
      {
        id: 'obj_container_l',
        name: 'Freight Container Left',
        type: 'box',
        position: { x: -7, y: 1, z: -5 },
        rotation: { x: 0, y: 0.1, z: 0 },
        scale: { x: 1.8, y: 2.0, z: 3.5 },
        color: '#475569',
        metalness: 0.8,
        roughness: 0.3,
        opacity: 1,
        transparent: false,
        emissive: '#000000',
        emissiveIntensity: 0,
        isCollidable: true,
        texture: 'space_alloy'
      },
      {
        id: 'obj_container_r',
        name: 'Freight Container Right',
        type: 'box',
        position: { x: 7, y: 1, z: 5 },
        rotation: { x: 0, y: 0.1, z: 0 },
        scale: { x: 1.8, y: 2.0, z: 3.5 },
        color: '#475569',
        metalness: 0.8,
        roughness: 0.3,
        opacity: 1,
        transparent: false,
        emissive: '#000000',
        emissiveIntensity: 0,
        isCollidable: true,
        texture: 'space_alloy'
      },
      // Industrial hazard striped gates/partitions
      {
        id: 'obj_partition_n',
        name: 'Modular Containment Wall N',
        type: 'box',
        position: { x: 0, y: 1.5, z: -8 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 5, y: 3, z: 0.4 },
        color: '#3f3f46',
        metalness: 0.7,
        roughness: 0.4,
        opacity: 1,
        transparent: false,
        emissive: '#ca8a04',
        emissiveIntensity: 0.4,
        isCollidable: true,
        texture: 'city_concrete'
      },
      {
        id: 'obj_partition_s',
        name: 'Modular Containment Wall S',
        type: 'box',
        position: { x: 0, y: 1.5, z: 8 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 5, y: 3, z: 0.4 },
        color: '#3f3f46',
        metalness: 0.7,
        roughness: 0.4,
        opacity: 1,
        transparent: false,
        emissive: '#ca8a04',
        emissiveIntensity: 0.4,
        isCollidable: true,
        texture: 'city_concrete'
      }
    ]
  }
];

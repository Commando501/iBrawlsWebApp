import * as THREE from 'three';
import { type CombatantMeshRig } from './combatantModels';
import { type SkyAtmosphereRuntime } from './skyAtmosphereRuntime';
import type { V3DeathVoxelBurstInstance } from './v3DeathVoxelBurst';

export interface GrifballThreeRefs {
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  renderer: THREE.WebGLRenderer | null;
  playerHammer: THREE.Group | null;
  playerSword: THREE.Group | null;
  playerPistol: THREE.Group | null;
  enemyGroup: THREE.Group | null;
  enemyHammer: THREE.Group | null;
  enemySword: THREE.Group | null;
  hostGroup: THREE.Group | null;
  hostHammer: THREE.Group | null;
  hostSword: THREE.Group | null;
  debugPlayerSphere: THREE.Mesh | null;
  debugEnemySphere: THREE.Mesh | null;
  playerJumpZoneMesh: THREE.Mesh | null;
  ambientLight: THREE.AmbientLight | null;
  dirLight: THREE.DirectionalLight | null;
  damageExplosionParticles: {
    mesh: THREE.Mesh;
    velocity: THREE.Vector3;
    life: number;
    maxLife: number;
  }[];
  hammerSplashFlashes: {
    mesh: THREE.Mesh;
    life: number;
    maxLife: number;
    targetRadius: number;
  }[];
  swordLungeSpeedLines: {
    mesh: THREE.Mesh;
    drift: THREE.Vector3;
    life: number;
    maxLife: number;
    startOpacity: number;
  }[];
  burnDecals: {
    mesh: THREE.Mesh;
    life: number;
    maxLife: number;
  }[];
  tracers: {
    mesh: THREE.Line | THREE.Mesh;
    life: number;
    maxLife: number;
    material: THREE.Material;
  }[];
  grifballThrowTrajectoryLine?: THREE.Line | null;
  grifballThrowTrajectoryDashes?: THREE.Group | null;
  grifballThrowTrajectoryMarker?: THREE.Mesh | null;
  otherPlayerMeshes: Map<string, CombatantMeshRig>;
  v3DeathVoxelBursts: Map<string, V3DeathVoxelBurstInstance>;
  v3DeathAliveState: Map<string, boolean>;
  navMesh?: any;
  customMapObjects?: THREE.Object3D[];
  skyboxMesh?: THREE.Mesh | null;
  skyAtmosphere?: SkyAtmosphereRuntime | null;
}

export function createInitialGrifballThreeRefs(): GrifballThreeRefs {
  return {
    scene: null,
    camera: null,
    renderer: null,
    playerHammer: null,
    playerSword: null,
    playerPistol: null,
    enemyGroup: null,
    enemyHammer: null,
    enemySword: null,
    hostGroup: null,
    hostHammer: null,
    hostSword: null,
    otherPlayerMeshes: new Map(),
    v3DeathVoxelBursts: new Map(),
    v3DeathAliveState: new Map(),
    customMapObjects: [],
    skyboxMesh: null,
    skyAtmosphere: null,

    debugPlayerSphere: null,
    debugEnemySphere: null,
    playerJumpZoneMesh: null,
    ambientLight: null,
    dirLight: null,
    damageExplosionParticles: [],
    hammerSplashFlashes: [],
    swordLungeSpeedLines: [],
    burnDecals: [],
    tracers: [],
    grifballThrowTrajectoryLine: null,
    grifballThrowTrajectoryDashes: null,
    grifballThrowTrajectoryMarker: null,
  };
}

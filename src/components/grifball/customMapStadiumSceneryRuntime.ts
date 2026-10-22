import * as THREE from 'three';
import { getRectHalfExtents } from '../../game/arenaDimensions';
import { type CustomMapData } from '../../types';
import { getEnvironmentQualityProfile, type EnvironmentQualityProfile } from '../../settings/environmentQuality';
import { attachStadiumArchitecture, type StadiumArchitectureHandle } from './stadiumArchitecture';
import { applyStadiumWorldUVs, createStadiumCeramicMaterial, createStadiumMaterial, loadStadiumScreenTexture } from './stadiumMaterials';
import { type GrifballThreeRefs } from './threeRefs';
import { createStadiumSurfaceDetails } from './stadiumSurfaceDetails';
import { createStadiumLightShaftMaterial } from './stadiumLighting';
import { mapScaleFactors } from '../../game/mapBalancing';

export function buildCustomMapStadiumSceneryForRefs({
  refs,
  activeCustomMap,
  quality = getEnvironmentQualityProfile(),
  architectureMaterialFactory,
}: {
  refs: GrifballThreeRefs;
  activeCustomMap: CustomMapData;
  quality?: EnvironmentQualityProfile;
  architectureMaterialFactory?: (source: THREE.Material) => THREE.Material | undefined;
}): StadiumArchitectureHandle | undefined {
  if (activeCustomMap.theme !== 'grifball_stadium') return;
  const scene = refs.scene;
  if (!scene) return;

  const stadiumGroup = new THREE.Group();
  stadiumGroup.name = 'stadium_scenery';
  const factors = mapScaleFactors(activeCustomMap.balanceScale);
  const scaledHalf = getRectHalfExtents(activeCustomMap.arenaRadius, activeCustomMap.arenaHalfExtents);
  // Build every connected part in authored coordinates, then transform the whole
  // assembly. Rotated rails, seats, lights, panels and their seams stay aligned.
  const half = { x: scaledHalf.x / factors.x, z: scaledHalf.z / factors.z };
  stadiumGroup.scale.set(factors.x, factors.y, factors.z);
  const bx = half.x;
  const bz = half.z;

  // Scene-owned material sets; architectural textures retain their world scale.
  const concrete = createStadiumMaterial('concrete', { color: '#abb7c1', roughness: 0.92, metalness: 0.02 }, quality);
  const steel = createStadiumMaterial('metal', { color: '#71899b', roughness: 0.46, metalness: 0.78 }, quality);
  const darkSteel = createStadiumMaterial('metal', { color: '#303f50', roughness: 0.52, metalness: 0.72 }, quality);
  const ceramic = createStadiumCeramicMaterial({ color: '#cbd2d5', roughness: 0.46 }, quality);
  stadiumGroup.add(createStadiumSurfaceDetails(half, quality, { alloy: steel, graphite: darkSteel, ceramic }));
  const makeBox = (x: number, y: number, z: number, material: THREE.Material, tileMeters = 3) => {
    const geometry = new THREE.BoxGeometry(x, y, z);
    applyStadiumWorldUVs(geometry, tileMeters);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    return mesh;
  };

  // Rails, tower legs and bracing share one instanced draw call.
  const fixtures: THREE.Matrix4[] = [];
  const fixtureColors: THREE.Color[] = [];
  const axisY = new THREE.Vector3(0, 1, 0);
  const addRail = (from: THREE.Vector3, to: THREE.Vector3, radius = 0.045, color = '#8998aa') => {
    const delta = to.clone().sub(from);
    const length = delta.length();
    if (length < 0.001) return;
    fixtures.push(new THREE.Matrix4().compose(
      from.clone().add(to).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(axisY, delta.divideScalar(length)),
      new THREE.Vector3(radius, length, radius),
    ));
    fixtureColors.push(new THREE.Color(color));
  };

  const seatPans: THREE.Matrix4[] = [];
  const seatBacks: THREE.Matrix4[] = [];
  const seatColors: THREE.Color[] = [];
  const seatTransform = new THREE.Object3D();
  const backOffset = new THREE.Matrix4().makeTranslation(0, 0.28, -0.27);
  const addSeat = (x: number, y: number, z: number, yaw: number, color: string) => {
    seatTransform.position.set(x, y + 0.34, z);
    seatTransform.rotation.set(0, yaw, 0);
    seatTransform.updateMatrix();
    seatPans.push(seatTransform.matrix.clone());
    seatBacks.push(seatTransform.matrix.clone().multiply(backOffset));
    seatColors.push(new THREE.Color(color));
    addRail(new THREE.Vector3(x, y + 0.03, z), new THREE.Vector3(x, y + 0.34, z), 0.055, '#526273');
  };
  const seatColor = (column: number, teamSide: number) => column % 12 < 2
    ? '#bc9650'
    : teamSide < 0 ? '#38678a' : '#814957';
  const buildStand = (side: number, alongX: boolean, tiers: number) => {
    const length = alongX ? bx * 1.8 : bz * 2.2;
    const edge = alongX ? bz + 6 : bx + 4;
    const yaw = alongX ? (side < 0 ? 0 : Math.PI) : (side < 0 ? Math.PI / 2 : -Math.PI / 2);
    const worldPoint = (along: number, y: number, outward: number) => alongX
      ? new THREE.Vector3(along, y, side * outward)
      : new THREE.Vector3(side * outward, y, along);
    for (let tier = 0; tier < tiers; tier++) {
      const distance = edge + tier * 2;
      const top = tier + 1.2;
      const platform = makeBox(alongX ? length : 2.5, 1.2, alongX ? 2.5 : length, concrete, 2);
      platform.position.copy(worldPoint(0, tier + 0.6, distance));
      platform.castShadow = true;
      stadiumGroup.add(platform);
      const seats = Math.max(1, Math.floor((length - 1.5) / 0.84));
      for (let column = 0; column < seats; column += quality.seatStride) {
        const along = (column - (seats - 1) / 2) * 0.84;
        // Keep two circulation aisles open through each seating bank.
        if (Math.abs(Math.abs(along) - length * 0.25) < 0.8) continue;
        const point = worldPoint(along, top, distance);
        addSeat(point.x, point.y, point.z, yaw, seatColor(column, point.x));
      }
      for (const end of [-1, 1]) {
        const along = end * (length / 2 - 0.18);
        addRail(worldPoint(along, top + 0.88, distance - 1.05), worldPoint(along, top + 0.88, distance + 1.05));
        for (const offset of [-1, 1]) {
          addRail(worldPoint(along, top, distance + offset), worldPoint(along, top + 0.88, distance + offset));
        }
      }
      if (tier === tiers - 1) {
        const back = distance + 1.05;
        for (const height of [0.48, 1.02]) {
          addRail(worldPoint(-length / 2, top + height, back), worldPoint(length / 2, top + height, back));
        }
        for (let along = -length / 2; along <= length / 2; along += 2.4) {
          addRail(worldPoint(along, top, back), worldPoint(along, top + 1.02, back));
        }
      }
    }
  };
  for (const side of [-1, 1]) {
    buildStand(side, true, 4);
    buildStand(side, false, 3);
  }

  // Rounded molded seat shells remain two draw calls for the entire stadium.
  const seatShape = (width: number, height: number) => {
    const shape = new THREE.Shape();
    const x = -width / 2, y = -height / 2, r = 0.085;
    shape.moveTo(x + r, y);
    shape.lineTo(x + width - r, y);
    shape.quadraticCurveTo(x + width, y, x + width, y + r);
    shape.lineTo(x + width, y + height - r);
    shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    shape.lineTo(x + r, y + height);
    shape.quadraticCurveTo(x, y + height, x, y + height - r);
    shape.lineTo(x, y + r);
    shape.quadraticCurveTo(x, y, x + r, y);
    return new THREE.ExtrudeGeometry(shape, {
      depth: 0.065, bevelEnabled: true, bevelSegments: 1, steps: 1,
      bevelSize: 0.025, bevelThickness: 0.025, curveSegments: 2,
    });
  };
  const panGeometry = seatShape(0.64, 0.55);
  panGeometry.rotateX(-Math.PI / 2);
  const backGeometry = seatShape(0.64, 0.59);
  backGeometry.rotateX(-0.1);
  const seatMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.58, metalness: 0.08 });
  for (const [name, geometry, matrices] of [
    ['stadium_seat_pans', panGeometry, seatPans],
    ['stadium_seat_backs', backGeometry, seatBacks],
  ] as const) {
    const seats = new THREE.InstancedMesh(geometry, seatMaterial, matrices.length);
    seats.name = name;
    seats.receiveShadow = true;
    matrices.forEach((matrix, index) => {
      seats.setMatrixAt(index, matrix);
      seats.setColorAt(index, seatColors[index]);
    });
    seats.instanceMatrix.needsUpdate = true;
    if (seats.instanceColor) seats.instanceColor.needsUpdate = true;
    seats.computeBoundingSphere();
    stadiumGroup.add(seats);
  }

  // Four braced floodlight towers, with optical lenses in a single instance batch.
  const lampMatrices: THREE.Matrix4[] = [];
  const buildLightTower = (tx: number, tz: number, isBlue: boolean) => {
    const tower = new THREE.Group();
    tower.position.set(tx, 0, tz);
    const base = makeBox(1.45, 0.35, 1.25, steel);
    base.position.y = 0.175;
    tower.add(base);
    for (const x of [-0.44, 0.44]) {
      for (const z of [-0.34, 0.34]) {
        addRail(new THREE.Vector3(tx + x, 0.3, tz + z), new THREE.Vector3(tx + x, 12.5, tz + z), 0.085, '#687990');
      }
    }
    for (let y = 0.5; y < 12; y += 1.5) {
      for (const z of [-0.34, 0.34]) {
        addRail(new THREE.Vector3(tx - 0.44, y, tz + z), new THREE.Vector3(tx + 0.44, y + 1.5, tz + z), 0.035);
        addRail(new THREE.Vector3(tx + 0.44, y, tz + z), new THREE.Vector3(tx - 0.44, y + 1.5, tz + z), 0.035);
      }
    }
    const direction = new THREE.Vector3(-tx * 0.62, -12.5, -tz * 0.62);
    const beamLength = direction.length();
    direction.normalize();
    const headRotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    const housing = makeBox(1.9, 1.05, 0.55, darkSteel);
    housing.position.set(0, 13, 0);
    housing.quaternion.copy(headRotation);
    housing.castShadow = true;
    tower.add(housing);
    for (const y of [-0.23, 0.23]) {
      for (const x of [-0.66, -0.22, 0.22, 0.66]) {
        const position = new THREE.Vector3(x, y, 0.32).applyQuaternion(headRotation).add(new THREE.Vector3(tx, 13, tz));
        lampMatrices.push(new THREE.Matrix4().compose(position, headRotation, new THREE.Vector3(1, 1, 0.45)));
      }
    }
    if (quality.lightShafts) {
      const coneGeometry = new THREE.ConeGeometry(3.5, beamLength, 16, 1, true);
      coneGeometry.translate(0, -beamLength / 2, 0);
      const cone = new THREE.Mesh(coneGeometry, createStadiumLightShaftMaterial(isBlue ? '#a4d6ec' : '#edc6b7'));
      cone.position.set(0, 13, 0);
      // ConeGeometry extends from its apex along -Y, whereas lookAt aims +Z.
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction);
      tower.add(cone);
    }
    return tower;
  };
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) stadiumGroup.add(buildLightTower(x * (bx + 2), z * (bz + 2), x < 0));
  }
  const lamps = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.16, 12, 6),
    new THREE.MeshBasicMaterial({ color: '#e8f3ff', toneMapped: false }),
    lampMatrices.length,
  );
  lamps.name = 'stadium_floodlight_lenses';
  lampMatrices.forEach((matrix, index) => lamps.setMatrixAt(index, matrix));
  lamps.instanceMatrix.needsUpdate = true;
  lamps.computeBoundingSphere();
  stadiumGroup.add(lamps);

  // Suspended four-sided display: brushed housing, tension cables, gold reveals.
  const scoreboardBox = new THREE.Group();
  scoreboardBox.name = 'stadium_scoreboard';
  const boxFrame = makeBox(6.4, 4, 6.4, darkSteel);
  boxFrame.position.y = 15;
  boxFrame.castShadow = true;
  scoreboardBox.add(boxFrame);
  const crown = makeBox(6.85, 0.28, 6.85, steel);
  crown.position.y = 17.15;
  scoreboardBox.add(crown);
  const baseTrim = makeBox(6.85, 0.28, 6.85, steel);
  baseTrim.position.y = 12.85;
  scoreboardBox.add(baseTrim);
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: '#a87d39', roughness: 0.3, metalness: 0.72,
    emissive: '#b88028', emissiveIntensity: 0.65,
  });
  for (const y of [13.05, 16.95]) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(6.65, 0.065, 6.65), trimMaterial);
    trim.position.y = y;
    scoreboardBox.add(trim);
  }
  for (const x of [-2.7, 2.7]) {
    for (const z of [-2.7, 2.7]) addRail(new THREE.Vector3(x, 17.2, z), new THREE.Vector3(x, 22.4, z), 0.055, '#586b80');
  }
  const screenMaterial = new THREE.MeshBasicMaterial({
    map: loadStadiumScreenTexture('championship', quality), toneMapped: false,
  });
  const screenGeometry = new THREE.PlaneGeometry(5.85, 3.3);
  for (let side = 0; side < 4; side++) {
    const angle = side * Math.PI / 2;
    const screen = new THREE.Mesh(screenGeometry, screenMaterial);
    screen.position.set(Math.sin(angle) * 3.215, 15, Math.cos(angle) * 3.215);
    screen.rotation.y = angle;
    scoreboardBox.add(screen);
  }
  stadiumGroup.add(scoreboardBox);

  // Campaign artwork is loaded once per scene and shared by matching displays.
  const adMaterials = {
    sapphire: new THREE.MeshBasicMaterial({ map: loadStadiumScreenTexture('sapphire', quality), toneMapped: false }),
    gauss: new THREE.MeshBasicMaterial({ map: loadStadiumScreenTexture('gauss', quality), toneMapped: false }),
  };
  const buildBillboard = (x: number, z: number, kind: keyof typeof adMaterials) => {
    const billboard = new THREE.Group();
    billboard.position.set(x, 0, z);
    billboard.rotation.y = z < 0 ? 0 : Math.PI;
    for (const offset of [-4.5, 4.5]) {
      addRail(new THREE.Vector3(x + offset, 0, z), new THREE.Vector3(x + offset, 13.2, z), 0.12, '#78879a');
    }
    addRail(new THREE.Vector3(x - 4.5, 5, z), new THREE.Vector3(x + 4.5, 8.3, z), 0.06);
    addRail(new THREE.Vector3(x + 4.5, 5, z), new THREE.Vector3(x - 4.5, 8.3, z), 0.06);
    const frame = makeBox(10.4, 5.4, 0.42, darkSteel);
    frame.position.y = 11;
    billboard.add(frame);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(9.8, 4.8), adMaterials[kind]);
    screen.position.set(0, 11, 0.225);
    billboard.add(screen);
    const canopy = makeBox(10.55, 0.16, 0.85, steel);
    canopy.position.set(0, 13.76, 0.05);
    billboard.add(canopy);
    return billboard;
  };
  stadiumGroup.add(buildBillboard(-bx * 0.4, -bz - 8, 'sapphire'));
  stadiumGroup.add(buildBillboard(bx * 0.4, -bz - 8, 'gauss'));
  stadiumGroup.add(buildBillboard(-bx * 0.4, bz + 8, 'gauss'));
  stadiumGroup.add(buildBillboard(bx * 0.4, bz + 8, 'sapphire'));

  // A continuous upper bowl gives the stadium an architectural silhouette. Its
  // roof edge is outside the court; no new collision or camera occluders enter play.
  const canopy = new THREE.Group();
  canopy.name = 'stadium_upper_concourse';
  const cyan = new THREE.MeshBasicMaterial({ color: '#68c8dc', toneMapped: false });
  const champagne = new THREE.MeshStandardMaterial({
    color: '#b9a579', roughness: 0.38, metalness: 0.72, emissive: '#8a6027', emissiveIntensity: 0.18,
  });
  const ribbonMaterial = new THREE.MeshBasicMaterial({ color: '#153c50', toneMapped: false });
  for (const side of [-1, 1]) {
    // Broad ribbed roof panels shade the seating banks and frame the open sky.
    for (const alongX of [true, false]) {
      const length = alongX ? (bx + 15) * 2 : (bz + 15) * 2;
      const edge = alongX ? bz + 13 : bx + 12;
      const position = (object: THREE.Object3D, y: number, outward: number) => {
        object.position.set(alongX ? 0 : side * outward, y, alongX ? side * outward : 0);
      };
      const deck = makeBox(alongX ? length : 7, 0.7, alongX ? 7 : length, darkSteel, 4);
      position(deck, 15.8, edge);
      canopy.add(deck);
      const fascia = makeBox(alongX ? length : 0.6, 2, alongX ? 0.6 : length, ceramic, 3);
      position(fascia, 14.8, edge - 3.3);
      canopy.add(fascia);
      const ribbon = makeBox(alongX ? length : 0.08, 0.38, alongX ? 0.08 : length, ribbonMaterial);
      position(ribbon, 14.85, edge - 3.62);
      canopy.add(ribbon);
      for (const [height, material] of [[15.9, champagne], [13.95, cyan]] as const) {
        const trim = makeBox(alongX ? length : 0.12, 0.055, alongX ? 0.12 : length, material);
        position(trim, height, edge - 3.68);
        canopy.add(trim);
      }
      const divisions = Math.max(2, Math.floor(length / 8));
      for (let index = 0; index <= divisions; index++) {
        const along = (index / divisions - 0.5) * length;
        const inner = edge - 3.4, outer = edge + 3.4;
        const point = (distance: number, y: number) => alongX
          ? new THREE.Vector3(along, y, side * distance)
          : new THREE.Vector3(side * distance, y, along);
        addRail(point(inner, 16.25), point(outer, 16.25), 0.11, '#748ca0');
        addRail(point(inner, 14.5), point(outer, 16.25), 0.07, '#4a5d70');
      }
      // Quiet warm sections punctuate the cool structural palette.
      for (const fraction of [-0.33, 0, 0.33]) {
        const marker = makeBox(alongX ? 3.2 : 0.09, 0.1, alongX ? 0.09 : 3.2, champagne);
        position(marker, 14.85, edge - 3.7);
        if (alongX) marker.position.x = fraction * length;
        else marker.position.z = fraction * length;
        canopy.add(marker);
      }
    }
  }
  stadiumGroup.add(canopy);
  // Two open truss arches carry the center display; the court remains open to
  // the sky and the suspension cables terminate on a real structural chord.
  const archSpan = bx + 12;
  const archSteps = 12;
  for (const z of [-2.7, 2.7]) {
    const point = (index: number, upper: boolean) => {
      const unit = index / archSteps * 2 - 1;
      return new THREE.Vector3(unit * archSpan, 16.2 + (1 - unit * unit) * 6.2 + (upper ? 1.2 : 0), z);
    };
    for (let index = 0; index < archSteps; index++) {
      addRail(point(index, false), point(index + 1, false), 0.16, '#61778b');
      addRail(point(index, true), point(index + 1, true), 0.12, '#718a9e');
      addRail(point(index, false), point(index + 1, true), 0.055, '#4b6276');
      addRail(point(index, false), point(index, true), 0.055, '#4b6276');
    }
  }

  const rails = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(1, 1, 1, 8),
    new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.78, roughness: 0.36 }),
    fixtures.length,
  );
  rails.name = 'stadium_rails_and_trusses';
  rails.receiveShadow = true;
  fixtures.forEach((matrix, index) => {
    rails.setMatrixAt(index, matrix);
    rails.setColorAt(index, fixtureColors[index]);
  });
  rails.instanceMatrix.needsUpdate = true;
  if (rails.instanceColor) rails.instanceColor.needsUpdate = true;
  rails.computeBoundingSphere();
  stadiumGroup.add(rails);

  // Fine airborne dust stays subtle enough to preserve combat silhouettes.
  const dustCount = quality.dustCount;
  const dustGeometry = new THREE.BufferGeometry();
  const dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPositions[i * 3] = (Math.random() - 0.5) * bx * 2.5;
    dustPositions[i * 3 + 1] = Math.random() * 12 + 0.1;
    dustPositions[i * 3 + 2] = (Math.random() - 0.5) * bz * 2.5;
  }
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({
    color: '#deccaa', size: 0.055, transparent: true, opacity: 0.3,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  dust.name = 'stadium_dust_particles';
  stadiumGroup.add(dust);

  scene.add(stadiumGroup);
  if (!refs.customMapObjects) refs.customMapObjects = [];
  refs.customMapObjects.push(stadiumGroup);
  return attachStadiumArchitecture(stadiumGroup, half, quality, {
    materialFactory: source => architectureMaterialFactory?.(source)
      ?? (source.name === 'stadium_ceramic' ? ceramic : undefined),
  });
}

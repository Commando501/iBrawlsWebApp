import * as THREE from 'three';
import { getRectHalfExtents } from '../../game/arenaDimensions';
import { type CustomMapData } from '../../types';
import { generateCustomTexture } from './customMapAssets';
import { type GrifballThreeRefs } from './threeRefs';

export function buildCustomMapStadiumSceneryForRefs({
  refs,
  activeCustomMap,
}: {
  refs: GrifballThreeRefs;
  activeCustomMap: CustomMapData;
}): void {
  if (activeCustomMap.theme !== 'grifball_stadium') return;

  const scene = refs.scene;
  if (!scene) return;

  const stadiumGroup = new THREE.Group();
  stadiumGroup.name = 'stadium_scenery';

  const half = getRectHalfExtents(activeCustomMap.arenaRadius, activeCustomMap.arenaHalfExtents);
  const bx = half.x;
  const bz = half.z;

  // 1. Spectator Stands (Tiers of Bleachers)
  // North Bleachers
  for (let tier = 0; tier < 4; tier++) {
    const tierBox = new THREE.Mesh(
      new THREE.BoxGeometry(bx * 1.8, 1.2, 2.5),
      new THREE.MeshStandardMaterial({ color: '#111317', roughness: 0.8, metalness: 0.6 })
    );
    tierBox.position.set(0, tier * 1.0 + 0.6, -bz - 6 - tier * 2.0);
    tierBox.castShadow = true;
    tierBox.receiveShadow = true;
    stadiumGroup.add(tierBox);
  }

  // South Bleachers
  for (let tier = 0; tier < 4; tier++) {
    const tierBox = new THREE.Mesh(
      new THREE.BoxGeometry(bx * 1.8, 1.2, 2.5),
      new THREE.MeshStandardMaterial({ color: '#111317', roughness: 0.8, metalness: 0.6 })
    );
    tierBox.position.set(0, tier * 1.0 + 0.6, bz + 6 + tier * 2.0);
    tierBox.castShadow = true;
    tierBox.receiveShadow = true;
    stadiumGroup.add(tierBox);
  }

  // West Bleachers (Behind Blue Goal)
  for (let tier = 0; tier < 3; tier++) {
    const tierBox = new THREE.Mesh(
      new THREE.BoxGeometry(2.5, 1.2, bz * 2.2),
      new THREE.MeshStandardMaterial({ color: '#0c0d12', roughness: 0.8, metalness: 0.6 })
    );
    tierBox.position.set(-bx - 4 - tier * 2.0, tier * 1.0 + 0.6, 0);
    tierBox.castShadow = true;
    tierBox.receiveShadow = true;
    stadiumGroup.add(tierBox);
  }

  // East Bleachers (Behind Red Goal)
  for (let tier = 0; tier < 3; tier++) {
    const tierBox = new THREE.Mesh(
      new THREE.BoxGeometry(2.5, 1.2, bz * 2.2),
      new THREE.MeshStandardMaterial({ color: '#0c0d12', roughness: 0.8, metalness: 0.6 })
    );
    tierBox.position.set(bx + 4 + tier * 2.0, tier * 1.0 + 0.6, 0);
    tierBox.castShadow = true;
    tierBox.receiveShadow = true;
    stadiumGroup.add(tierBox);
  }

  // 2. Corner Spotlight Towers with Glowing additive light cones
  const buildLightTower = (tx: number, tz: number, isBlue: boolean) => {
    const tower = new THREE.Group();

    // Structural truss pole
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.45, 13, 8),
      new THREE.MeshStandardMaterial({ color: '#2d3748', metalness: 0.8, roughness: 0.25 })
    );
    pillar.position.y = 6.5;
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    tower.add(pillar);

    // Head block for holding floodlight clusters
    const panelMat = new THREE.MeshStandardMaterial({
      color: '#1a202c',
      metalness: 0.9,
      roughness: 0.1,
      emissive: isBlue ? '#00ccff' : '#ff3344',
      emissiveIntensity: 2.2,
    });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.2), panelMat);
    panel.position.set(0, 13, 0);
    panel.rotation.x = Math.PI / 5; // Tilted down
    panel.rotation.y = tx < 0 ? -Math.PI / 4 : Math.PI / 4;
    tower.add(panel);

    // Glowing light panel emitter (white bulb area)
    const emitter = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.8, 0.1),
      new THREE.MeshBasicMaterial({ color: '#ffffff' })
    );
    emitter.position.set(0, 12.9, 0.55);
    emitter.rotation.copy(panel.rotation);
    tower.add(emitter);

    // Volumetric cone effect (Translucent additive blending)
    const coneGeo = new THREE.ConeGeometry(4.0, 18, 16, 1, true);
    coneGeo.translate(0, -9, 0); // rest apex at emitter
    const coneMat = new THREE.MeshBasicMaterial({
      color: isBlue ? '#00e5ff' : '#ff1744',
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(0, 13, 0);

    // Point beam towards center
    cone.lookAt(new THREE.Vector3(tx * 0.5, 0.5, tz * 0.5));
    tower.add(cone);

    tower.position.set(tx, 0, tz);
    return tower;
  };

  stadiumGroup.add(buildLightTower(-bx - 2, -bz - 2, true)); // NW Blue
  stadiumGroup.add(buildLightTower(-bx - 2, bz + 2, true)); // SW Blue
  stadiumGroup.add(buildLightTower(bx + 2, -bz - 2, false)); // NE Red
  stadiumGroup.add(buildLightTower(bx + 2, bz + 2, false)); // SE Red

  // 3. Colossal Floating Central Scoreboard
  const scoreboardBox = new THREE.Group();

  // Steel structural support cables / truss
  const supportTruss = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, 12, 8),
    new THREE.MeshStandardMaterial({ color: '#1e293b', metalness: 0.85, roughness: 0.2 })
  );
  supportTruss.position.set(0, 21, 0);
  scoreboardBox.add(supportTruss);

  // Core score box shape
  const boxFrame = new THREE.Mesh(
    new THREE.BoxGeometry(6.4, 4.0, 6.4),
    new THREE.MeshStandardMaterial({ color: '#090d16', metalness: 0.95, roughness: 0.15 })
  );
  boxFrame.position.set(0, 15, 0);
  boxFrame.castShadow = true;
  boxFrame.receiveShadow = true;
  scoreboardBox.add(boxFrame);

  // Scoreboard upper/lower gold neon trims
  const trimMat = new THREE.MeshStandardMaterial({
    color: '#1a1f2c',
    emissive: '#eab308',
    emissiveIntensity: 2.2,
  });
  const trimTop = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.2, 6.6), trimMat);
  trimTop.position.set(0, 17, 0);
  scoreboardBox.add(trimTop);
  const trimBot = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.2, 6.6), trimMat);
  trimBot.position.set(0, 13, 0);
  scoreboardBox.add(trimBot);

  // Scoreboard Screens
  const screenTexture = generateCustomTexture('stadium_scoreboard_screen', '#06080e');
  const screenMat = new THREE.MeshBasicMaterial({
    map: screenTexture,
    side: THREE.DoubleSide,
  });

  // 4 Scoreboard Screens (facing N, S, E, W)
  const screenN = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.2), screenMat);
  screenN.position.set(0, 15, -3.22);
  screenN.rotation.y = Math.PI;
  scoreboardBox.add(screenN);

  const screenS = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.2), screenMat);
  screenS.position.set(0, 15, 3.22);
  scoreboardBox.add(screenS);

  const screenE = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.2), screenMat);
  screenE.position.set(3.22, 15, 0);
  screenE.rotation.y = Math.PI / 2;
  scoreboardBox.add(screenE);

  const screenW = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.2), screenMat);
  screenW.position.set(-3.22, 15, 0);
  screenW.rotation.y = -Math.PI / 2;
  scoreboardBox.add(screenW);

  stadiumGroup.add(scoreboardBox);

  // 4. Advertising Holographic Billboards (Sapphire Burger & Gauss Soda)
  const buildBillboard = (billboardX: number, billboardZ: number, textureType: string) => {
    const billboard = new THREE.Group();

    // Metallic truss support pillars
    const poleLeft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 12, 8),
      new THREE.MeshStandardMaterial({ color: '#1e293b', metalness: 0.8, roughness: 0.3 })
    );
    poleLeft.position.set(-4.5, 6, 0);
    billboard.add(poleLeft);

    const poleRight = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 12, 8),
      new THREE.MeshStandardMaterial({ color: '#1e293b', metalness: 0.8, roughness: 0.3 })
    );
    poleRight.position.set(4.5, 6, 0);
    billboard.add(poleRight);

    // Screen back board
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(10.4, 5.4, 0.4),
      new THREE.MeshStandardMaterial({ color: '#0f121a', metalness: 0.9, roughness: 0.15 })
    );
    frame.position.set(0, 11, 0);
    billboard.add(frame);

    // Ad Banner Screen mesh
    const adTex = generateCustomTexture(textureType, '#000000');
    const adMat = new THREE.MeshBasicMaterial({
      map: adTex,
      side: THREE.DoubleSide,
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(9.8, 4.8), adMat);
    screen.position.set(0, 11, 0.22);
    billboard.add(screen);

    billboard.position.set(billboardX, 0, billboardZ);
    if (billboardZ < 0) {
      billboard.rotation.y = 0.1; // Angled slightly inside
    } else {
      billboard.rotation.y = Math.PI - 0.1;
    }

    return billboard;
  };

  stadiumGroup.add(buildBillboard(-bx * 0.4, -bz - 8, 'stadium_advertisement_sapphire'));
  stadiumGroup.add(buildBillboard(bx * 0.4, -bz - 8, 'stadium_advertisement_gauss'));
  stadiumGroup.add(buildBillboard(-bx * 0.4, bz + 8, 'stadium_advertisement_gauss'));
  stadiumGroup.add(buildBillboard(bx * 0.4, bz + 8, 'stadium_advertisement_sapphire'));

  // 5. Atmospheric Floating Dust Motes (Glowing energy sparkles in stadium)
  const dustCount = 400;
  const dustGeo = new THREE.BufferGeometry();
  const dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPositions[i * 3] = (Math.random() - 0.5) * activeCustomMap.arenaRadius * 2.8;
    dustPositions[i * 3 + 1] = Math.random() * 12 + 0.1;
    dustPositions[i * 3 + 2] = (Math.random() - 0.5) * activeCustomMap.arenaRadius * 2.0;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dustMat = new THREE.PointsMaterial({
    color: '#eab308',
    size: 0.14,
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.name = 'stadium_dust_particles';
  stadiumGroup.add(dust);

  scene.add(stadiumGroup);
  if (!refs.customMapObjects) refs.customMapObjects = [];
  refs.customMapObjects.push(stadiumGroup);
}

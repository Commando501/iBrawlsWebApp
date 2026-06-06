import * as THREE from 'three';
import { type GrifballThreeRefs } from './threeRefs';

export type DefaultArenaSceneAdminSettings = {
  ambientLightIntensity?: number;
  directLightIntensity?: number;
};

export function buildDefaultArenaSceneForRefs({
  refs,
  isHangar,
  adminSettings,
}: {
  refs: GrifballThreeRefs;
  isHangar: boolean;
  adminSettings: DefaultArenaSceneAdminSettings;
}): void {
  const scene = refs.scene;
  if (!scene) return;

  // Deep slate blue ambient shadow fill
  const ambientColor = isHangar ? '#111827' : '#0a0f1d';
  const ambientLight = new THREE.AmbientLight(
    ambientColor,
    adminSettings.ambientLightIntensity !== undefined
      ? adminSettings.ambientLightIntensity
      : isHangar
        ? 0.65
        : 0.85
  );
  scene.add(ambientLight);
  refs.ambientLight = ambientLight;

  // Warm high-bay directional sun light / cool holodeck directional light
  const dirLightColor = isHangar ? '#fffbeb' : '#e0f2fe';
  const dirLight = new THREE.DirectionalLight(
    dirLightColor,
    adminSettings.directLightIntensity !== undefined ? adminSettings.directLightIntensity : 2.2
  );
  dirLight.position.set(6, 22, 6);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 40;
  dirLight.shadow.camera.left = -22;
  dirLight.shadow.camera.right = 22;
  dirLight.shadow.camera.top = 22;
  dirLight.shadow.camera.bottom = -22;
  dirLight.shadow.bias = -0.0005;
  scene.add(dirLight);
  refs.dirLight = dirLight;

  // Primary warm amber central industrial pendant light / holographic core light
  const pointLightColor = isHangar ? '#ea580c' : '#06b6d4';
  const pointLight = new THREE.PointLight(pointLightColor, 2.5, 35);
  pointLight.position.set(0, 14, 0);
  scene.add(pointLight);

  // Procedural generation of 2048x2048 premium metallic textures
  const texSize = 2048;
  const logicalSize = 1024;
  const scaleFactor = texSize / logicalSize;

  // DIFFUSE/ALBEDO CANVAS
  const diffCanvas = document.createElement('canvas');
  diffCanvas.width = texSize;
  diffCanvas.height = texSize;
  const dCtx = diffCanvas.getContext('2d')!;
  dCtx.scale(scaleFactor, scaleFactor);

  // BUMP MAP CANVAS
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = texSize;
  bumpCanvas.height = texSize;
  const bCtx = bumpCanvas.getContext('2d')!;
  bCtx.scale(scaleFactor, scaleFactor);

  // ROUGHNESS MAP CANVAS
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = texSize;
  roughCanvas.height = texSize;
  const rCtx = roughCanvas.getContext('2d')!;
  rCtx.scale(scaleFactor, scaleFactor);

  if (isHangar) {
    // Fill base layers
    dCtx.fillStyle = '#161a22';
    dCtx.fillRect(0, 0, logicalSize, logicalSize);

    bCtx.fillStyle = '#808080'; // 128 height map baseline
    bCtx.fillRect(0, 0, logicalSize, logicalSize);

    rCtx.fillStyle = '#888888'; // base semi-matte metal
    rCtx.fillRect(0, 0, logicalSize, logicalSize);

    // Draw modular steel plate tiles (16x16 grid)
    const tileSize = 64;
    for (let y = 0; y < logicalSize; y += tileSize) {
      for (let x = 0; x < logicalSize; x += tileSize) {
        // Organic slate color variation per plate
        const hueVal = 216 + Math.random() * 8;
        const satVal = 12 + Math.random() * 6;
        const lightVal = 10 + Math.random() * 5;
        dCtx.fillStyle = `hsl(${hueVal}, ${satVal}%, ${lightVal}%)`;
        dCtx.fillRect(x + 1, y + 1, tileSize - 2, tileSize - 2);

        // Diffuse bevel shadows
        dCtx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        dCtx.lineWidth = 1.5;
        dCtx.beginPath();
        dCtx.moveTo(x + tileSize - 1, y + 1);
        dCtx.lineTo(x + 1, y + 1);
        dCtx.lineTo(x + 1, y + tileSize - 1);
        dCtx.stroke();

        dCtx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
        dCtx.beginPath();
        dCtx.moveTo(x + tileSize - 1, y + 1);
        dCtx.lineTo(x + tileSize - 1, y + tileSize - 1);
        dCtx.lineTo(x + 1, y + tileSize - 1);
        dCtx.stroke();

        // Bump map seams (sunken)
        bCtx.strokeStyle = '#484848';
        bCtx.lineWidth = 2;
        bCtx.strokeRect(x + 0.5, y + 0.5, tileSize - 1, tileSize - 1);

        // Roughness map seams
        rCtx.fillStyle = '#a0a0a0';
        rCtx.fillRect(x, y, tileSize, 1);
        rCtx.fillRect(x, y, 1, tileSize);

        // Add plate corner rivets
        const offsets = [5, tileSize - 5];
        offsets.forEach((ox) => {
          offsets.forEach((oy) => {
            const rx = x + ox;
            const ry = y + oy;

            // Diffuse: shiny metal bolt head
            dCtx.fillStyle = '#374151';
            dCtx.beginPath();
            dCtx.arc(rx, ry, 2.5, 0, Math.PI * 2);
            dCtx.fill();
            dCtx.fillStyle = '#9ca3af';
            dCtx.beginPath();
            dCtx.arc(rx - 0.5, ry - 0.5, 0.8, 0, Math.PI * 2);
            dCtx.fill();

            // Bump map: rivets are raised
            bCtx.fillStyle = '#ffffff';
            bCtx.beginPath();
            bCtx.arc(rx, ry, 2.5, 0, Math.PI * 2);
            bCtx.fill();

            // Roughness map: rivets are polished and highly reflective
            rCtx.fillStyle = '#222222';
            rCtx.beginPath();
            rCtx.arc(rx, ry, 3.0, 0, Math.PI * 2);
            rCtx.fill();
          });
        });
      }
    }

    // Central drainage/ventilation trench grate running along Z-axis (middle X)
    const grateWidth = 96;
    const gxStart = 512 - grateWidth / 2;
    const gxEnd = 512 + grateWidth / 2;

    // Diffuse trench channel
    dCtx.fillStyle = '#090c12';
    dCtx.fillRect(gxStart, 0, grateWidth, logicalSize);

    // Bump trench channel (sunken)
    bCtx.fillStyle = '#101010';
    bCtx.fillRect(gxStart, 0, grateWidth, logicalSize);

    // Roughness trench channel (very rough interior)
    rCtx.fillStyle = '#e2e8f0';
    rCtx.fillRect(gxStart, 0, grateWidth, logicalSize);

    // Frame borders for the trench
    dCtx.fillStyle = '#2d3748';
    dCtx.fillRect(gxStart - 4, 0, 4, logicalSize);
    dCtx.fillRect(gxEnd, 0, 4, logicalSize);

    dCtx.fillStyle = '#4a5568';
    dCtx.fillRect(gxStart - 1, 0, 1, logicalSize);
    dCtx.fillRect(gxEnd + 3, 0, 1, logicalSize);

    bCtx.fillStyle = '#b8b8b8'; // raised frame
    bCtx.fillRect(gxStart - 4, 0, 4, logicalSize);
    bCtx.fillRect(gxEnd, 0, 4, logicalSize);

    // Horizontal steel grate bars
    const barSpacing = 16;
    const barThickness = 6;
    for (let gy = 0; gy < logicalSize; gy += barSpacing) {
      // Diffuse steel bar
      dCtx.fillStyle = '#3f4b5e';
      dCtx.fillRect(gxStart + 4, gy, grateWidth - 8, barThickness);

      dCtx.fillStyle = '#5c6c84'; // bar highlights
      dCtx.fillRect(gxStart + 4, gy, grateWidth - 8, 1.5);

      // Rusty patches on grate bars
      if (Math.random() < 0.45) {
        dCtx.fillStyle = 'rgba(130, 60, 15, 0.5)'; // rust paint
        dCtx.fillRect(gxStart + 4 + Math.random() * (grateWidth - 24), gy + 1, 14, barThickness - 2);
      }

      // Bump: raised bars
      bCtx.fillStyle = '#a8a8a8';
      bCtx.fillRect(gxStart + 4, gy, grateWidth - 8, barThickness);

      // Roughness: slightly reflective
      rCtx.fillStyle = '#475569';
      rCtx.fillRect(gxStart + 4, gy, grateWidth - 8, barThickness);
    }

    // Yellow & Black industrial hazard safety stripes alongside central trench
    const stripeWidth = 16;
    const stripeSpacing = 24;

    const drawHazardStripes = (xStart: number) => {
      // Yellow base
      dCtx.fillStyle = '#ca8a04';
      dCtx.fillRect(xStart, 0, stripeWidth, logicalSize);

      // Black diagonal bands
      dCtx.fillStyle = '#0f172a';
      for (let sy = -stripeWidth; sy < logicalSize; sy += stripeSpacing) {
        dCtx.beginPath();
        dCtx.moveTo(xStart, sy);
        dCtx.lineTo(xStart + stripeWidth, sy + stripeWidth);
        dCtx.lineTo(xStart + stripeWidth, sy + stripeWidth + 10);
        dCtx.lineTo(xStart, sy + 10);
        dCtx.closePath();
        dCtx.fill();
      }

      bCtx.fillStyle = '#808080';
      bCtx.fillRect(xStart, 0, stripeWidth, logicalSize);

      rCtx.fillStyle = '#94a3b8'; // rough warning paint
      rCtx.fillRect(xStart, 0, stripeWidth, logicalSize);
    };

    drawHazardStripes(gxStart - 20);
    drawHazardStripes(gxEnd + 4);

    // Weathering scratches
    for (let i = 0; i < 150; i++) {
      const sx = Math.random() * logicalSize;
      const sy = Math.random() * logicalSize;
      const len = 8 + Math.random() * 25;
      const angle = Math.random() * Math.PI * 2;
      const ex = sx + Math.cos(angle) * len;
      const ey = sy + Math.sin(angle) * len;

      dCtx.strokeStyle = 'rgba(0,0,0,0.3)';
      dCtx.lineWidth = 1.0;
      dCtx.beginPath();
      dCtx.moveTo(sx, sy);
      dCtx.lineTo(ex, ey);
      dCtx.stroke();

      dCtx.strokeStyle = 'rgba(255,255,255,0.06)';
      dCtx.beginPath();
      dCtx.moveTo(sx + 0.5, sy + 0.5);
      dCtx.lineTo(ex + 0.5, ey + 0.5);
      dCtx.stroke();

      bCtx.strokeStyle = '#585858';
      bCtx.lineWidth = 1;
      bCtx.beginPath();
      bCtx.moveTo(sx, sy);
      bCtx.lineTo(ex, ey);
      bCtx.stroke();

      rCtx.strokeStyle = '#111111'; // polished scratches are highly specular
      rCtx.lineWidth = 1;
      rCtx.beginPath();
      rCtx.moveTo(sx, sy);
      rCtx.lineTo(ex, ey);
      rCtx.stroke();
    }

    // Dirt and soot spray overlays
    for (let i = 0; i < 45; i++) {
      const dx = Math.random() * logicalSize;
      const dy = Math.random() * logicalSize;
      const rad = 25 + Math.random() * 75;

      const alGrad = dCtx.createRadialGradient(dx, dy, 0, dx, dy, rad);
      alGrad.addColorStop(0, 'rgba(40, 25, 12, 0.22)');
      alGrad.addColorStop(1, 'rgba(40, 25, 12, 0)');
      dCtx.fillStyle = alGrad;
      dCtx.beginPath();
      dCtx.arc(dx, dy, rad, 0, Math.PI * 2);
      dCtx.fill();

      const roGrad = rCtx.createRadialGradient(dx, dy, 0, dx, dy, rad);
      roGrad.addColorStop(0, 'rgba(200, 200, 200, 0.45)');
      roGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      rCtx.fillStyle = roGrad;
      rCtx.beginPath();
      rCtx.arc(dx, dy, rad, 0, Math.PI * 2);
      rCtx.fill();
    }
  } else {
    // NEON CYAN HOLODECK PROCEDURAL TEXTURES
    // Deep slate space-blue floor
    dCtx.fillStyle = '#0a0f1d';
    dCtx.fillRect(0, 0, logicalSize, logicalSize);

    // Clean height map baseline
    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, logicalSize, logicalSize);

    // Semi-glossy metallic surface roughness
    rCtx.fillStyle = '#333333';
    rCtx.fillRect(0, 0, logicalSize, logicalSize);

    // Draw clean neon cyan virtual space grid
    dCtx.strokeStyle = 'rgba(6, 182, 212, 0.4)'; // cyan
    dCtx.lineWidth = 3;
    const step = 64;
    for (let i = 0; i <= logicalSize; i += step) {
      dCtx.beginPath();
      dCtx.moveTo(i, 0);
      dCtx.lineTo(i, logicalSize);
      dCtx.stroke();

      dCtx.beginPath();
      dCtx.moveTo(0, i);
      dCtx.lineTo(logicalSize, i);
      dCtx.stroke();
    }

    // Draw glowing concentric rings in center
    dCtx.strokeStyle = '#06b6d4';
    dCtx.lineWidth = 10;
    dCtx.beginPath();
    dCtx.arc(512, 512, 160, 0, Math.PI * 2);
    dCtx.stroke();

    dCtx.strokeStyle = 'rgba(6, 182, 212, 0.25)';
    dCtx.lineWidth = 32;
    dCtx.beginPath();
    dCtx.arc(512, 512, 160, 0, Math.PI * 2);
    dCtx.stroke();

    // Outer neon border ring
    dCtx.strokeStyle = '#06b6d4';
    dCtx.lineWidth = 14;
    dCtx.beginPath();
    dCtx.arc(512, 512, 500, 0, Math.PI * 2);
    dCtx.stroke();

    dCtx.strokeStyle = 'rgba(6, 182, 212, 0.3)';
    dCtx.lineWidth = 40;
    dCtx.beginPath();
    dCtx.arc(512, 512, 500, 0, Math.PI * 2);
    dCtx.stroke();

    // Bump map highlights for grid seams
    bCtx.strokeStyle = '#606060';
    bCtx.lineWidth = 3;
    for (let i = 0; i <= logicalSize; i += step) {
      bCtx.strokeRect(i - 1, -1, 2, logicalSize + 2);
      bCtx.strokeRect(-1, i - 1, logicalSize + 2, 2);
    }
  }

  // Create textures
  const floorTexture = new THREE.CanvasTexture(diffCanvas);
  floorTexture.wrapS = THREE.RepeatWrapping;
  floorTexture.wrapT = THREE.RepeatWrapping;

  const floorBumpMap = new THREE.CanvasTexture(bumpCanvas);
  floorBumpMap.wrapS = THREE.RepeatWrapping;
  floorBumpMap.wrapT = THREE.RepeatWrapping;

  const floorRoughnessMap = new THREE.CanvasTexture(roughCanvas);
  floorRoughnessMap.wrapS = THREE.RepeatWrapping;
  floorRoughnessMap.wrapT = THREE.RepeatWrapping;

  // Floor Mesh
  const floorGeo = new THREE.CylinderGeometry(20, 20, 0.2, 64);
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTexture,
    bumpMap: floorBumpMap,
    bumpScale: 0.04,
    roughnessMap: floorRoughnessMap,
    roughness: 1.0,
    metalness: 0.8,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.y = -0.1;
  floor.receiveShadow = true;
  scene.add(floor);

  if (isHangar) {
    // CONTINUOUS PERIMETER WALL ENCLOSURE
    const wallGroup = new THREE.Group();
    wallGroup.name = 'hangarWallGroup';
    scene.add(wallGroup);

    const wallPlateMat = new THREE.MeshStandardMaterial({
      color: '#1e2530', // dark metal plating
      roughness: 0.6,
      metalness: 0.75,
    });

    const trimMat = new THREE.MeshStandardMaterial({
      color: '#92400e', // rusty hazard orange
      roughness: 0.8,
      metalness: 0.4,
    });

    const darkMetalMat = new THREE.MeshStandardMaterial({
      color: '#111827', // frame components
      roughness: 0.9,
      metalness: 0.8,
    });

    // 12 sides wall generation
    const wallRadius = 20.6;
    for (let i = 0; i < 12; i++) {
      const angle = (i * Math.PI) / 6;
      const midAngle = angle + Math.PI / 12;
      const wx = Math.cos(midAngle) * wallRadius;
      const wz = Math.sin(midAngle) * wallRadius;

      const panel = new THREE.Group();
      panel.position.set(wx, 6, wz);

      // Main structural plate (10.68m width spans perfectly between columns)
      const plate = new THREE.Mesh(new THREE.BoxGeometry(10.68, 12, 0.15), wallPlateMat);
      plate.receiveShadow = true;
      plate.castShadow = true;
      panel.add(plate);

      // Rusty horizontal framing rails
      const topRail = new THREE.Mesh(new THREE.BoxGeometry(10.68, 0.3, 0.28), trimMat);
      topRail.position.y = 3.5;
      panel.add(topRail);

      const bottomRail = new THREE.Mesh(new THREE.BoxGeometry(10.68, 0.3, 0.28), trimMat);
      bottomRail.position.y = -3.5;
      panel.add(bottomRail);

      // Central exhaust air vent
      const ventFrame = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 0.2), darkMetalMat);
      ventFrame.position.y = 1.0;
      panel.add(ventFrame);

      const ventSlatGeo = new THREE.BoxGeometry(2.0, 0.1, 0.22);
      for (let vy = 0.4; vy >= -0.4; vy -= 0.25) {
        const slat = new THREE.Mesh(ventSlatGeo, wallPlateMat);
        slat.position.set(0, 1.0 + vy, 0.02);
        slat.rotation.x = 0.3; // tilted ventilation slats
        panel.add(slat);
      }

      // Horizontal metal pipeline running along the wall base
      const pipeGeo = new THREE.CylinderGeometry(0.12, 0.12, 10.68, 8);
      pipeGeo.rotateZ(Math.PI / 2); // orient horizontal
      const conduitPipe = new THREE.Mesh(pipeGeo, darkMetalMat);
      conduitPipe.position.set(0, -2.5, 0.2);
      panel.add(conduitPipe);

      panel.lookAt(0, 6, 0); // rotate to perfectly face arena center
      wallGroup.add(panel);
    }

    // MASSIVE H-BEAM STRUCTURAL SUPPORT COLUMNS (12 pillars)
    const girderMat = new THREE.MeshStandardMaterial({
      color: '#8f4f1f', // rusty industrial orange/brown
      roughness: 0.85,
      metalness: 0.5,
    });

    const steelGreyMat = new THREE.MeshStandardMaterial({
      color: '#374151', // structural steel
      roughness: 0.7,
      metalness: 0.8,
    });

    const pillarLightMat = new THREE.MeshStandardMaterial({
      color: '#f59e0b',
      emissive: '#d97706',
      emissiveIntensity: 1.2,
    });

    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
      const cx = Math.cos(angle) * 20.3;
      const cz = Math.sin(angle) * 20.3;

      const column = new THREE.Group();
      column.position.set(cx, 2, cz);
      column.userData.angle = angle; // Store angle for dynamic scaling relocation!

      // Column structural assembly
      const structGroup = new THREE.Group();
      column.add(structGroup);

      // Heavy base plate
      const basePlate = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 1.5), steelGreyMat);
      basePlate.position.y = -1.85;
      basePlate.receiveShadow = true;
      structGroup.add(basePlate);

      // H-beam Web plate
      const web = new THREE.Mesh(new THREE.BoxGeometry(0.1, 12, 0.8), girderMat);
      web.position.y = 4.0;
      web.castShadow = true;
      web.receiveShadow = true;
      structGroup.add(web);

      // H-beam Flange plates
      const flangeFront = new THREE.Mesh(new THREE.BoxGeometry(0.8, 12, 0.1), girderMat);
      flangeFront.position.set(0, 4.0, 0.4);
      flangeFront.castShadow = true;
      flangeFront.receiveShadow = true;
      structGroup.add(flangeFront);

      const flangeBack = new THREE.Mesh(new THREE.BoxGeometry(0.8, 12, 0.1), girderMat);
      flangeBack.position.set(0, 4.0, -0.4);
      flangeBack.castShadow = true;
      flangeBack.receiveShadow = true;
      structGroup.add(flangeBack);

      // Horizontal reinforcing cuffs
      [0.0, 3.5, 7.0].forEach((cy) => {
        const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.15, 0.95), steelGreyMat);
        cuff.position.y = cy - 1.5;
        structGroup.add(cuff);
      });

      // Energy and Indicator details
      const indicatorGroup = new THREE.Group();
      column.add(indicatorGroup);

      // Glowing dome
      const warningDome = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), pillarLightMat);
      warningDome.position.set(0, 2.5, 0.52);
      indicatorGroup.add(warningDome);

      // PointLight on cross pillars
      if (Math.abs(angle % (Math.PI / 2)) < 0.1) {
        const columnLight = new THREE.PointLight('#f59e0b', 3.0, 16);
        columnLight.position.set(0, 2.5, 0.8);
        indicatorGroup.add(columnLight);
      }

      column.lookAt(0, 2, 0); // Outward facing
      scene.add(column);
    }

    // CEILING TRUSSES & OVERHEAD HEAVY INDUSTRIAL STRUCTURAL GIRDERS
    const girderGroup = new THREE.Group();
    scene.add(girderGroup);

    const gridPositions = [-15, 0, 15];

    // Z-axis spanning girders
    gridPositions.forEach((zOffset) => {
      const truss = new THREE.Group();
      truss.position.set(0, 11, zOffset);

      const topChord = new THREE.Mesh(new THREE.BoxGeometry(50, 0.25, 0.4), girderMat);
      topChord.position.y = 0.5;
      topChord.castShadow = true;
      topChord.receiveShadow = true;
      truss.add(topChord);

      const bottomChord = new THREE.Mesh(new THREE.BoxGeometry(50, 0.25, 0.4), girderMat);
      bottomChord.position.y = -0.5;
      bottomChord.castShadow = true;
      bottomChord.receiveShadow = true;
      truss.add(bottomChord);

      for (let tx = -24; tx <= 24; tx += 4) {
        const dLeft = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.25, 0.3), steelGreyMat);
        dLeft.position.set(tx - 0.9, 0, 0);
        dLeft.rotation.z = Math.PI / 4;
        dLeft.castShadow = true;
        truss.add(dLeft);

        const dRight = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.25, 0.3), steelGreyMat);
        dRight.position.set(tx + 0.9, 0, 0);
        dRight.rotation.z = -Math.PI / 4;
        dRight.castShadow = true;
        truss.add(dRight);
      }
      girderGroup.add(truss);
    });

    // X-axis spanning girders
    gridPositions.forEach((xOffset) => {
      const truss = new THREE.Group();
      truss.position.set(xOffset, 11.2, 0);
      truss.rotation.y = Math.PI / 2;

      const topChord = new THREE.Mesh(new THREE.BoxGeometry(50, 0.25, 0.4), girderMat);
      topChord.position.y = 0.5;
      topChord.castShadow = true;
      topChord.receiveShadow = true;
      truss.add(topChord);

      const bottomChord = new THREE.Mesh(new THREE.BoxGeometry(50, 0.25, 0.4), girderMat);
      bottomChord.position.y = -0.5;
      bottomChord.castShadow = true;
      bottomChord.receiveShadow = true;
      truss.add(bottomChord);

      for (let tz = -24; tz <= 24; tz += 4) {
        const dLeft = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.25, 0.3), steelGreyMat);
        dLeft.position.set(tz - 0.9, 0, 0);
        dLeft.rotation.z = Math.PI / 4;
        dLeft.castShadow = true;
        truss.add(dLeft);

        const dRight = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.25, 0.3), steelGreyMat);
        dRight.position.set(tz + 0.9, 0, 0);
        dRight.rotation.z = -Math.PI / 4;
        dRight.castShadow = true;
        truss.add(dRight);
      }
      girderGroup.add(truss);
    });

    // VOLUMETRIC LIGHT SHAFTS / GOD RAYS
    const rayGroup = new THREE.Group();
    scene.add(rayGroup);

    const rayGeo = new THREE.CylinderGeometry(0.6, 3.8, 25, 16, 1, true);
    const rayMat = new THREE.MeshBasicMaterial({
      color: '#ffdfa9', // warm golden sun rays
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const rayOffsets = [
      { x: -9, z: -9 },
      { x: 5, z: 7 },
      { x: -2, z: 1 },
    ];

    rayOffsets.forEach((offset) => {
      const ray = new THREE.Mesh(rayGeo, rayMat);
      ray.position.set(offset.x + 3.0, 9.5, offset.z + 3.0);
      ray.rotation.x = 0.24;
      ray.rotation.z = -0.24;
      rayGroup.add(ray);
    });
  }
}

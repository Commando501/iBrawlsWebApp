export interface DefaultArenaFloorTextureCanvases {
  diffuse: HTMLCanvasElement;
  bump: HTMLCanvasElement;
  roughness: HTMLCanvasElement;
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function createTextureCanvas(ownerDocument: Document, size: number): HTMLCanvasElement {
  const canvas = ownerDocument.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

export function createDefaultArenaFloorTextureCanvases(
  ownerDocument: Document,
  isHangar: boolean,
  texSize = 2048
): DefaultArenaFloorTextureCanvases {
  const logicalSize = 1024;
  const scaleFactor = texSize / logicalSize;
  const diffuse = createTextureCanvas(ownerDocument, texSize);
  const bump = createTextureCanvas(ownerDocument, texSize);
  const roughness = createTextureCanvas(ownerDocument, texSize);
  const dCtx = diffuse.getContext('2d');
  const bCtx = bump.getContext('2d');
  const rCtx = roughness.getContext('2d');
  if (!dCtx || !bCtx || !rCtx) {
    throw new Error('Unable to create default arena floor texture canvases.');
  }

  dCtx.scale(scaleFactor, scaleFactor);
  bCtx.scale(scaleFactor, scaleFactor);
  rCtx.scale(scaleFactor, scaleFactor);

  const random = createSeededRandom(isHangar ? 0x1a7e_2026 : 0x06b6_d4ff);

  if (isHangar) {
    dCtx.fillStyle = '#161a22';
    dCtx.fillRect(0, 0, logicalSize, logicalSize);

    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, logicalSize, logicalSize);

    rCtx.fillStyle = '#888888';
    rCtx.fillRect(0, 0, logicalSize, logicalSize);

    const tileSize = 64;
    for (let y = 0; y < logicalSize; y += tileSize) {
      for (let x = 0; x < logicalSize; x += tileSize) {
        const hueVal = 216 + random() * 8;
        const satVal = 12 + random() * 6;
        const lightVal = 10 + random() * 5;
        dCtx.fillStyle = `hsl(${hueVal}, ${satVal}%, ${lightVal}%)`;
        dCtx.fillRect(x + 1, y + 1, tileSize - 2, tileSize - 2);

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

        bCtx.strokeStyle = '#484848';
        bCtx.lineWidth = 2;
        bCtx.strokeRect(x + 0.5, y + 0.5, tileSize - 1, tileSize - 1);

        rCtx.fillStyle = '#a0a0a0';
        rCtx.fillRect(x, y, tileSize, 1);
        rCtx.fillRect(x, y, 1, tileSize);

        const offsets = [5, tileSize - 5];
        offsets.forEach((ox) => {
          offsets.forEach((oy) => {
            const rx = x + ox;
            const ry = y + oy;

            dCtx.fillStyle = '#374151';
            dCtx.beginPath();
            dCtx.arc(rx, ry, 2.5, 0, Math.PI * 2);
            dCtx.fill();
            dCtx.fillStyle = '#9ca3af';
            dCtx.beginPath();
            dCtx.arc(rx - 0.5, ry - 0.5, 0.8, 0, Math.PI * 2);
            dCtx.fill();

            bCtx.fillStyle = '#ffffff';
            bCtx.beginPath();
            bCtx.arc(rx, ry, 2.5, 0, Math.PI * 2);
            bCtx.fill();

            rCtx.fillStyle = '#222222';
            rCtx.beginPath();
            rCtx.arc(rx, ry, 3.0, 0, Math.PI * 2);
            rCtx.fill();
          });
        });
      }
    }

    const grateWidth = 96;
    const gxStart = 512 - grateWidth / 2;
    const gxEnd = 512 + grateWidth / 2;

    dCtx.fillStyle = '#090c12';
    dCtx.fillRect(gxStart, 0, grateWidth, logicalSize);

    bCtx.fillStyle = '#101010';
    bCtx.fillRect(gxStart, 0, grateWidth, logicalSize);

    rCtx.fillStyle = '#e2e8f0';
    rCtx.fillRect(gxStart, 0, grateWidth, logicalSize);

    dCtx.fillStyle = '#2d3748';
    dCtx.fillRect(gxStart - 4, 0, 4, logicalSize);
    dCtx.fillRect(gxEnd, 0, 4, logicalSize);

    dCtx.fillStyle = '#4a5568';
    dCtx.fillRect(gxStart - 1, 0, 1, logicalSize);
    dCtx.fillRect(gxEnd + 3, 0, 1, logicalSize);

    bCtx.fillStyle = '#b8b8b8';
    bCtx.fillRect(gxStart - 4, 0, 4, logicalSize);
    bCtx.fillRect(gxEnd, 0, 4, logicalSize);

    const barSpacing = 16;
    const barThickness = 6;
    for (let gy = 0; gy < logicalSize; gy += barSpacing) {
      dCtx.fillStyle = '#3f4b5e';
      dCtx.fillRect(gxStart + 4, gy, grateWidth - 8, barThickness);

      dCtx.fillStyle = '#5c6c84';
      dCtx.fillRect(gxStart + 4, gy, grateWidth - 8, 1.5);

      if (random() < 0.45) {
        dCtx.fillStyle = 'rgba(130, 60, 15, 0.5)';
        dCtx.fillRect(gxStart + 4 + random() * (grateWidth - 24), gy + 1, 14, barThickness - 2);
      }

      bCtx.fillStyle = '#a8a8a8';
      bCtx.fillRect(gxStart + 4, gy, grateWidth - 8, barThickness);

      rCtx.fillStyle = '#475569';
      rCtx.fillRect(gxStart + 4, gy, grateWidth - 8, barThickness);
    }

    const stripeWidth = 16;
    const stripeSpacing = 24;
    const drawHazardStripes = (xStart: number) => {
      dCtx.fillStyle = '#ca8a04';
      dCtx.fillRect(xStart, 0, stripeWidth, logicalSize);

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

      rCtx.fillStyle = '#94a3b8';
      rCtx.fillRect(xStart, 0, stripeWidth, logicalSize);
    };

    drawHazardStripes(gxStart - 20);
    drawHazardStripes(gxEnd + 4);

    for (let i = 0; i < 150; i += 1) {
      const sx = random() * logicalSize;
      const sy = random() * logicalSize;
      const len = 8 + random() * 25;
      const angle = random() * Math.PI * 2;
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

      rCtx.strokeStyle = '#111111';
      rCtx.lineWidth = 1;
      rCtx.beginPath();
      rCtx.moveTo(sx, sy);
      rCtx.lineTo(ex, ey);
      rCtx.stroke();
    }

    for (let i = 0; i < 45; i += 1) {
      const dx = random() * logicalSize;
      const dy = random() * logicalSize;
      const rad = 25 + random() * 75;

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
    dCtx.fillStyle = '#0a0f1d';
    dCtx.fillRect(0, 0, logicalSize, logicalSize);

    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, logicalSize, logicalSize);

    rCtx.fillStyle = '#333333';
    rCtx.fillRect(0, 0, logicalSize, logicalSize);

    dCtx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
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

    bCtx.strokeStyle = '#606060';
    bCtx.lineWidth = 3;
    for (let i = 0; i <= logicalSize; i += step) {
      bCtx.strokeRect(i - 1, -1, 2, logicalSize + 2);
      bCtx.strokeRect(-1, i - 1, logicalSize + 2, 2);
    }
  }

  return { diffuse, bump, roughness };
}

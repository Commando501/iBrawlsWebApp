import React, { useEffect, useRef } from 'react';
import { createDefaultArenaFloorTextureCanvases } from '../grifball/defaultArenaFloorTexture';
import type { CustomMapData, CustomMapObject, ReplayFile } from '../../types';
import { resolveTopDownMapBounds, resolveTopDownPreviewScale, type TopDownMapBounds } from './topDownMapModel';

interface TopDownMapPreviewProps {
  selectedMap: string;
  customMap?: CustomMapData | null;
  replayData?: ReplayFile | null;
  className?: string;
}

type Projector = (x: number, z: number) => { x: number; y: number };

function colorWithAlpha(color: string, alpha: number): string {
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) return color;
  const normalized = hex.length === 3
    ? hex.split('').map((char) => `${char}${char}`).join('')
    : hex;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clampedAlpha})`;
}

function getThemeBaseColor(bounds: TopDownMapBounds): string {
  if (bounds.map?.theme === 'nature') return '#166534';
  if (bounds.map?.theme === 'space') return '#1e1b4b';
  if (bounds.map?.theme === 'fantasy') return '#3b0764';
  if (bounds.map?.theme === 'forerunner') return '#78350f';
  if (bounds.map?.theme === 'synthwave') return '#140e2e';
  if (bounds.map?.theme === 'rainy_streets') return '#111827';
  if (bounds.map?.theme === 'winter_rink') return '#dbeafe';
  if (bounds.map?.theme === 'grifball_stadium') return '#111318';
  if (bounds.mapId === 'hangar') return '#1e293b';
  if (bounds.mapId === 'circle') return '#0f172a';
  return '#111827';
}

function traceArenaPath(ctx: CanvasRenderingContext2D, bounds: TopDownMapBounds, project: Projector): void {
  if (bounds.shape === 'circle') {
    const center = project(0, 0);
    const edge = project(bounds.radius, 0);
    ctx.arc(center.x, center.y, Math.abs(edge.x - center.x), 0, Math.PI * 2);
    return;
  }
  const topLeft = project(-bounds.halfX, -bounds.halfZ);
  const bottomRight = project(bounds.halfX, bounds.halfZ);
  ctx.rect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
}

function drawFloor(ctx: CanvasRenderingContext2D, bounds: TopDownMapBounds, project: Projector): void {
  const topLeft = project(-bounds.halfX, -bounds.halfZ);
  const bottomRight = project(bounds.halfX, bounds.halfZ);
  const arenaWidth = bottomRight.x - topLeft.x;
  const arenaHeight = bottomRight.y - topLeft.y;

  ctx.save();
  ctx.beginPath();
  traceArenaPath(ctx, bounds, project);
  ctx.clip();

  if (!bounds.map && (bounds.mapId === 'hangar' || bounds.mapId === 'circle')) {
    const atlas = createDefaultArenaFloorTextureCanvases(ctx.canvas.ownerDocument, bounds.mapId === 'hangar', 1024).diffuse;
    ctx.drawImage(atlas, topLeft.x, topLeft.y, arenaWidth, arenaHeight);
  } else {
    ctx.fillStyle = getThemeBaseColor(bounds);
    ctx.fillRect(topLeft.x, topLeft.y, arenaWidth, arenaHeight);
    ctx.strokeStyle = bounds.map?.theme === 'synthwave' ? 'rgba(34,211,238,0.40)' : 'rgba(226,232,240,0.16)';
    ctx.lineWidth = 1;
    const grid = Math.max(16, Math.min(arenaWidth, arenaHeight) / 8);
    for (let x = topLeft.x; x <= bottomRight.x; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, topLeft.y);
      ctx.lineTo(x, bottomRight.y);
      ctx.stroke();
    }
    for (let y = topLeft.y; y <= bottomRight.y; y += grid) {
      ctx.beginPath();
      ctx.moveTo(topLeft.x, y);
      ctx.lineTo(bottomRight.x, y);
      ctx.stroke();
    }
  }

  const center = project(0, 0);
  const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, Math.max(arenaWidth, arenaHeight) * 0.58);
  gradient.addColorStop(0, 'rgba(255,255,255,0.05)');
  gradient.addColorStop(1, 'rgba(2,6,23,0.74)');
  ctx.fillStyle = gradient;
  ctx.fillRect(topLeft.x, topLeft.y, arenaWidth, arenaHeight);
  ctx.restore();
}

function drawObject(ctx: CanvasRenderingContext2D, object: CustomMapObject, project: Projector, scale: number): void {
  if (object.hidden) return;
  const center = project(object.position.x, object.position.z);
  const width = Math.max(2, Math.abs(object.scale.x) * scale);
  const depth = Math.max(2, Math.abs(object.scale.z) * scale);
  const isGoal = object.goalPlateTeam || object.texture === 'goal_plate_blue' || object.texture === 'goal_plate_red';
  const teamColor = object.goalPlateTeam === 'red' || object.texture === 'goal_plate_red' ? '#fb7185' : '#60a5fa';
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(-(object.rotation?.y ?? 0));
  ctx.fillStyle = isGoal
    ? colorWithAlpha(teamColor, 0.46)
    : colorWithAlpha(object.color || '#334155', object.transparent ? 0.38 : 0.68);
  ctx.strokeStyle = object.emissive && object.emissive !== '#000000'
    ? colorWithAlpha(object.emissive, 0.7)
    : isGoal
      ? colorWithAlpha(teamColor, 0.88)
      : 'rgba(226,232,240,0.32)';
  ctx.lineWidth = object.floorTile ? 1 : 1.4;
  if (object.type === 'sphere' || object.type === 'cylinder') {
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(width, depth) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(-width / 2, -depth / 2, width, depth);
    ctx.strokeRect(-width / 2, -depth / 2, width, depth);
  }
  ctx.restore();
}

function drawSpawns(ctx: CanvasRenderingContext2D, bounds: TopDownMapBounds, project: Projector, scale: number): void {
  if (!bounds.map) return;
  const drawMarker = (spawn: { x: number; z: number; yaw?: number }, color: string) => {
    const p = project(spawn.x, spawn.z);
    const radius = Math.max(4, 0.35 * scale);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-(spawn.yaw ?? 0));
    ctx.fillStyle = colorWithAlpha(color, 0.24);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -radius * 1.6);
    ctx.lineTo(radius * 1.25, radius * 1.2);
    ctx.lineTo(-radius * 1.25, radius * 1.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
  bounds.map.spawnPoints?.forEach((spawn) => drawMarker(spawn, '#e5e7eb'));
  bounds.map.teamSpawns?.blue?.forEach((spawn) => drawMarker(spawn, '#60a5fa'));
  bounds.map.teamSpawns?.red?.forEach((spawn) => drawMarker(spawn, '#fb7185'));
}

function drawMap(canvas: HTMLCanvasElement, props: TopDownMapPreviewProps): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, width, height);

  const bounds = resolveTopDownMapBounds(props);
  const padding = 18;
  const scale = resolveTopDownPreviewScale({
    width,
    height,
    padding,
    halfX: bounds.halfX,
    halfZ: bounds.halfZ,
  });
  const project: Projector = (x, z) => ({
    x: width / 2 + x * scale,
    y: height / 2 + z * scale,
  });

  drawFloor(ctx, bounds, project);
  const objects = (bounds.map?.objects ?? []).filter((object) => !object.hidden);
  objects.filter((object) => object.floorTile || object.goalPlateTeam).forEach((object) => drawObject(ctx, object, project, scale));
  ctx.save();
  ctx.strokeStyle = 'rgba(226,232,240,0.72)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  traceArenaPath(ctx, bounds, project);
  ctx.stroke();
  ctx.restore();
  objects.filter((object) => !object.floorTile && !object.goalPlateTeam).forEach((object) => drawObject(ctx, object, project, scale));
  drawSpawns(ctx, bounds, project, scale);
}

export const TopDownMapPreview: React.FC<TopDownMapPreviewProps> = (props) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = () => drawMap(canvas, props);
    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [props.selectedMap, props.customMap, props.replayData]);

  return (
    <div className={`relative overflow-hidden rounded border border-cyan-400/20 bg-slate-950 shadow-inner ${props.className ?? ''}`}>
      <canvas ref={canvasRef} className="block h-full w-full" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_48%,rgba(2,6,23,0.72))]" />
      <div className="pointer-events-none absolute inset-0 border border-white/5" />
    </div>
  );
};

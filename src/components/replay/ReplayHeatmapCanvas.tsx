import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getRectHalfExtents } from '../../game/arenaDimensions';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import { createDefaultArenaFloorTextureCanvases } from '../grifball/defaultArenaFloorTexture';
import {
  type CustomMapData,
  type CustomMapObject,
  type ReplayFile,
  type ReplayHeatmapEvent,
  type ReplayHeatmapEventKind,
  type ReplayHeatmapTeam,
} from '../../types';

export interface ReplayHeatmapFilters {
  kills: boolean;
  deaths: boolean;
  medals: boolean;
}

export const DEFAULT_REPLAY_HEATMAP_FILTERS: ReplayHeatmapFilters = {
  kills: true,
  deaths: true,
  medals: true,
};

export function replayHasHeatmapEvents(replay: ReplayFile | null | undefined): boolean {
  return Boolean(replay?.heatmap?.events?.length);
}

export function getVisibleReplayHeatmapEvents({
  replay,
  time,
  filters = DEFAULT_REPLAY_HEATMAP_FILTERS,
}: {
  replay: ReplayFile | null | undefined;
  time?: number;
  filters?: ReplayHeatmapFilters;
}): ReplayHeatmapEvent[] {
  const events = replay?.heatmap?.events ?? [];
  const maxTime = typeof time === 'number' && Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
  return events.filter((event) => {
    if (event.time > maxTime) return false;
    if (event.kind === 'kill') return filters.kills;
    if (event.kind === 'death') return filters.deaths;
    if (event.kind === 'medal') return filters.medals;
    return false;
  });
}

interface ReplayHeatmapCanvasProps {
  replay: ReplayFile | null;
  time?: number;
  className?: string;
  style?: React.CSSProperties;
  mode?: 'preview' | 'panel' | 'theater';
  showControls?: boolean;
}

interface MapBounds {
  shape: 'circle' | 'rectangular';
  radius: number;
  halfX: number;
  halfZ: number;
  map?: CustomMapData | null;
  mapId: string;
}

type Projector = (x: number, z: number) => { x: number; y: number };

const DEFAULT_ARENA_RADIUS = 20;
const defaultArenaFloorAtlasCache = new WeakMap<Document, Map<string, HTMLCanvasElement>>();
const EVENT_COLORS: Record<ReplayHeatmapEventKind, string> = {
  kill: '#f97316',
  death: '#ef4444',
  medal: '#22d3ee',
};

const TEAM_STROKES: Record<string, string> = {
  blue: '#60a5fa',
  red: '#fb7185',
  unknown: '#e5e7eb',
};

function resolveStoredMap(mapId: string): CustomMapData | null {
  const premade = PREMADE_MAPS.find((map) => map.id === mapId);
  if (premade) return premade;
  if (typeof localStorage === 'undefined') return null;
  const stored = localStorage.getItem(`map_${mapId}`);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as CustomMapData;
  } catch {
    return null;
  }
}

function resolveMapBounds(replay: ReplayFile | null): MapBounds {
  const mapId = String(replay?.mapType ?? 'hangar');
  const customMap =
    mapId !== 'hangar' && mapId !== 'rectangular' && mapId !== 'circle'
      ? resolveStoredMap(mapId)
      : null;

  if (customMap) {
    const shape = customMap.mapShape === 'circle' ? 'circle' : 'rectangular';
    const extents = getRectHalfExtents(customMap.arenaRadius, customMap.arenaHalfExtents);
    return {
      shape,
      radius: customMap.arenaRadius,
      halfX: shape === 'circle' ? customMap.arenaRadius : extents.x,
      halfZ: shape === 'circle' ? customMap.arenaRadius : extents.z,
      map: customMap,
      mapId,
    };
  }

  if (mapId === 'circle' || mapId === 'hangar') {
    return {
      shape: 'circle',
      radius: DEFAULT_ARENA_RADIUS,
      halfX: DEFAULT_ARENA_RADIUS,
      halfZ: DEFAULT_ARENA_RADIUS,
      map: null,
      mapId,
    };
  }

  const extents = getRectHalfExtents(DEFAULT_ARENA_RADIUS);
  return {
    shape: 'rectangular',
    radius: DEFAULT_ARENA_RADIUS,
    halfX: extents.x,
    halfZ: extents.z,
    map: null,
    mapId,
  };
}

function getEventColor(event: ReplayHeatmapEvent): string {
  if (event.kind === 'medal' && event.medalColor) return event.medalColor;
  return EVENT_COLORS[event.kind];
}

function getTeamStroke(team: ReplayHeatmapTeam): string {
  return TEAM_STROKES[String(team)] ?? '#f8fafc';
}

function colorWithAlpha(color: string, alpha: number): string {
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex) {
    const normalized =
      hex.length === 3
        ? hex.split('').map((char) => `${char}${char}`).join('')
        : hex;
    const r = Number.parseInt(normalized.slice(0, 2), 16);
    const g = Number.parseInt(normalized.slice(2, 4), 16);
    const b = Number.parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${clampedAlpha})`;
  }

  const rgb = color.trim().match(/^rgb\(\s*([^)]+?)\s*\)$/i)?.[1];
  if (rgb) return `rgba(${rgb}, ${clampedAlpha})`;

  const rgba = color.trim().match(/^rgba\(\s*([^)]+?)\s*\)$/i)?.[1];
  if (rgba) {
    const parts = rgba.split(',').map((part) => part.trim());
    if (parts.length >= 3) return `rgba(${parts.slice(0, 3).join(', ')}, ${clampedAlpha})`;
  }

  return color;
}

function getTextureBaseColor(texture: string | undefined, fallback: string): string {
  if (texture === 'goal_plate_blue') return '#1d4ed8';
  if (texture === 'goal_plate_red') return '#be123c';
  if (!texture || texture === 'none') return fallback;
  if (texture.includes('nature')) return '#166534';
  if (texture.includes('wood')) return '#854d0e';
  if (texture.includes('space')) return '#1f2937';
  if (texture.includes('futuristic')) return '#0f172a';
  if (texture.includes('city') || texture.includes('rainy_streets')) return '#1f2937';
  if (texture.includes('fantasy')) return '#44403c';
  if (texture.includes('forerunner')) return '#92400e';
  if (texture.includes('synthwave')) return '#140e2e';
  if (texture.includes('winter')) return '#bae6fd';
  if (texture.includes('stadium')) return '#334155';
  return fallback;
}

function getArenaTexture(bounds: MapBounds): string {
  if (bounds.map?.theme === 'nature') return 'nature_grass';
  if (bounds.map?.theme === 'space') return 'space_alloy';
  if (bounds.map?.theme === 'fantasy') return 'fantasy_cobble';
  if (bounds.map?.theme === 'forerunner') return 'forerunner_panel';
  if (bounds.map?.theme === 'synthwave') return 'synthwave_grid';
  if (bounds.map?.theme === 'rainy_streets') return 'rainy_streets_asphalt';
  if (bounds.map?.theme === 'winter_rink') return 'winter_ice';
  if (bounds.map?.theme === 'grifball_stadium') return 'stadium_steel_grid';
  if (bounds.map?.theme === 'cyberpunk' || bounds.map?.theme === 'holodeck') return 'futuristic_hex';
  if (bounds.map?.theme === 'rust') return 'space_meteorite';
  if (bounds.mapId === 'circle') return 'futuristic_hex';
  return 'futuristic_carbon';
}

function isDefaultArenaMap(bounds: MapBounds): boolean {
  return !bounds.map && (bounds.mapId === 'circle' || bounds.mapId === 'hangar');
}

function getDefaultArenaFloorAtlas(
  ownerDocument: Document,
  isHangar: boolean
): HTMLCanvasElement {
  const cacheKey = isHangar ? 'hangar' : 'circle';
  let documentCache = defaultArenaFloorAtlasCache.get(ownerDocument);
  if (!documentCache) {
    documentCache = new Map<string, HTMLCanvasElement>();
    defaultArenaFloorAtlasCache.set(ownerDocument, documentCache);
  }

  const cached = documentCache.get(cacheKey);
  if (cached) return cached;

  const atlas = createDefaultArenaFloorTextureCanvases(ownerDocument, isHangar, 1024).diffuse;
  documentCache.set(cacheKey, atlas);
  return atlas;
}

function createTexturePattern(
  ctx: CanvasRenderingContext2D,
  texture: string | undefined,
  baseColor: string,
  mode: ReplayHeatmapCanvasProps['mode']
): CanvasPattern | string {
  const tileSize = mode === 'preview' ? 28 : 48;
  const tile = ctx.canvas.ownerDocument.createElement('canvas');
  tile.width = tileSize;
  tile.height = tileSize;
  const tctx = tile.getContext('2d');
  if (!tctx) return baseColor;

  const base = getTextureBaseColor(texture, baseColor);
  tctx.fillStyle = colorWithAlpha(base, 0.92);
  tctx.fillRect(0, 0, tileSize, tileSize);
  tctx.lineWidth = 1;

  if (texture === 'synthwave_grid') {
    tctx.strokeStyle = 'rgba(34,211,238,0.55)';
    for (let i = 0; i <= tileSize; i += tileSize / 2) {
      tctx.beginPath();
      tctx.moveTo(i, 0);
      tctx.lineTo(i, tileSize);
      tctx.moveTo(0, i);
      tctx.lineTo(tileSize, i);
      tctx.stroke();
    }
    tctx.strokeStyle = 'rgba(236,72,153,0.45)';
    tctx.beginPath();
    tctx.moveTo(0, tileSize);
    tctx.lineTo(tileSize, 0);
    tctx.stroke();
  } else if (texture?.includes('futuristic') || texture === 'space_alloy' || texture === 'stadium_steel_grid') {
    tctx.strokeStyle = 'rgba(148,163,184,0.34)';
    tctx.strokeRect(0.5, 0.5, tileSize - 1, tileSize - 1);
    tctx.beginPath();
    tctx.moveTo(tileSize / 2, 0);
    tctx.lineTo(tileSize / 2, tileSize);
    tctx.moveTo(0, tileSize / 2);
    tctx.lineTo(tileSize, tileSize / 2);
    tctx.stroke();
    tctx.strokeStyle = 'rgba(34,211,238,0.18)';
    tctx.beginPath();
    tctx.moveTo(0, tileSize);
    tctx.lineTo(tileSize, 0);
    tctx.stroke();
  } else if (texture?.includes('city') || texture?.includes('rainy_streets')) {
    tctx.fillStyle = 'rgba(255,255,255,0.10)';
    for (let i = 0; i < 22; i += 1) {
      tctx.fillRect((i * 13) % tileSize, (i * 23) % tileSize, 1, 1);
    }
    tctx.strokeStyle = 'rgba(250,204,21,0.22)';
    tctx.setLineDash([6, 6]);
    tctx.beginPath();
    tctx.moveTo(0, tileSize / 2);
    tctx.lineTo(tileSize, tileSize / 2);
    tctx.stroke();
    tctx.setLineDash([]);
  } else if (texture?.includes('nature')) {
    tctx.fillStyle = 'rgba(187,247,208,0.22)';
    for (let i = 0; i < 18; i += 1) {
      tctx.beginPath();
      tctx.arc((i * 17) % tileSize, (i * 29) % tileSize, 1.5, 0, Math.PI * 2);
      tctx.fill();
    }
    tctx.strokeStyle = 'rgba(21,128,61,0.34)';
    tctx.beginPath();
    tctx.moveTo(0, tileSize * 0.75);
    tctx.quadraticCurveTo(tileSize * 0.5, tileSize * 0.15, tileSize, tileSize * 0.65);
    tctx.stroke();
  } else if (texture?.includes('wood')) {
    tctx.strokeStyle = 'rgba(120,53,15,0.45)';
    for (let i = 4; i < tileSize; i += 9) {
      tctx.beginPath();
      tctx.moveTo(0, i);
      tctx.bezierCurveTo(tileSize * 0.25, i - 5, tileSize * 0.65, i + 5, tileSize, i);
      tctx.stroke();
    }
  } else if (texture?.includes('fantasy') || texture?.includes('forerunner')) {
    tctx.strokeStyle = texture?.includes('forerunner') ? 'rgba(251,191,36,0.36)' : 'rgba(214,211,209,0.25)';
    tctx.strokeRect(4, 4, tileSize - 8, tileSize - 8);
    tctx.beginPath();
    tctx.moveTo(tileSize / 2, 4);
    tctx.lineTo(tileSize - 4, tileSize / 2);
    tctx.lineTo(tileSize / 2, tileSize - 4);
    tctx.lineTo(4, tileSize / 2);
    tctx.closePath();
    tctx.stroke();
  } else if (texture?.includes('winter')) {
    tctx.fillStyle = 'rgba(255,255,255,0.32)';
    tctx.fillRect(0, 0, tileSize, tileSize);
    tctx.strokeStyle = 'rgba(14,165,233,0.25)';
    tctx.beginPath();
    tctx.moveTo(3, tileSize * 0.7);
    tctx.lineTo(tileSize * 0.35, tileSize * 0.38);
    tctx.lineTo(tileSize * 0.62, tileSize * 0.55);
    tctx.lineTo(tileSize - 3, tileSize * 0.22);
    tctx.stroke();
  } else if (texture === 'goal_plate_blue' || texture === 'goal_plate_red') {
    const glow = texture === 'goal_plate_blue' ? 'rgba(96,165,250,0.72)' : 'rgba(251,113,133,0.72)';
    tctx.fillStyle = glow;
    tctx.fillRect(0, 0, tileSize, tileSize);
    tctx.strokeStyle = 'rgba(255,255,255,0.42)';
    for (let i = -tileSize; i < tileSize * 2; i += 10) {
      tctx.beginPath();
      tctx.moveTo(i, tileSize);
      tctx.lineTo(i + tileSize, 0);
      tctx.stroke();
    }
  } else {
    tctx.strokeStyle = 'rgba(148,163,184,0.18)';
    tctx.strokeRect(0.5, 0.5, tileSize - 1, tileSize - 1);
  }

  return ctx.createPattern(tile, 'repeat') ?? baseColor;
}

function traceArenaPath(ctx: CanvasRenderingContext2D, bounds: MapBounds, project: Projector): void {
  if (bounds.shape === 'circle') {
    const center = project(0, 0);
    ctx.arc(center.x, center.y, bounds.radius * Math.min(
      Math.abs(project(1, 0).x - project(0, 0).x),
      Math.abs(project(0, 1).y - project(0, 0).y)
    ), 0, Math.PI * 2);
    return;
  }

  const topLeft = project(-bounds.halfX, -bounds.halfZ);
  const bottomRight = project(bounds.halfX, bounds.halfZ);
  ctx.rect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
}

function drawTexturedArenaFloor({
  ctx,
  bounds,
  project,
  mode,
}: {
  ctx: CanvasRenderingContext2D;
  bounds: MapBounds;
  project: Projector;
  mode: ReplayHeatmapCanvasProps['mode'];
}): void {
  const topLeft = project(-bounds.halfX, -bounds.halfZ);
  const bottomRight = project(bounds.halfX, bounds.halfZ);
  const arenaWidth = bottomRight.x - topLeft.x;
  const arenaHeight = bottomRight.y - topLeft.y;
  const floorTexture = getArenaTexture(bounds);

  ctx.save();
  ctx.beginPath();
  traceArenaPath(ctx, bounds, project);
  ctx.clip();
  if (isDefaultArenaMap(bounds)) {
    const atlas = getDefaultArenaFloorAtlas(ctx.canvas.ownerDocument, bounds.mapId === 'hangar');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(atlas, topLeft.x, topLeft.y, arenaWidth, arenaHeight);
  } else {
    ctx.fillStyle = createTexturePattern(ctx, floorTexture, '#0f172a', mode);
    ctx.fillRect(topLeft.x, topLeft.y, arenaWidth, arenaHeight);
  }

  const center = project(0, 0);
  const edgeGradient = ctx.createRadialGradient(
    center.x,
    center.y,
    0,
    center.x,
    center.y,
    Math.max(arenaWidth, arenaHeight) * 0.58
  );
  edgeGradient.addColorStop(0, 'rgba(255,255,255,0.04)');
  edgeGradient.addColorStop(1, 'rgba(2,6,23,0.68)');
  ctx.fillStyle = edgeGradient;
  ctx.fillRect(topLeft.x, topLeft.y, arenaWidth, arenaHeight);
  ctx.restore();
}

function drawLegacyFallbackGrid(
  ctx: CanvasRenderingContext2D,
  bounds: MapBounds,
  project: Projector
) {
  if (isDefaultArenaMap(bounds) || bounds.map) return;

  ctx.save();
  ctx.beginPath();
  traceArenaPath(ctx, bounds, project);
  ctx.clip();
  ctx.strokeStyle = 'rgba(226,232,240,0.12)';
  ctx.lineWidth = 1;
  const gridStep = 5;
  for (let x = Math.ceil(-bounds.halfX / gridStep) * gridStep; x <= bounds.halfX; x += gridStep) {
    const a = project(x, -bounds.halfZ);
    const b = project(x, bounds.halfZ);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (let z = Math.ceil(-bounds.halfZ / gridStep) * gridStep; z <= bounds.halfZ; z += gridStep) {
    const a = project(-bounds.halfX, z);
    const b = project(bounds.halfX, z);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

function getObjectTeam(object: CustomMapObject): ReplayHeatmapTeam {
  if (object.goalPlateTeam) return object.goalPlateTeam;
  if (object.texture === 'goal_plate_blue') return 'blue';
  if (object.texture === 'goal_plate_red') return 'red';
  return object.team ?? 'unknown';
}

function getObjectFill(object: CustomMapObject): string {
  const team = getObjectTeam(object);
  if (team === 'blue') return 'rgba(37,99,235,0.56)';
  if (team === 'red') return 'rgba(190,18,60,0.56)';
  const opacity = object.transparent ? Math.min(0.55, object.opacity ?? 0.45) : Math.max(0.36, Math.min(0.78, object.opacity ?? 0.66));
  return colorWithAlpha(object.color || '#334155', opacity);
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  object: CustomMapObject,
  project: Projector,
  scale: number,
  mode: ReplayHeatmapCanvasProps['mode']
) {
  if (object.hidden) return;
  const center = project(object.position.x, object.position.z);
  const width = Math.max(2, Math.abs(object.scale.x) * scale);
  const depth = Math.max(2, Math.abs(object.scale.z) * scale);
  const team = getObjectTeam(object);
  const objectFill = object.floorTile || object.goalPlateTeam
    ? createTexturePattern(ctx, object.texture, object.color || '#334155', mode)
    : getObjectFill(object);

  ctx.save();
  ctx.strokeStyle = team === 'blue'
    ? 'rgba(96,165,250,0.55)'
    : team === 'red'
      ? 'rgba(251,113,133,0.55)'
      : object.emissive && object.emissive !== '#000000'
        ? colorWithAlpha(object.emissive, 0.62)
        : 'rgba(226,232,240,0.30)';
  ctx.fillStyle = objectFill;
  ctx.lineWidth = object.floorTile ? 0.75 : 1.35;

  if (object.type === 'cylinder' || object.type === 'sphere') {
    ctx.translate(center.x, center.y);
    ctx.rotate(-(object.rotation?.y ?? 0));
    ctx.beginPath();
    ctx.ellipse(0, 0, width / 2, depth / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.translate(center.x, center.y);
    ctx.rotate(-(object.rotation?.y ?? 0));
    ctx.fillRect(-width / 2, -depth / 2, width, depth);
    ctx.strokeRect(-width / 2, -depth / 2, width, depth);

    if (!object.floorTile) {
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath();
      ctx.moveTo(-width / 2, -depth / 2);
      ctx.lineTo(width / 2, depth / 2);
      ctx.moveTo(width / 2, -depth / 2);
      ctx.lineTo(-width / 2, depth / 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawSpawnMarkers(
  ctx: CanvasRenderingContext2D,
  bounds: MapBounds,
  project: Projector,
  scale: number,
  mode: ReplayHeatmapCanvasProps['mode']
) {
  if (!bounds.map) return;
  const markerRadius = mode === 'preview' ? 2.4 : 4.2;
  const drawMarker = (
    spawn: { x: number; z: number; yaw?: number },
    team: ReplayHeatmapTeam
  ) => {
    const p = project(spawn.x, spawn.z);
    const yaw = spawn.yaw ?? 0;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-yaw);
    ctx.fillStyle = colorWithAlpha(getTeamStroke(team), 0.24);
    ctx.strokeStyle = getTeamStroke(team);
    ctx.lineWidth = mode === 'preview' ? 1 : 1.35;
    ctx.beginPath();
    ctx.moveTo(0, -markerRadius * 1.8);
    ctx.lineTo(markerRadius * 1.35, markerRadius * 1.3);
    ctx.lineTo(-markerRadius * 1.35, markerRadius * 1.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };

  bounds.map.spawnPoints?.forEach((spawn) => drawMarker(spawn, 'unknown'));
  Object.entries(bounds.map.teamSpawns ?? {}).forEach(([team, spawns]) => {
    spawns.forEach((spawn) => drawMarker(spawn, team === 'blue' || team === 'red' ? team : 'unknown'));
  });

  const center = project(0, 0);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.24)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(center.x, center.y, Math.max(3, 0.4 * scale), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawTeamGlyph(
  ctx: CanvasRenderingContext2D,
  team: ReplayHeatmapTeam,
  x: number,
  y: number,
  radius: number
) {
  if (team === 'red') {
    ctx.moveTo(x, y - radius);
    ctx.lineTo(x + radius, y);
    ctx.lineTo(x, y + radius);
    ctx.lineTo(x - radius, y);
    ctx.closePath();
    return;
  }
  if (team === 'blue') {
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    return;
  }
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x + radius, y + radius);
  ctx.lineTo(x - radius, y + radius);
  ctx.closePath();
}

function drawHeatmap({
  canvas,
  replay,
  events,
  mode,
}: {
  canvas: HTMLCanvasElement;
  replay: ReplayFile | null;
  events: ReplayHeatmapEvent[];
  mode: ReplayHeatmapCanvasProps['mode'];
}) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const bounds = resolveMapBounds(replay);
  const padding = mode === 'preview' ? 10 : 22;
  const scale = Math.min(
    (width - padding * 2) / Math.max(1, bounds.halfX * 2),
    (height - padding * 2) / Math.max(1, bounds.halfZ * 2)
  );
  const project = (x: number, z: number) => ({
    x: width / 2 + x * scale,
    y: height / 2 + z * scale,
  });

  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, width, height);

  drawTexturedArenaFloor({ ctx, bounds, project, mode });

  const mapObjects = (bounds.map?.objects ?? []).filter((object) => !object.hidden);
  for (const object of mapObjects.filter((object) => object.floorTile || object.goalPlateTeam)) {
    drawObject(ctx, object, project, scale, mode);
  }

  drawLegacyFallbackGrid(ctx, bounds, project);

  ctx.save();
  ctx.strokeStyle = 'rgba(226,232,240,0.68)';
  ctx.lineWidth = mode === 'preview' ? 1 : 1.5;
  if (bounds.shape === 'circle') {
    const center = project(0, 0);
    ctx.beginPath();
    ctx.arc(center.x, center.y, bounds.radius * scale, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    const topLeft = project(-bounds.halfX, -bounds.halfZ);
    const bottomRight = project(bounds.halfX, bounds.halfZ);
    ctx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  }
  ctx.restore();

  for (const object of mapObjects.filter((object) => !object.floorTile && !object.goalPlateTeam)) {
    drawObject(ctx, object, project, scale, mode);
  }
  drawSpawnMarkers(ctx, bounds, project, scale, mode);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const event of events) {
    const p = project(event.position.x, event.position.z);
    const radius = mode === 'preview' ? 12 : 22;
    const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
    const color = getEventColor(event);
    gradient.addColorStop(0, colorWithAlpha(color, 0.73));
    gradient.addColorStop(0.38, colorWithAlpha(color, 0.33));
    gradient.addColorStop(1, colorWithAlpha(color, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  for (const event of events) {
    const p = project(event.position.x, event.position.z);
    const r = mode === 'preview' ? 3.2 : 5.2;
    ctx.beginPath();
    drawTeamGlyph(ctx, event.team, p.x, p.y, r);
    ctx.fillStyle = getEventColor(event);
    ctx.strokeStyle = getTeamStroke(event.team);
    ctx.lineWidth = mode === 'preview' ? 1.4 : 2;
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

export const ReplayHeatmapCanvas: React.FC<ReplayHeatmapCanvasProps> = ({
  replay,
  time,
  className = '',
  style,
  mode = 'panel' as ReplayHeatmapCanvasProps['mode'],
  showControls,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [filters, setFilters] = useState<ReplayHeatmapFilters>(DEFAULT_REPLAY_HEATMAP_FILTERS);
  const controlsVisible = showControls ?? mode !== 'preview';
  const hasEvents = replayHasHeatmapEvents(replay);

  const events = useMemo(
    () => getVisibleReplayHeatmapEvents({ replay, time, filters }),
    [replay, time, filters]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = () => drawHeatmap({ canvas, replay, events, mode });
    render();

    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [events, mode, replay]);

  const toggleFilter = (key: keyof ReplayHeatmapFilters) => {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div
      className={`relative w-full h-full min-h-[96px] overflow-hidden rounded-lg border border-white/10 bg-slate-950 ${className}`}
      style={style}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {!hasEvents && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 px-4 text-center">
          <span className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-white/45">
            No heatmap data
          </span>
        </div>
      )}

      {controlsVisible && (
        <div className="absolute left-2 top-2 right-2 flex flex-wrap items-center justify-between gap-2 pointer-events-auto">
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-white/10 bg-black/65 px-2 py-1.5 backdrop-blur">
            {([
              ['kills', 'Kills', EVENT_COLORS.kill],
              ['deaths', 'Deaths', EVENT_COLORS.death],
              ['medals', 'Medals', EVENT_COLORS.medal],
            ] as const).map(([key, label, color]) => (
              <label key={key} className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-white/70">
                <input
                  type="checkbox"
                  checked={filters[key]}
                  onChange={() => toggleFilter(key)}
                  className="h-3 w-3 rounded border-white/20 bg-black accent-cyan-400"
                />
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                {label}
              </label>
            ))}
          </div>

          <div className="rounded-md border border-white/10 bg-black/65 px-2 py-1 text-[9px] font-mono font-black uppercase tracking-wider text-white/50">
            {events.length}/{replay?.heatmap?.events?.length ?? 0}
          </div>
        </div>
      )}

      {controlsVisible && (
        <div className="absolute bottom-2 left-2 rounded-md border border-white/10 bg-black/60 px-2 py-1 text-[8px] font-mono font-bold uppercase tracking-wider text-white/45">
          Blue circle | Red diamond | Unknown triangle
        </div>
      )}
    </div>
  );
};

export default ReplayHeatmapCanvas;

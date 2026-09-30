import type { CustomMapData } from '../types';
import { getRectHalfExtents } from './arenaDimensions';
import type { FieldPoint } from './aiGrifballTeamPlan';

type Blocker = { x: number; z: number } & ({ kind: 'box'; hx: number; hz: number } | { kind: 'circle'; radius: number });
export interface GrifballSpaceGeometry {
  key: string;
  shape: 'rectangular' | 'circle';
  x: number; z: number;
  blockers: Blocker[];
}
export interface SpaceRoute { status: 'direct' | 'routed' | 'blocked'; points: FieldPoint[]; length: number }
export const fieldDistance = (a: FieldPoint, b: FieldPoint) => Math.hypot(a.x - b.x, a.z - b.z);

/** Ground footprints deliberately match mapPhysics: boxes are axis aligned, even when rendered rotated.
 * Platforms needing a jump are blocked. Decorative/non-collidable goal plates remain walkable. */
export function buildGrifballSpaceGeometry(map: CustomMapData | null, radius: number): GrifballSpaceGeometry {
  const r = map?.arenaRadius ?? radius;
  const shape: GrifballSpaceGeometry['shape'] = map?.mapShape === 'rectangular' ? 'rectangular' : 'circle';
  const half = shape === 'rectangular' ? getRectHalfExtents(r, map?.arenaHalfExtents) : { x: r, z: r };
  const blockers: Blocker[] = [];
  for (const obj of map?.objects ?? []) {
    if (!obj.isCollidable) continue;
    const { x, y, z } = obj.position;
    const bottom = y - obj.scale.y / 2, top = y + obj.scale.y / 2;
    if (obj.type === 'sphere') {
      const dy = Math.max(0, -y, y - 2), radius = obj.scale.x / 2 + 0.55;
      if (dy < radius) blockers.push({ kind: 'circle', x, z, radius: Math.sqrt(radius * radius - dy * dy) });
    } else if (bottom <= 1.95 && top >= 0.05) {
      if (obj.type === 'box') blockers.push({ kind: 'box', x, z, hx: obj.scale.x / 2, hz: obj.scale.z / 2 });
      if (obj.type === 'cylinder') blockers.push({ kind: 'circle', x, z, radius: obj.scale.x / 2 + 0.55 });
    }
  }
  const data = { shape, x: half.x - 0.6, z: half.z - 0.6, blockers };
  return { ...data, key: JSON.stringify(data) };
}

export function isSpacePointOpen(g: GrifballSpaceGeometry, p: FieldPoint): boolean {
  if (g.shape === 'circle' ? Math.hypot(p.x, p.z) > g.x + 1e-8 : Math.abs(p.x) > g.x + 1e-8 || Math.abs(p.z) > g.z + 1e-8) return false;
  return !g.blockers.some(b => b.kind === 'box'
    ? Math.hypot(Math.max(0, Math.abs(p.x - b.x) - b.hx), Math.max(0, Math.abs(p.z - b.z) - b.hz)) < 0.55 - 1e-8
    : fieldDistance(p, b) < b.radius - 1e-8);
}

/** Exact segment tests: thin walls cannot be missed by sampling. The arena is convex. */
export function isSpaceSegmentOpen(g: GrifballSpaceGeometry, a: FieldPoint, b: FieldPoint): boolean {
  if (!isSpacePointOpen(g, a) || !isSpacePointOpen(g, b)) return false;
  const dx = b.x - a.x, dz = b.z - a.z;
  const hitsCircle = (x: number, z: number, radius: number) => {
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(a.x + dx * t - x, a.z + dz * t - z) < radius - 1e-8;
  };
  const hitsBox = (x: number, z: number, hx: number, hz: number) => {
    let lo = 0, hi = 1;
    for (const [start, delta, center, half] of [[a.x, dx, x, hx], [a.z, dz, z, hz]]) {
      if (Math.abs(delta) < 1e-9) { if (Math.abs(start - center) >= half - 1e-8) return false; }
      else {
        const p = (center - half - start) / delta, q = (center + half - start) / delta;
        lo = Math.max(lo, Math.min(p, q)); hi = Math.min(hi, Math.max(p, q));
        if (lo >= hi - 1e-9) return false;
      }
    }
    return true;
  };
  return !g.blockers.some(o => {
    const hx = o.kind === 'circle' ? o.radius : o.hx + 0.55;
    const hz = o.kind === 'circle' ? o.radius : o.hz + 0.55;
    if (Math.max(a.x, b.x) < o.x - hx || Math.min(a.x, b.x) > o.x + hx || Math.max(a.z, b.z) < o.z - hz || Math.min(a.z, b.z) > o.z + hz) return false;
    if (o.kind === 'circle') return hitsCircle(o.x, o.z, o.radius);
    if (hitsBox(o.x, o.z, o.hx + 0.55, o.hz) || hitsBox(o.x, o.z, o.hx, o.hz + 0.55)) return true;
    for (const x of [-1, 1]) for (const z of [-1, 1]) if (hitsCircle(o.x + x * o.hx, o.z + z * o.hz, 0.55)) return true;
    return false;
  });
}

interface Grid { points: FieldPoint[]; edges: { to: number; cost: number }[][]; step: number; cells: Map<string, number> }
// Static geometry only; moving observations and search results are never retained here.
const grids = new Map<string, Grid>();
function getGrid(g: GrifballSpaceGeometry): Grid {
  const cached = grids.get(g.key); if (cached) return cached;
  const step = Math.max(1, Math.max(g.x, g.z) / 30);
  const points: FieldPoint[] = [], edges: Grid['edges'] = [], cells = new Map<string, number>();
  const nx = Math.floor(2 * g.x / step), nz = Math.floor(2 * g.z / step);
  for (let x = 0; x <= nx; x++) for (let z = 0; z <= nz; z++) {
    const point = { x: -g.x + x * step, z: -g.z + z * step };
    if (isSpacePointOpen(g, point)) { cells.set(`${x},${z}`, points.length); points.push(point); edges.push([]); }
  }
  for (const [cell, index] of cells) {
    const [x, z] = cell.split(',').map(Number);
    for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const to = cells.get(`${x + dx},${z + dz}`);
      if (to === undefined || !isSpaceSegmentOpen(g, points[index], points[to])) continue;
      const cost = fieldDistance(points[index], points[to]);
      edges[index].push({ to, cost }); edges[to].push({ to: index, cost });
    }
  }
  const grid = { points, edges, step, cells };
  if (grids.size >= 4) grids.delete(grids.keys().next().value!);
  grids.set(g.key, grid); return grid;
}

type GridLink = { to: number; cost: number };
type EndpointLinks = (grid: Grid, point: FieldPoint) => readonly GridLink[];

/** Share endpoint visibility and distances across players in one planning refresh.
 * Geometry is immutable for this factory's lifetime. No threats or routes are cached. */
export function createSpaceRouterFactory(g: GrifballSpaceGeometry) {
  // Prepare immutable navigation before the first obstructed query. Deferring
  // this until players reach a wall creates a cold-build hitch mid-match.
  // Open convex arenas need no grid because every legal segment is direct.
  if (g.blockers.length) getGrid(g);
  const endpoints = new Map<string, readonly GridLink[]>();
  const links: EndpointLinks = (grid, p) => {
    const key = `${p.x},${p.z}`;
    const cached = endpoints.get(key);
    if (cached) return cached;
    const result: GridLink[] = [], cx = Math.floor((p.x + g.x) / grid.step), cz = Math.floor((p.z + g.z) / grid.step);
    for (let x = cx - 2; x <= cx + 2; x++) for (let z = cz - 2; z <= cz + 2; z++) {
      const to = grid.cells.get(`${x},${z}`);
      if (to === undefined) continue;
      const cost = fieldDistance(p, grid.points[to]);
      if (cost <= grid.step * 2 && isSpaceSegmentOpen(g, p, grid.points[to])) result.push({ to, cost });
    }
    // Bound retention even if a caller keeps the factory beyond a planning refresh.
    if (endpoints.size >= 2048) endpoints.delete(endpoints.keys().next().value!);
    endpoints.set(key, result);
    return result;
  };
  return (start: FieldPoint) => createRouter(g, { ...start }, links);
}

/** One bounded search per observed player, reused for every candidate this planning tick.
 * Coarse passages may be conservatively rejected; failure NEVER becomes a direct route. */
export function createSpaceRouter(g: GrifballSpaceGeometry, start: FieldPoint): (end: FieldPoint, distanceOnly?: boolean) => SpaceRoute {
  return createSpaceRouterFactory(g)(start);
}

function createRouter(g: GrifballSpaceGeometry, start: FieldPoint, links: EndpointLinks): ReturnType<typeof createSpaceRouter> {
  let search: { grid: Grid; costs: Float64Array; parents: Int32Array } | undefined;
  const blocked = (): SpaceRoute => ({ status: 'blocked', points: [], length: Infinity });
  return (end, distanceOnly = false) => {
    if (isSpaceSegmentOpen(g, start, end)) return { status: 'direct', points: [{ ...end }], length: fieldDistance(start, end) };
    if (!isSpacePointOpen(g, start) || !isSpacePointOpen(g, end)) return blocked();
    if (!search) {
      const grid = getGrid(g), costs = new Float64Array(grid.points.length).fill(Infinity), parents = new Int32Array(grid.points.length).fill(-1);
      const heap: { to: number; cost: number }[] = [];
      const push = (entry: { to: number; cost: number }) => {
        let i = heap.length; heap.push(entry);
        while (i > 0) { const p = (i - 1) >> 1; if (heap[p].cost <= entry.cost) break; heap[i] = heap[p]; i = p; } heap[i] = entry;
      };
      for (const { to, cost } of links(grid, start)) { costs[to] = cost; push({ to, cost }); }
      while (heap.length) {
        const current = heap[0], last = heap.pop()!;
        if (heap.length) {
          let i = 0;
          while (2 * i + 1 < heap.length) { let child = 2 * i + 1; if (child + 1 < heap.length && heap[child + 1].cost < heap[child].cost) child++; if (heap[child].cost >= last.cost) break; heap[i] = heap[child]; i = child; } heap[i] = last;
        }
        if (current.cost !== costs[current.to]) continue;
        for (const edge of grid.edges[current.to]) if (current.cost + edge.cost < costs[edge.to]) {
          costs[edge.to] = current.cost + edge.cost; parents[edge.to] = current.to; push({ to: edge.to, cost: costs[edge.to] });
        }
      }
      search = { grid, costs, parents };
    }
    const { grid, costs, parents } = search;
    const ends = links(grid, end).filter(link => Number.isFinite(costs[link.to]));
    ends.sort((a, b) => costs[a.to] + a.cost - costs[b.to] - b.cost || a.to - b.to);
    if (!ends.length) return blocked();
    if (distanceOnly) return { status: 'routed', points: [], length: costs[ends[0].to] + ends[0].cost };
    const path: FieldPoint[] = [{ ...end }];
    for (let i = ends[0].to; i !== -1; i = parents[i]) path.push(grid.points[i]);
    path.reverse();
    const points: FieldPoint[] = []; let from = start;
    for (let i = 0; i < path.length;) {
      let next = path.length - 1;
      while (next > i && !isSpaceSegmentOpen(g, from, path[next])) next--;
      points.push({ ...path[next] }); from = path[next]; i = next + 1;
    }
    return { status: 'routed', points, length: points.reduce((sum, p, i) => sum + fieldDistance(i ? points[i - 1] : start, p), 0) };
  };
}

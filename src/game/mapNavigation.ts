/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { CustomMapObject, CustomMapData } from '../types';

export interface NavNode {
  id: string;
  x: number;
  z: number;
  neighbors: string[]; // List of adjacent node IDs
}

export interface NavMesh {
  nodes: Map<string, NavNode>;
  gridSize: number;
}

/**
 * Checks if a linear XZ ray from (x1, z1) to (x2, z2) overlaps with any collidable obstacles.
 * Used for AI direct sightlines and A* path smoothing.
 */
export function checkSightlineClear(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  obstacles: CustomMapObject[],
  clearanceMargin: number = 0.6
): boolean {
  const steps = 15;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = x1 + (x2 - x1) * t;
    const pz = z1 + (z2 - z1) * t;

    // Check if px, pz is inside any obstacle footprint
    for (const obj of obstacles) {
      if (!obj.isCollidable) continue;

      const posX = obj.position.x;
      const posZ = obj.position.z;
      const scaleX = obj.scale.x;
      const scaleZ = obj.scale.z;

      if (obj.type === 'box') {
        const minX = posX - scaleX / 2 - clearanceMargin;
        const maxX = posX + scaleX / 2 + clearanceMargin;
        const minZ = posZ - scaleZ / 2 - clearanceMargin;
        const maxZ = posZ + scaleZ / 2 + clearanceMargin;

        if (px >= minX && px <= maxX && pz >= minZ && pz <= maxZ) {
          return false;
        }
      } else if (obj.type === 'cylinder' || obj.type === 'sphere') {
        const radius = scaleX / 2; // diameter is scale.x
        const distSq = (px - posX) ** 2 + (pz - posZ) ** 2;
        if (distSq < (radius + clearanceMargin) ** 2) {
          return false;
        }
      }
    }
  }
  return true;
}

/**
 * Bakes an automated 2D navigation grid across the custom map arena.
 */
export function bakeNavMesh(
  mapData: CustomMapData,
  nodeSpacing: number = 0.85,
  clearanceMargin: number = 0.6
): NavMesh {
  const nodes = new Map<string, NavNode>();
  const radius = mapData.arenaRadius;
  const gridCellsX = mapData.mapShape === 'rectangular'
    ? Math.ceil((radius * 1.2) / nodeSpacing)
    : Math.ceil(radius / nodeSpacing);
  const gridCellsZ = mapData.mapShape === 'rectangular'
    ? Math.ceil((radius * 0.6) / nodeSpacing)
    : Math.ceil(radius / nodeSpacing);

  const gridMap = new Map<string, string>(); // "i,j" -> nodeId

  // 1. Generate walkable nodes
  for (let i = -gridCellsX; i <= gridCellsX; i++) {
    for (let j = -gridCellsZ; j <= gridCellsZ; j++) {
      const nx = i * nodeSpacing;
      const nz = j * nodeSpacing;

      // Assert node is inside arena bounds (with margin)
      if (mapData.mapShape === 'rectangular') {
        const boundX = radius * 1.2 - 0.65;
        const boundZ = radius * 0.6 - 0.65;
        if (Math.abs(nx) >= boundX || Math.abs(nz) >= boundZ) continue;
      } else {
        const distFromCenter = Math.sqrt(nx * nx + nz * nz);
        if (distFromCenter >= radius - 0.65) continue;
      }

      // Assert node does not overlap any collidable custom obstacles
      let isBlocked = false;
      for (const obj of mapData.objects) {
        if (!obj.isCollidable) continue;

        const scaleX = obj.scale.x;
        const scaleZ = obj.scale.z;
        const posX = obj.position.x;
        const posZ = obj.position.z;

        if (obj.type === 'box') {
          const minX = posX - scaleX / 2 - clearanceMargin;
          const maxX = posX + scaleX / 2 + clearanceMargin;
          const minZ = posZ - scaleZ / 2 - clearanceMargin;
          const maxZ = posZ + scaleZ / 2 + clearanceMargin;

          if (nx >= minX && nx <= maxX && nz >= minZ && nz <= maxZ) {
            isBlocked = true;
            break;
          }
        } else if (obj.type === 'cylinder' || obj.type === 'sphere') {
          const radius = scaleX / 2;
          const distSq = (nx - posX) ** 2 + (nz - posZ) ** 2;
          if (distSq < (radius + clearanceMargin) ** 2) {
            isBlocked = true;
            break;
          }
        }
      }

      if (!isBlocked) {
        const id = `n_${i}_${j}`;
        nodes.set(id, {
          id,
          x: nx,
          z: nz,
          neighbors: [],
        });
        gridMap.set(`${i},${j}`, id);
      }
    }
  }

  // 2. Connect neighbors (Left, Right, Up, Down and 4 diagonals)
  const directions = [
    [1, 0], [-1, 0], [0, 1], [0, -1],   // Orthogonals
    [1, 1], [1, -1], [-1, 1], [-1, -1]  // Diagonals
  ];

  nodes.forEach((node, id) => {
    const parts = id.split('_');
    const i = parseInt(parts[1], 10);
    const j = parseInt(parts[2], 10);

    for (const [di, dj] of directions) {
      const neighborId = gridMap.get(`${i + di},${j + dj}`);
      if (neighborId) {
        const neighbor = nodes.get(neighborId)!;

        // Perform raycast sightline test between nodes to ensure no thin obstacle clips their link
        if (checkSightlineClear(node.x, node.z, neighbor.x, neighbor.z, mapData.objects, clearanceMargin - 0.15)) {
          node.neighbors.push(neighborId);
        }
      }
    }
  });

  return { nodes, gridSize: nodeSpacing };
}

/**
 * A* Pathfinding Solver on the custom navmesh grid.
 */
export function findShortestPath(
  startPos: THREE.Vector3,
  targetPos: THREE.Vector3,
  navMesh: NavMesh,
  obstacles: CustomMapObject[]
): THREE.Vector3[] {
  const nodes = navMesh.nodes;
  if (nodes.size === 0) return [];

  // Optimization: If a direct straight path is clear, just return target directly!
  if (checkSightlineClear(startPos.x, startPos.z, targetPos.x, targetPos.z, obstacles, 0.65)) {
    return [targetPos.clone()];
  }

  // 1. Find closest nav nodes to start and target
  let closestStartId = '';
  let closestStartDist = Infinity;
  let closestTargetId = '';
  let closestTargetDist = Infinity;

  nodes.forEach((node, id) => {
    const dStart = (node.x - startPos.x) ** 2 + (node.z - startPos.z) ** 2;
    if (dStart < closestStartDist) {
      closestStartDist = dStart;
      closestStartId = id;
    }

    const dTarget = (node.x - targetPos.x) ** 2 + (node.z - targetPos.z) ** 2;
    if (dTarget < closestTargetDist) {
      closestTargetDist = dTarget;
      closestTargetId = id;
    }
  });

  if (!closestStartId || !closestTargetId) return [targetPos.clone()];

  // A* structures
  const openSet = new Set<string>([closestStartId]);
  const closedSet = new Set<string>();

  const cameFrom = new Map<string, string>();

  const gScore = new Map<string, number>();
  nodes.forEach((_, id) => gScore.set(id, Infinity));
  gScore.set(closestStartId, 0);

  const fScore = new Map<string, number>();
  nodes.forEach((_, id) => fScore.set(id, Infinity));

  const startNode = nodes.get(closestStartId)!;
  const targetNode = nodes.get(closestTargetId)!;
  fScore.set(closestStartId, Math.sqrt((startNode.x - targetNode.x) ** 2 + (startNode.z - targetNode.z) ** 2));

  while (openSet.size > 0) {
    // Get node with lowest f-score in open set
    let currentId = '';
    let minF = Infinity;
    openSet.forEach(id => {
      const f = fScore.get(id) ?? Infinity;
      if (f < minF) {
        minF = f;
        currentId = id;
      }
    });

    if (currentId === closestTargetId) {
      // Reconstruct path
      const path: THREE.Vector3[] = [];
      let curr = currentId;
      while (curr) {
        const node = nodes.get(curr)!;
        path.unshift(new THREE.Vector3(node.x, 0, node.z));
        curr = cameFrom.get(curr) || '';
      }

      // Add final exact target coordinate at the end of the path
      path.push(targetPos.clone());

      // 2. Perform path smoothing / straight line optimization
      // Strip redundant zigzag nodes if we have straight lines
      const smoothedPath: THREE.Vector3[] = [];
      if (path.length > 0) {
        smoothedPath.push(new THREE.Vector3(startPos.x, 0, startPos.z)); // start from current pos
        let currentIdx = 0;

        while (currentIdx < path.length - 1) {
          let nextIdx = path.length - 1;
          // Look as far ahead as possible
          while (nextIdx > currentIdx) {
            const p1 = smoothedPath[smoothedPath.length - 1];
            const p2 = path[nextIdx];

            if (checkSightlineClear(p1.x, p1.z, p2.x, p2.z, obstacles, 0.55)) {
              break; // Sightline clear, skip intermediate nodes!
            }
            nextIdx--;
          }

          if (nextIdx === currentIdx) {
            // No direct sightline could be found, force adjacent step
            smoothedPath.push(path[currentIdx + 1]);
            currentIdx++;
          } else {
            smoothedPath.push(path[nextIdx]);
            currentIdx = nextIdx;
          }
        }
      }

      // Remove the starting node if it's the very first element (since we are already there)
      if (smoothedPath.length > 0) smoothedPath.shift();

      return smoothedPath.length > 0 ? smoothedPath : [targetPos.clone()];
    }

    openSet.delete(currentId);
    closedSet.add(currentId);

    const currNode = nodes.get(currentId)!;

    for (const neighborId of currNode.neighbors) {
      if (closedSet.has(neighborId)) continue;

      const neighborNode = nodes.get(neighborId)!;
      // Calculate travel cost (orthogonal vs diagonal)
      const cost = Math.sqrt((currNode.x - neighborNode.x) ** 2 + (currNode.z - neighborNode.z) ** 2);
      const tentativeG = (gScore.get(currentId) ?? Infinity) + cost;

      if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
        cameFrom.set(neighborId, currentId);
        gScore.set(neighborId, tentativeG);

        const h = Math.sqrt((neighborNode.x - targetNode.x) ** 2 + (neighborNode.z - targetNode.z) ** 2);
        fScore.set(neighborId, tentativeG + h);

        openSet.add(neighborId);
      }
    }
  }

  // Fallback: return direct target if pathfinding fails
  return [targetPos.clone()];
}

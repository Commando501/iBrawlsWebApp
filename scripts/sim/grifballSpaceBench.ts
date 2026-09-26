import { performance } from 'node:perf_hooks';
import { DEFAULT_ADMIN_SETTINGS } from '../../src/settings/gameplaySettings';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, type GrifballTacticalSnapshot } from '../../src/game/aiGrifballTeamPlan';
import { observeGrifballSpace } from '../../src/game/aiGrifballSpace';
import { buildGrifballSpaceGeometry } from '../../src/game/grifballSpaceGeometry';
import type { CustomMapData } from '../../src/types';

// 8 participants = supported 7 bots + human. 32 is an extra planner stress case.
for (const count of [8, 32]) for (const obstacles of [false, true]) {
  const map = { mapShape: 'rectangular', arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 }, objects: obstacles ? [
    { type: 'box', position: { x: 0, y: 1, z: 0 }, scale: { x: 1, y: 2, z: 15 }, isCollidable: true },
    { type: 'cylinder', position: { x: 12, y: 1, z: 10 }, scale: { x: 4, y: 2, z: 4 }, isCollidable: true },
  ] : [] } as CustomMapData;
  const snapshot: GrifballTacticalSnapshot = {
    round: 1, playing: true, ball: { x: -4, z: 0 }, holderId: 'p0', spacing: 4,
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } }, geometry: buildGrifballSpaceGeometry(map, 52),
    players: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, team: i % 2 ? 'red' : 'blue', scripted: i !== count - 1,
      pos: { x: (i % 2 ? 1 : -1) * (4 + Math.floor(i / 8) * 4), z: (i % 8 - 3.5) * 3 }, vel: { x: 0, z: 0 },
      space: observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, i === 0 ? 'ball' : 'hammer', 'ready'),
    })),
  };
  const plan = createGrifballTeamPlanState(); const samples: number[] = [];
  let first = 0;
  for (let tick = 0; tick <= 60; tick++) {
    const start = performance.now(); updateGrifballTeamPlan(plan, snapshot, 0.21); const elapsed = performance.now() - start;
    if (tick === 0) first = elapsed; else samples.push(elapsed);
  }
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({ participants: count, obstacles, firstRefreshMs: +first.toFixed(2), medianMs: +samples[30].toFixed(2), p95Ms: +samples[57].toFixed(2), maxMs: +samples[59].toFixed(2) }));
}

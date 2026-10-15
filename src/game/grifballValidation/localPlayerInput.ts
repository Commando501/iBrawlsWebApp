import type { GrifballTacticalSnapshot } from '../aiGrifballTeamPlan';
import { createSpaceRouter, fieldDistance, isSpaceSegmentOpen } from '../grifballSpaceGeometry';

/** A deterministic test driver for the local input owner, not a human-skill model. */
export const LOCAL_INPUT_PROTOCOL = 'objective-walk-and-melee-v1' as const;
export interface ValidationLocalInput {
  forward: boolean;
  yaw: number;
  attack: 'primary' | null;
  pickup: boolean;
}
export interface LocalPlayerEvidence {
  protocol: typeof LOCAL_INPUT_PROTOCOL;
  inputTicks: number; movementRequests: number; attackRequests: number; attackStarts: number; pickupRequests: number;
  distanceMoved: number; possessions: number; carrierTicks: number; kills: number; deaths: number; respawns: number; goals: number;
}

/** Shared report/import contract. Missing evidence is handled separately by acceptance gates. */
export function validLocalPlayerEvidence(value: unknown, maxInputTicks: number): value is LocalPlayerEvidence {
  if (!value || typeof value !== 'object') return false;
  const e = value as LocalPlayerEvidence;
  return e.protocol === LOCAL_INPUT_PROTOCOL && Number.isFinite(e.distanceMoved) && e.distanceMoved >= 0 &&
    [e.inputTicks, e.movementRequests, e.attackRequests, e.attackStarts, e.pickupRequests, e.possessions,
      e.carrierTicks, e.kills, e.deaths, e.respawns, e.goals].every(v => Number.isSafeInteger(v) && v >= 0) &&
    e.inputTicks <= maxInputTicks && e.attackStarts <= e.attackRequests &&
    [e.movementRequests, e.attackRequests, e.pickupRequests, e.carrierTicks, e.possessions].every(v => v <= e.inputTicks);
}

/** Return input intent only. The production movement/weapon owners apply it. */
export function validationLocalInput(snapshot: GrifballTacticalSnapshot, tick: number): ValidationLocalInput {
  const idle: ValidationLocalInput = { forward: false, yaw: 0, attack: null, pickup: false };
  const self = snapshot.players.find(p => p.id === 'player');
  if (!snapshot.playing || !self || !snapshot.geometry) return idle;
  idle.pickup = !snapshot.holderId && tick % 12 === 0;
  const enemy = snapshot.players.filter(p => p.team !== self.team &&
    fieldDistance(self.pos, p.pos) <= (self.space?.reach ?? 1.8) && isSpaceSegmentOpen(snapshot.geometry!, self.pos, p.pos))
    .sort((a, b) => fieldDistance(self.pos, a.pos) - fieldDistance(self.pos, b.pos) || a.id.localeCompare(b.id))[0];
  if (enemy && tick % 12 === 0) {
    return { forward: false, yaw: Math.atan2(self.pos.x - enemy.pos.x, self.pos.z - enemy.pos.z),
      attack: 'primary', pickup: idle.pickup };
  }
  const holder = snapshot.players.find(p => p.id === snapshot.holderId);
  const destination = snapshot.holderId === self.id ? snapshot.goals[self.team === 'blue' ? 'red' : 'blue'] : holder?.pos ?? snapshot.ball;
  if (!destination || fieldDistance(self.pos, destination) < .2) return idle;
  const route = createSpaceRouter(snapshot.geometry, self.pos)(destination);
  if (route.status === 'blocked' || !route.points.length) return idle;
  const waypoint = route.points.find(p => fieldDistance(self.pos, p) >= .2) ?? destination;
  return { forward: true, yaw: Math.atan2(self.pos.x - waypoint.x, self.pos.z - waypoint.z), attack: null, pickup: idle.pickup };
}

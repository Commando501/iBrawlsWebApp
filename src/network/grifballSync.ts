// Keep the wire contract independent of renderer/game imports so both relays can use it.
interface GrifballWireMatch {
  phase: 'countdown' | 'playing' | 'scored' | 'matchEnd';
  phaseTimer: number; roundNumber: number; goalTarget: number;
  lastScoringTeam: string | null; winningTeam: string | null;
  ball: {
    state: 'idle' | 'held' | 'loose' | 'thrown'; holderId: string | null;
    pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number };
    home: { x: number; y: number; z: number }; looseTimer: number;
  };
}

/** Objective authority belongs to the room host; actor IDs are socket IDs on the wire. */
export interface GrifballInput {
  sequence: number;
  round: number;
  possession: number;
  pickup: boolean;
  charging: boolean;
  release?: { yaw: number };
}
export const GRIFBALL_RULE_KEYS = [
  'grifballPickupRadius', 'grifballBallReturnTimeout', 'grifballChargeMax',
  'grifballPassSpeedMin', 'grifballPassSpeedMax', 'grifballGoalTarget',
  'grifballCountdownDuration', 'grifballRoundResetDelay',
  'grifballRunnerHealth', 'grifballRunnerHealDelay', 'grifballRunnerHealRate',
  'grifballRunnerSpeedForward', 'grifballRunnerSpeedBackward', 'grifballRunnerSpeedSide',
] as const;
export const GRIFBALL_BOOLEAN_RULE_KEYS = ['grifballAllowThrowing', 'grifballAllowRunnerThrust'] as const;
export interface GrifballSnapshot {
  sequence: number;
  possession: number;
  match: GrifballWireMatch;
  goals: { blue: number; red: number };
  charge: number;
  release: { sequence: number; actorId: string; charge: number; age: number } | null;
  rules: Partial<Record<typeof GRIFBALL_RULE_KEYS[number], number> & Record<typeof GRIFBALL_BOOLEAN_RULE_KEYS[number], boolean>>;
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const uint = (n: unknown): n is number => finite(n) && Number.isSafeInteger(n) && n >= 0;
const vec = (v: any) => v && finite(v.x) && finite(v.y) && finite(v.z);
export function isGrifballInput(v: any): v is GrifballInput {
  return !!v && uint(v.sequence) && uint(v.round) && uint(v.possession) &&
    typeof v.pickup === 'boolean' && typeof v.charging === 'boolean' &&
    (!v.release || finite(v.release.yaw));
}
export function isGrifballSnapshot(v: any): v is GrifballSnapshot {
  const m = v?.match, b = m?.ball;
  return !!v && uint(v.sequence) && uint(v.possession) &&
    ['countdown', 'playing', 'scored', 'matchEnd'].includes(m?.phase) &&
    finite(m.phaseTimer) && m.phaseTimer >= 0 && uint(m.roundNumber) && uint(m.goalTarget) &&
    [null, 'blue', 'red'].includes(m.lastScoringTeam) && [null, 'blue', 'red'].includes(m.winningTeam) &&
    ['idle', 'held', 'loose', 'thrown'].includes(b?.state) &&
    (b.state === 'held' ? typeof b.holderId === 'string' : b.holderId === null) &&
    vec(b.pos) && vec(b.vel) && vec(b.home) && finite(b.looseTimer) &&
    uint(v.goals?.blue) && uint(v.goals?.red) && finite(v.charge) && v.charge >= 0 && v.charge <= 1 &&
    (!v.release || (uint(v.release.sequence) && typeof v.release.actorId === 'string' &&
      finite(v.release.charge) && v.release.charge >= 0 && v.release.charge <= 1 && finite(v.release.age) && v.release.age >= 0)) &&
    !!v.rules && GRIFBALL_BOOLEAN_RULE_KEYS.every(k => v.rules[k] === undefined || typeof v.rules[k] === 'boolean') && GRIFBALL_RULE_KEYS.every(k => v.rules[k] === undefined || (finite(v.rules[k]) && v.rules[k] >= 0));
}
/** Used by both relays. Never forward a guest's claimed objective or an observer's input. */
export function allowGrifballMessage(message: any, role: string, gameMode: string, started: boolean): boolean {
  if (message.action === 'grifball_state') return started && gameMode === 'grifball' && role === 'host' && isGrifballSnapshot(message.objective);
  if (message.action === 'grifball_input') return started && gameMode === 'grifball' && role === 'client' && isGrifballInput(message.objectiveInput);
  return true;
}

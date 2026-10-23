import type { GrifballRuntimeState } from './runtimeState';
import { isFriendlyFireForState } from './combatScoring';

type Prediction = { targetId: string; credited: boolean; killCredit?: boolean; deathId?: string };
const pending = new WeakMap<GrifballRuntimeState, { sequence: number; hits: Map<string, Prediction> }>();

/** Correlate a predicted runner kill with the defender's authoritative clash reply. */
export function prepareRunnerSwordPrediction(state: GrifballRuntimeState, targetId: string): string | undefined {
  if (state.settings.gameMode !== 'grifball' || state.grifball.ball.holderId !== targetId) return undefined;
  let ledger = pending.get(state);
  if (!ledger) { ledger = { sequence: 0, hits: new Map() }; pending.set(state, ledger); }
  const id = String(++ledger.sequence);
  ledger.hits.set(id, { targetId, credited: false });
  // Replies only matter for recent predicted hits; avoid retaining disconnected peers.
  if (ledger.hits.size > 32) ledger.hits.delete(ledger.hits.keys().next().value!);
  return id;
}

export function recordRunnerSwordPrediction(state: GrifballRuntimeState, hitId: string | undefined): void {
  const hit = hitId && pending.get(state)?.hits.get(hitId);
  if (!hit) return;
  hit.credited = (state.otherPlayers.get(hit.targetId)?.hp ?? 1) <= 0;
  hit.killCredit = hit.credited && !isFriendlyFireForState(state, 'player', hit.targetId);
  if (hit.credited) hit.deathId = state.lastDeaths[0]?.id;
}

export function rejectRunnerSwordPrediction(
  state: GrifballRuntimeState, senderId: string, hitId: unknown, runnerHp: unknown
): void {
  if (typeof hitId !== 'string' || typeof runnerHp !== 'number' || !Number.isFinite(runnerHp) || runnerHp <= 0) return;
  const ledger = pending.get(state), hit = ledger?.hits.get(hitId);
  if (!hit || hit.targetId !== senderId) return;
  ledger!.hits.delete(hitId);
  if (!hit.credited) return;
  if (hit.killCredit) {
    state.playerKills = Math.max(0, state.playerKills - 1); state.scorePlayer = Math.max(0, state.scorePlayer - 1);
  }
  const target = state.otherPlayers.get(senderId);
  if (target) {
    target.hp = runnerHp; target.respawnTimer = 0;
    target.deaths = Math.max(0, (target.deaths ?? 0) - 1);
  }
  state.lastDeaths = state.lastDeaths.filter(death => death.id !== hit.deathId);
}

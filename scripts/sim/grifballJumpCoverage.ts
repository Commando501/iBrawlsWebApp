export interface JumpCoverageTrace {
  name: string;
  failureCount: number;
  scenario: { team: 'blue' | 'red'; reverse: boolean; main: boolean };
  mainJumpRequests: readonly { tick: number; accepted: boolean; dash: number; swap: number }[];
  flights?: readonly { launch: number; landing: number; apex: number }[];
}

/** Require opportunities without prescribing a combat choice to every seed.
 * Only fully validated traces can supply witnesses; never sample events first. */
export function jumpCoverage(traces: readonly JumpCoverageTrace[], scope: 'mobility' | 'match') {
  const required = (['blue', 'red'] as const).flatMap(team => scope === 'match'
    ? [`${team}/dash-rejection`]
    : [false, true].flatMap(reverse => [`${team}/${reverse}/flight`, `${team}/${reverse}/dash-rejection`]));
  const witnesses: { group: string; trace: string; ticks: number[] }[] = [];
  for (const trace of traces) {
    if (trace.failureCount || !trace.scenario.main) continue;
    const group = scope === 'match' ? trace.scenario.team : `${trace.scenario.team}/${trace.scenario.reverse}`;
    const rejected = trace.mainJumpRequests.filter(r => !r.accepted && r.dash > 0).map(r => r.tick);
    if (rejected.length) witnesses.push({ group: `${group}/dash-rejection`, trace: trace.name, ticks: rejected });
    const flights = trace.flights?.filter(f => f.landing > f.launch).map(f => f.launch) ?? [];
    if (scope === 'mobility' && flights.length) witnesses.push({ group: `${group}/flight`, trace: trace.name, ticks: flights });
  }
  return { scope, witnesses, missing: required.filter(group => !witnesses.some(w => w.group === group)) };
}

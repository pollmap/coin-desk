export interface ObservationRun {
  slot: number;
  started_at: number;
  completed_at: number | null;
  outcome: string;
  job: string | null;
}

/** Only mature minute slots count: the last two minutes may still be running.
 * cron_runs is a 72-hour ring. Its slot identifies the scheduled minute, while
 * started_at identifies which turn of that ring it belongs to.
 */
export function observeAutomation(
  runs: ObservationRun[],
  now: number,
  recovered: Record<string, number> = {},
  currentErrors: string[] = [],
) {
  const until = Math.floor(now / 60) * 60 - 120;
  const from = until - 48 * 3600;
  const expectedRuns = 48 * 60;
  const byTick = new Map<number, ObservationRun>();
  let firstEver = Infinity;
  for (const run of runs) {
    const startedTick = Math.floor(run.started_at / 60);
    const tick = startedTick - ((((startedTick - run.slot) % 4320) + 4320) % 4320);
    const scheduled = tick * 60;
    if (scheduled > now || run.started_at > now) continue;
    firstEver = Math.min(firstEver, scheduled);
    if (scheduled < from || scheduled >= until) continue;
    const previous = byTick.get(tick);
    if (!previous || (run.completed_at ?? 0) > (previous.completed_at ?? 0)) byTick.set(tick, run);
  }
  const ordered = [...byTick.entries()].sort(([a], [b]) => a - b);
  const successful = (r: ObservationRun) =>
    ['ok', 'idle'].includes(r.outcome) && r.completed_at !== null && r.completed_at <= now;
  const successByJob = { ...recovered };
  for (const run of runs) {
    if (successful(run) && run.job)
      successByJob[run.job] = Math.max(successByJob[run.job] ?? 0, run.completed_at!);
  }
  const unresolved = new Set(currentErrors);
  let failures = 0;
  let successes = 0;
  let longestGapSeconds = 0;
  let previous = from - 60;
  for (const [tick, run] of ordered) {
    longestGapSeconds = Math.max(longestGapSeconds, tick * 60 - previous);
    previous = tick * 60;
    if (successful(run)) successes++;
    else {
      failures++;
      if (!run.job || (successByJob[run.job] ?? 0) <= run.started_at)
        unresolved.add(run.job ?? `cron:${tick}`);
    }
  }
  longestGapSeconds = Math.max(longestGapSeconds, until - previous);
  const ticks = ordered.length;
  const recordingRate = ticks / expectedRuns;
  const windowSatisfied = firstEver <= from;
  const healthy =
    windowSatisfied && recordingRate >= 0.99 && longestGapSeconds <= 180 && unresolved.size === 0;
  return {
    from,
    until,
    firstRunAt: ordered[0]?.[1].started_at ?? null,
    lastRunAt: ordered.at(-1)?.[1].started_at ?? null,
    ticks,
    failures,
    expectedRuns,
    missingRuns: expectedRuns - ticks,
    successfulRuns: successes,
    recordingRate,
    successRate: successes / expectedRuns,
    longestGapSeconds,
    unresolvedErrors: [...unresolved].sort(),
    windowSatisfied,
    healthy,
    // Existing consumers keep the field, but readiness now requires healthy operation.
    ready: healthy,
    thresholds: { recordingRate: 0.99, longestGapSeconds: 180, graceSeconds: 120 },
  };
}

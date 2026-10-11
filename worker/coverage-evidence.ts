import evidence from './coverage-provider-evidence.json';
import type { DatasetCoverageRow } from '../shared/dataset-coverage';

/** Frozen, source-backed audit. New gaps remain unknown; no observation is filled. */
export function annotateCoverageGaps(
  asset: string,
  id: string,
  times: number[],
  step: number | null,
  gaps: DatasetCoverageRow['gaps'],
  checks = evidence.checks,
): DatasetCoverageRow['gaps'] {
  if (step === null || !gaps.slots) return gaps;
  const selected = checks.filter((c) => c.asset === asset && c.id === id);
  const known = new Set(selected.flatMap((c) => c.times));
  const current = new Set<number>();
  for (let i = 1; i < times.length; i++)
    for (let t = times[i - 1] + step; t < times[i]; t += step) if (known.has(t)) current.add(t);
  const applicable = selected.filter((c) => c.times.some((t) => current.has(t)));
  return {
    ...gaps,
    checkedMissingSlots: current.size,
    evidence: applicable
      .slice(0, 20)
      .map((c) => ({
        checkedAt: c.checkedAt,
        url: c.url,
        classification: 'provider-no-observation-at-check' as const,
        slots: c.times.filter((t) => current.has(t)).length,
      })),
  };
}

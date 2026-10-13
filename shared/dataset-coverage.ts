export interface DatasetCoverageRow {
  id: string;
  title: string;
  source: string;
  unit: string;
  first: number | null;
  last: number | null;
  observations: number;
  cadence: '1d' | '1h' | 'settlement';
  providerFirst: number | null;
  gaps: {
    slots: number | null;
    classification: 'unverified' | 'not-applicable';
    ranges: { from: number; to: number }[];
    checkedMissingSlots?: number;
    evidence?: {
      checkedAt: number;
      url: string;
      classification: 'provider-no-observation-at-check';
      slots: number;
    }[];
  };
  status: 'available' | 'pending' | 'collection-error';
}
export interface DatasetCoverage {
  asset: string;
  checkedAt: number;
  sources: DatasetCoverageRow[];
  quoteStates: {
    source: string;
    condition: 'recent-trade' | 'old-trade' | 'unknown-trade-time' | 'collection-error' | 'pending';
    tradedAt: number | null;
    checkedAt: number | null;
  }[];
  warning: string;
}
export function observationGaps(times: number[], step: number | null) {
  const ordered = [...new Set(times)].sort((a, b) => a - b);
  const ranges: { from: number; to: number }[] = [];
  let slots = 0;
  if (step === null) return { slots: null, classification: 'not-applicable' as const, ranges };
  for (let i = 1; i < ordered.length; i++) {
    const missing = Math.max(0, Math.floor((ordered[i] - ordered[i - 1]) / step) - 1);
    slots += missing;
    if (missing && ranges.length < 20) ranges.push({ from: ordered[i - 1] + step, to: ordered[i] });
  }
  return { slots, classification: 'unverified' as const, ranges };
}

import { expect, it } from 'vitest';
import { annotateCoverageGaps } from '../worker/coverage-evidence';
import { observationGaps } from '../shared/dataset-coverage';
it('provider evidence applies only to the same asset, source, and currently missing timestamp', () => {
  const times = [86400, 4 * 86400],
    gaps = observationGaps(times, 86400);
  const checks = [
    {
      asset: 'BTC',
      id: 'binance:1d',
      times: [2 * 86400],
      checkedAt: 10,
      url: 'https://api.binance.com/api/v3/klines',
    },
  ];
  const annotated = annotateCoverageGaps('BTC', 'binance:1d', times, 86400, gaps, checks);
  expect(annotated.checkedMissingSlots).toBe(1);
  expect(annotated.slots).toBe(2);
  expect(annotated.evidence?.[0].slots).toBe(1);
  expect(
    annotateCoverageGaps('ETH', 'binance:1d', times, 86400, gaps, checks).checkedMissingSlots,
  ).toBe(0);
  expect(
    annotateCoverageGaps('BTC', 'upbit:1d', times, 86400, gaps, checks).checkedMissingSlots,
  ).toBe(0);
  const filled = [86400, 2 * 86400, 4 * 86400];
  expect(
    annotateCoverageGaps('BTC', 'binance:1d', filled, 86400, observationGaps(filled, 86400), checks)
      .checkedMissingSlots,
  ).toBe(0);
});

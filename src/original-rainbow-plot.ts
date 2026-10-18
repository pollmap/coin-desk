import { btcOriginalRainbow, type OriginalRainbowReference } from '../shared/btc-rainbow-original';
import type { Point } from '../shared/types';
import type { AnalysisLine } from './AnalysisChart';

// These are model centre lines, not the nine residual-standard-deviation regions of our own fit.
const COLORS = [
  '#a62b3299',
  '#c33d3199',
  '#cf642799',
  '#b7831699',
  '#918b1799',
  '#60913c99',
  '#23897699',
  '#277ba699',
  '#4969ae99',
  '#8058a999',
];
const NAMES = [
  '상단 1',
  '상단 2',
  '상단 3',
  '상단 4',
  '중앙 1',
  '중앙 2',
  '하단 1',
  '하단 2',
  '하단 3',
  '하단 4',
];

/** Keep genuine USD price observations intact; model values only exist on verified reference dates. */
export function originalRainbowLines(
  prices: Point[],
  reference: OriginalRainbowReference,
  now = Date.now() / 1000,
): AnalysisLine[] {
  const rows = btcOriginalRainbow(prices, reference, now);
  return COLORS.map((color, index) => ({
    id: `band:original:${index}`,
    title: NAMES[index],
    unit: 'USD',
    source: 'BlockchainCenter Original',
    data: rows.map((row) => ({ time: row.time, value: row.centers[index] })),
    color,
    lineWidth: 4,
    overlay: true,
    step: 86400,
  }));
}

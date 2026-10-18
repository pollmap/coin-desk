/** Axis preferences never transform or remove observations. */
export type AxisPreference = 'log' | 'linear';

const PRICE_METRICS = new Set([
  'price',
  'comparison:price',
  'view:price',
  'view:supertrend',
  'view:ribbon',
  'view:bb',
  'view:vwap',
  'view:rainbow',
  'view:asset_rainbow',
  'view:btc_rainbow',
  'view:btc_rainbow_original',
  'view:powerlaw',
  'net:realized_price',
  'btc:realized_price',
  'btc:sth_realized_price',
  'realized_price',
  'sth_realized_price',
]);
const POSITIVE_RATIOS = new Set(['net:mvrv', 'btc:mvrv', 'btc:sth_mvrv', 'btc:lth_mvrv']);

export const isPriceMetric = (metric: string) => PRICE_METRICS.has(metric);
export const supportsLogAxis = (metric: string) =>
  isPriceMetric(metric) || POSITIVE_RATIOS.has(metric);
export const defaultAxis = (metric: string): AxisPreference =>
  isPriceMetric(metric) ? 'log' : 'linear';
export function readAxis(value: unknown): AxisPreference | undefined {
  return value === 'log' || value === '1'
    ? 'log'
    : value === 'linear' || value === '0'
      ? 'linear'
      : undefined;
}
export function axisPreference(
  metric: string,
  explicit?: unknown,
  remembered?: unknown,
): AxisPreference {
  return supportsLogAxis(metric)
    ? (readAxis(explicit) ?? readAxis(remembered) ?? defaultAxis(metric))
    : 'linear';
}
export function positiveValues(values: readonly number[]): boolean {
  return values.length > 0 && values.every((value) => Number.isFinite(value) && value > 0);
}
export function effectiveAxis(
  requested: AxisPreference,
  values: readonly number[],
): AxisPreference {
  return requested === 'log' && positiveValues(values) ? 'log' : 'linear';
}

/** Used by lightweight SVG price previews too; invalid input is never silently removed. */
export function axisCoordinates(values: readonly number[], requested: AxisPreference = 'log') {
  return effectiveAxis(requested, values) === 'log' ? values.map(Math.log) : [...values];
}

interface ScaleInfo {
  priceRange: { minValue: number; maxValue: number } | null;
  margins?: { above: number; below: number };
}
/**
 * Lightweight Charts' signed-log scale can cross zero in pixel margins, even with positive data.
 * Supply padding in the positive price domain instead, including flat/tiny price histories.
 * Apply together with zero scaleMargins; markers must not add pixel margins afterwards.
 */
export function positiveLogAutoscale(info: ScaleInfo | null): ScaleInfo | null {
  if (!info?.priceRange) return info;
  const { minValue: low, maxValue: high } = info.priceRange;
  if (!positiveValues([low, high]) || high < low) return info;
  const padding = Math.max(Math.log(1.08), (Math.log(high) - Math.log(low)) * 0.06);
  const lower = Math.max(Number.MIN_VALUE, Math.exp(Math.log(low) - padding));
  let upper = Math.min(Number.MAX_VALUE, Math.exp(Math.log(high) + padding));
  // Subnormal numbers can round their multiplicative padding back to the same value.
  if (upper <= lower) upper = Math.min(Number.MAX_VALUE, high * 2);
  return {
    ...info,
    priceRange: {
      minValue: Math.min(low, lower),
      maxValue: Math.max(high, Number.isFinite(upper) ? upper : Number.MAX_VALUE),
    },
    margins: { above: 0, below: 0 },
  };
}

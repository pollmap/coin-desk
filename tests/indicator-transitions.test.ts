import { describe, it, expect } from 'vitest';
import {
  indicatorTransitions,
  supertrendTransitions,
  signalMetric,
  signalMatchesAnalysis,
} from '../shared/indicator-transitions';
import { DAY } from '../shared/math';
import type { SupertrendRow } from '../shared/supertrend';
import type { ObservationSignal } from '../shared/signals';
const base = Date.UTC(2020, 0, 1) / 1000;
describe('indicator transitions', () => {
  it('requires consecutive confirmed MVRV observations and preserves exact date', () => {
    const points = [0.8, 1.2, 0.9].map((value, i) => ({ time: base + i * DAY, value }));
    expect(
      indicatorTransitions('BTC', 'net:mvrv', 'coinmetrics', points, base + 2 * DAY),
    ).toMatchObject([{ time: base + DAY, direction: 'up' }]);
    expect(
      indicatorTransitions(
        'BTC',
        'net:mvrv',
        'coinmetrics',
        [points[0], points[2]],
        base + 4 * DAY,
      ),
    ).toEqual([]);
  });
  it('does not generate a funding crossing through a settlement gap or at zero', () => {
    expect(
      indicatorTransitions(
        'ETH',
        'futures:funding',
        'bybit',
        [
          { time: base, value: -0.01 },
          { time: base + 8 * 3600, value: 0.02 },
        ],
        base + DAY,
      ),
    ).toHaveLength(1);
    expect(
      indicatorTransitions(
        'ETH',
        'futures:funding',
        'bybit',
        [
          { time: base, value: -0.01 },
          { time: base + 9 * 3600, value: 0.02 },
        ],
        base + DAY,
      ),
    ).toEqual([]);
    expect(
      indicatorTransitions(
        'ETH',
        'futures:funding',
        'bybit',
        [
          { time: base, value: 0 },
          { time: base + 3600, value: 0.02 },
        ],
        base + DAY,
      ),
    ).toEqual([]);
  });
  it('does not invent a Supertrend transition across missing weekly bars', () => {
    const rows = [
      { time: base, direction: 'down' },
      { time: base + 7 * DAY, direction: 'up' },
      { time: base + 21 * DAY, direction: 'down' },
    ] as SupertrendRow[];
    expect(supertrendTransitions('DOGE', 'binance', rows, '1w')).toMatchObject([
      { time: base + 7 * DAY, direction: 'up' },
    ]);
  });
  it('maps a legacy MVRV, funding or RSI signal to its own indicator', () => {
    for (const [rule, id] of [
      ['mvrv1', 'net:mvrv'],
      ['funding0', 'futures:funding'],
      ['rsi70', 'rsi'],
      ['sma200', 'view:price'],
    ])
      expect(signalMetric({ rule } as ObservationSignal)).toBe(id);
  });
  it('never pins a legacy event to another source or overrides its indicator', () => {
    const signal = { rule: 'rsi70', source: 'reference' } as ObservationSignal;
    expect(signalMatchesAnalysis(signal, 'rsi', 'reference')).toBe(true);
    expect(signalMatchesAnalysis(signal, 'rsi', 'upbit')).toBe(false);
    expect(signalMatchesAnalysis(signal, 'view:price', 'reference')).toBe(false);
    expect(
      signalMatchesAnalysis(
        { rule: 'mvrv1', source: 'coinmetrics' } as ObservationSignal,
        'net:mvrv',
        'upbit',
      ),
    ).toBe(true);
    expect(
      signalMatchesAnalysis(
        { rule: 'mvrv1', source: 'coinmetrics' } as ObservationSignal,
        'btc:mvrv',
        'reference',
      ),
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { belongsToSection, focusMetric } from '../shared/analysis-sections';

describe('analysis section focus', () => {
  it('isolates onchain and futures selections', () => {
    expect(belongsToSection('futures:funding', 'onchain')).toBe(false);
    expect(belongsToSection('sma200', 'onchain')).toBe(false);
    expect(belongsToSection('chain:tvl', 'onchain')).toBe(true);
    expect(belongsToSection('btc:mvrv', 'onchain')).toBe(true);
    expect(belongsToSection('net:mvrv', 'futures')).toBe(false);
  });
  it('moves the chosen metric to the main chart, instead of adding a lower pane', () => {
    expect(
      focusMetric(
        'futures:open_interest_daily',
        ['futures:funding', 'futures:open_interest_daily', 'rsi'],
        'futures',
      ),
    ).toEqual(['futures:open_interest_daily', 'futures:funding']);
  });
  it('does not allow a price indicator to replace the onchain metric', () => {
    expect(focusMetric('rsi', ['net:mvrv'], 'onchain')).toEqual(['net:mvrv']);
  });
});

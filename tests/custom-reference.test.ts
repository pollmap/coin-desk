import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { ema, rsi, bollinger, macd } from '../shared/math';
const fixtures = JSON.parse(readFileSync('tests/fixtures/custom-reference.json', 'utf8'));
for (const fixture of fixtures)
  it('Decimal reference: ' + fixture.name, () => {
    const points = fixture.values.map((value: number, time: number) => ({ time, value }));
    function compare(values: { value: number }[], key: string) {
      expect(values.length).toBe(fixture.expected[key].length);
      values.forEach((p, i) =>
        expect(Math.abs(p.value - fixture.expected[key][i])).toBeLessThan(
          Math.max(1e-14, Math.abs(fixture.expected[key][i]) * 1e-9),
        ),
      );
    }
    for (const n of [5, 21]) compare(ema(points, n), 'ema' + n);
    for (const n of [7, 21]) compare(rsi(points, n), 'rsi' + n);
    const b = bollinger(points, 14, 2.5);
    compare(b.middle, 'bbMiddle');
    compare(b.upper, 'bbUpper');
    compare(b.lower, 'bbLower');
    const m = macd(points);
    compare(m.line, 'macd');
    compare(m.signal, 'signal');
    compare(m.histogram, 'histogram');
  });

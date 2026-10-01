import { describe, expect, it } from 'vitest';
import { btcRainbow, RAINBOW_OFFSETS } from '../shared/btc-rainbow';
import { ASSETS } from '../shared/catalog';
import {
  defaultIndicator,
  indicatorDefinition,
  indicatorUrl,
  resolveIndicator,
} from '../shared/indicator-catalog';
import { guideContext } from '../shared/learning-catalog';
import { normalizeDesk, workspaceUrl } from '../shared/workspace';
const DAY = 86400,
  genesis = Date.UTC(2009, 0, 3) / 1000;
const history = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    time: genesis + (i + 20) * DAY,
    value: Math.exp(-3 + 1.8 * Math.log(i + 20) + 0.2 * Math.sin(i / 11)),
  }));
describe('indicator entry and compatibility', () => {
  it('defaults to BTC MVRV and readable range without overriding explicit state', () => {
    expect(resolveIndicator('BTC', '/', new URLSearchParams())).toMatchObject({
      id: 'net:mvrv',
      period: '5y',
      supported: true,
    });
    expect(
      resolveIndicator('BTC', '/', new URLSearchParams('metric=net:mvrv&period=all')).period,
    ).toBe('all');
    expect(
      resolveIndicator('DOGE', '/futures/DOGE', new URLSearchParams('metric=funding')).id,
    ).toBe('futures:funding');
    expect(resolveIndicator('DOGE', '/', new URLSearchParams('visual=rainbow')).id).toBe(
      'view:rainbow',
    );
    expect(resolveIndicator('DOGE', '/', new URLSearchParams('indicators=sma200')).id).toBe(
      'view:price',
    );
    expect(
      resolveIndicator('BTC', '/metrics/mvrv', new URLSearchParams('visual=price')),
    ).toMatchObject({ id: 'btc:mvrv', period: '5y', supported: true });
    expect(
      resolveIndicator('BTC', '/metrics/mvrv', new URLSearchParams('metric=mvrv&period=all')),
    ).toMatchObject({ id: 'btc:mvrv', period: 'all', supported: true });
  });
  it('switches unsupported MVRV and USD reference without cross-coin data', () => {
    for (const asset of ASSETS.map((a) => a.id)) {
      const p = new URL(
        indicatorUrl(
          asset,
          'net:mvrv',
          new URLSearchParams('price_source=reference&period=all&market=upbit'),
          true,
        ),
        'https://test.invalid',
      ).searchParams;
      expect(p.get('asset')).toBe(asset);
      expect(p.get('metric')).toBe(defaultIndicator(asset));
      if (['SOL', 'ONDO', 'PEPE'].includes(asset)) {
        expect(p.get('price_source')).toBe('binance');
        expect(p.get('market')).toBe('binance');
        expect(p.get('period')).toBe('1y');
        expect(p.get('transition')).toBe('net:mvrv');
      }
    }
    expect(resolveIndicator('ONDO', '/', new URLSearchParams('metric=net:mvrv')).supported).toBe(
      false,
    );
  });
  it('keeps asset in education, saves metric and shared explicit range', () => {
    expect(
      guideContext(new URLSearchParams('asset=ONDO&price_source=binance&metric=rsi')).get('asset'),
    ).toBe('ONDO');
    const desk = normalizeDesk({
      version: 2,
      workspaces: [
        {
          name: 'MVRV',
          asset: 'DOGE',
          metric: 'net:mvrv',
          period: '5y',
          dateWindow: { from: 1700000000, to: 1800000000 },
        },
      ],
    });
    const p = new URL(workspaceUrl(desk.workspaces[0]), 'https://test.invalid').searchParams;
    expect(p.get('metric')).toBe('net:mvrv');
    expect(p.get('chart_from')).toBe('1700000000');
  });
  it('pins model-specific currencies and exchange-volume sources', () => {
    expect(
      new URL(
        indicatorUrl('BTC', 'view:btc_rainbow', new URLSearchParams('price_source=upbit')),
        'https://test.invalid',
      ).searchParams.get('price_source'),
    ).toBe('reference');
    expect(
      new URL(indicatorUrl('DOGE', 'view:vwap'), 'https://test.invalid').searchParams.get(
        'price_source',
      ),
    ).toBe('binance');
    expect(indicatorDefinition('view:btc_rainbow')?.assets).toEqual(['BTC']);
    expect(indicatorDefinition('relative')?.unit).toBe('BTC/자산');
  });
});
describe('expanding BTC log regression', () => {
  it('matches independently calculated batch least squares and population residual variance', () => {
    const p = history(760),
      r = btcRainbow(p)[0],
      prior = p.slice(0, 730);
    const x = prior.map((p) => Math.log((p.time - genesis) / DAY)),
      y = prior.map((p) => Math.log(p.value));
    const mx = x.reduce((a, b) => a + b) / x.length,
      my = y.reduce((a, b) => a + b) / y.length;
    const b =
        x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) /
        x.reduce((s, v) => s + (v - mx) ** 2, 0),
      a = my - b * mx;
    const sigma = Math.sqrt(y.reduce((s, v, i) => s + (v - a - b * x[i]) ** 2, 0) / y.length);
    expect(r.a).toBeCloseTo(a, 10);
    expect(r.b).toBeCloseTo(b, 10);
    expect(r.sigma).toBeCloseTo(sigma, 10);
    expect(r.bands).toHaveLength(10);
    expect(RAINBOW_OFFSETS).toHaveLength(10);
    expect(r.last).toBeLessThan(r.time);
    expect(r.observations).toBe(730);
  });
  it('never revises a past fit using current or future prices', () => {
    const p = history(800),
      r = btcRainbow(p);
    const changed = p.map((v, i) => (i >= 760 ? { ...v, value: v.value * 100 } : v));
    expect(btcRainbow(changed).slice(0, 30)).toEqual(r.slice(0, 30));
    expect(btcRainbow([...p, ...history(900).slice(800)]).slice(0, r.length)).toEqual(r);
  });
  it('handles missing days, duplicates, invalid samples, flat prices and minimum history', () => {
    expect(btcRainbow(history(730))).toEqual([]);
    const p = history(750);
    expect(btcRainbow([p[0], ...p])).toEqual(btcRainbow(p));
    const gaps = p.filter((_, i) => i !== 50);
    expect(btcRainbow(gaps)[0].observations).toBe(730);
    const flat = p.map((p) => ({ ...p, value: 100 }));
    expect(btcRainbow(flat).every((p) => p.z === null && p.sigma === 0)).toBe(true);
    expect(btcRainbow([...p.slice(0, 729), { ...p[729], value: NaN }])).toEqual([]);
  });
});

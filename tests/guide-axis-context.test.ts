import { describe, expect, it } from 'vitest';
import { guideArticle, guideChartLink, guideContext, guideHref } from '../shared/learning-catalog';
import { axisPreference } from '../shared/price-axis';
import { ASSETS } from '../shared/catalog';
import { validPriceBasis } from '../shared/indicator-catalog';
import type { Asset } from '../shared/types';

const query = (href: string) => new URL(href, 'https://bori.test').searchParams;
const open = (
  id: string,
  params: URLSearchParams,
  asset: Asset = 'DOGE',
  source: 'reference' | 'upbit' | 'binance' = 'reference',
) => query(guideChartLink(guideArticle(id)!, asset, source, params)!);

describe('dictionary chart display context', () => {
  it('uses the same available source as the screen for every asset', () => {
    for (const { id } of ASSETS)
      for (const source of [null, 'reference', 'upbit', 'binance']) {
        const params = new URLSearchParams({ asset: id, log: '0' });
        if (source) params.set('price_source', source);
        const context = guideContext(params);
        expect(context.get('price_source'), id + ':' + source).toBe(validPriceBasis(id, source));
        expect(context.get('guide_context_source'), id + ':' + source).toBe(
          validPriceBasis(id, source),
        );
      }
  });

  it.each([
    ['TAO', 'binance'],
    ['DRV', 'upbit'],
  ] as const)(
    'keeps an explicit axis when %s uses its actual default %s source',
    (asset, source) => {
      const params = new URLSearchParams({ asset, log: '0' });
      const result = open('candles', params, asset, source);
      expect(result.get('price_source')).toBe(source);
      expect(result.get('log')).toBe('0');
      expect(result.get('metric')).toBe('view:price');
    },
  );
  it('does not manufacture an explicit axis for a new dictionary visit', () => {
    const params = new URLSearchParams('asset=DOGE');
    expect(guideContext(params).has('log')).toBe(false);
    const mvrv = open('net-mvrv', query(guideHref('net-mvrv', params)));
    expect(mvrv.get('metric')).toBe('net:mvrv');
    expect(mvrv.has('log')).toBe(false);
    expect(axisPreference('net:mvrv', mvrv.get('log'))).toBe('linear');
    const price = open('candles', query(guideHref('candles', params)));
    expect(price.get('metric')).toBe('view:price');
    expect(price.has('log')).toBe(false);
    expect(axisPreference('view:price', price.get('log'))).toBe('log');
  });

  it.each(['0', '1'])('respects legacy explicit axis %s without a metric identity', (log) => {
    const params = query(guideHref('net-mvrv', new URLSearchParams({ asset: 'DOGE', log })));
    expect(open('net-mvrv', params).get('log')).toBe(log);
  });

  it('preserves a focused RSI identity and an old same-chart URL without origin fields', () => {
    const oldLink = new URLSearchParams(
      'asset=DOGE&metric=rsi&price_source=upbit&log=0&chart_from=1700000000&chart_to=1750000000&reading_date=1710000000',
    );
    const restored = open('rsi', oldLink, 'DOGE', 'upbit');
    for (const key of ['metric', 'log', 'chart_from', 'chart_to', 'reading_date'])
      expect(restored.get(key), key).toBe(oldLink.get(key));
  });

  it.each(['asset=DOGE&log=1', 'asset=DOGE&metric=net:mvrv&log=1'])(
    'binds the actual default source before editing a legacy guide: %s',
    (value) => {
      const params = guideContext(new URLSearchParams(value));
      params.set('price_source', 'upbit');
      const next = open('net-mvrv', params, 'DOGE', 'upbit');
      expect(next.has('log')).toBe(false);
      expect(next.get('price_source')).toBe('upbit');
    },
  );

  it('does not carry a metric-free explicit axis when the guide selects another coin', () => {
    const params = guideContext(new URLSearchParams('asset=BTC&price_source=reference&log=1'));
    params.set('asset', 'DOGE');
    expect(open('net-mvrv', params).has('log')).toBe(false);
  });

  it('clears another destination asset/source from an old explicit chart link', () => {
    const oldLink = new URLSearchParams(
      'asset=BTC&metric=view:asset_rainbow&price_source=reference&log=0&rainbow_model=own-1',
    );
    for (const [asset, source] of [
      ['DOGE', 'reference'],
      ['BTC', 'upbit'],
    ] as const) {
      const next = open('asset-rainbow', oldLink, asset, source);
      expect(next.has('log')).toBe(false);
      expect(next.has('rainbow_model')).toBe(false);
    }
  });

  it('preserves the same chart axis, viewport, pinned date and model', () => {
    const original = new URLSearchParams(
      'asset=BTC&metric=view:btc_rainbow_original&price_source=reference&log=0&period=5y&reading_date=1700000000&chart_from=1600000000&chart_to=1750000000&rainbow_model=original-1&rainbow_revision=verified-1&rainbow_origin=coinmetrics-BTC&rainbow_unit=USD',
    );
    const params = query(guideHref('btc-rainbow-original', original));
    const restored = open('btc-rainbow-original', params, 'BTC');
    for (const [key, value] of original) expect(restored.get(key), key).toBe(value);
    expect([...restored.keys()].some((key) => key.startsWith('guide_context_'))).toBe(false);
  });

  it('does not carry a price axis or Original model into another indicator', () => {
    const params = query(
      guideHref(
        'net-mvrv',
        new URLSearchParams(
          'asset=BTC&metric=view:btc_rainbow_original&price_source=reference&log=1&rainbow_model=original-1&rainbow_unit=USD',
        ),
      ),
    );
    const next = open('net-mvrv', params, 'BTC');
    expect(next.get('metric')).toBe('net:mvrv');
    expect(next.has('log')).toBe(false);
    expect(next.has('rainbow_model')).toBe(false);
    expect(next.has('rainbow_unit')).toBe(false);
  });

  it.each(['asset', 'price_source'])(
    'clears another chart display context after changing %s inside the dictionary',
    (key) => {
      const original = new URLSearchParams(
        'asset=BTC&metric=view:asset_rainbow&price_source=reference&log=0&rainbow_model=own-1&rainbow_origin=coinmetrics-BTC&rainbow_anchor=2010-07-17&rainbow_revision=r1&rainbow_unit=USD&rainbow_source=coinmetrics',
      );
      const params = query(guideHref('asset-rainbow', original));
      params.set(key, key === 'asset' ? 'DOGE' : 'upbit');
      const next = open(
        'asset-rainbow',
        params,
        key === 'asset' ? 'DOGE' : 'BTC',
        key === 'price_source' ? 'upbit' : 'reference',
      );
      expect(next.has('log')).toBe(false);
      expect([...next.keys()].some((name) => name.startsWith('rainbow_'))).toBe(false);
    },
  );
});

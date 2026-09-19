import { describe, expect, it } from 'vitest';
import { createComparisonLoader } from '../src/comparison-data';
import type { Asset, Candle, CandleResponse } from '../shared/types';
const DAY = 86400;
const START = Date.parse('2017-08-17T00:00:00Z') / 1000;
const series = (count: number): Candle[] =>
  Array.from({ length: count }, (_, i) => ({
    time: START + i * DAY,
    closeTime: START + (i + 1) * DAY,
    open: i + 1,
    high: i + 1,
    low: i + 1,
    close: i + 1,
    volume: 1,
    closed: true,
  }));
function source(data: Candle[], onCall?: (url: URL) => void) {
  return async (raw: string): Promise<CandleResponse> => {
    const url = new URL(raw, 'https://local.invalid');
    onCall?.(url);
    const from = Number(url.searchParams.get('from')),
      to = Number(url.searchParams.get('to'));
    const matching = data.filter((row) => row.time >= from && row.time < to);
    const rows = matching.slice(0, 1000);
    return {
      data: rows,
      nextCursor: matching.length > 1000 ? rows.at(-1)!.closeTime : null,
      meta: {
        source: 'test-exchange',
        market: 'binance',
        unit: 'USDT',
        historyStart: START,
        dataAsOf: data.at(-1)!.time,
        fetchedAt: 1234,
        stale: false,
        calculationVersion: 'fixture',
      },
    };
  };
}
describe('comparison history transport and covering cache', () => {
  it('loads a long history once and reuses it for shorter windows without changing provenance', async () => {
    let calls = 0;
    const data = series(3500);
    const loader = createComparisonLoader(source(data, () => calls++));
    const signal = new AbortController().signal;
    const full = await loader('BTC', 'binance', 0, START + 3500 * DAY, signal);
    expect(full.data).toEqual(data);
    expect(calls).toBe(4);
    const recent = await loader('BTC', 'binance', START + 3400 * DAY, START + 3500 * DAY, signal);
    expect(recent.data).toEqual(data.slice(3400));
    expect(calls).toBe(4);
    expect(recent.meta.fetchedAt).toBe(1234);
    expect(recent.meta.historyStart).toBe(START);
    recent.data.pop();
    expect(full.data).toHaveLength(3500);
  });
  it('bounds all assets and their page requests to four concurrent requests', async () => {
    let active = 0,
      peak = 0;
    const provider = source(series(3500));
    const loader = createComparisonLoader(async (url) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 3));
      try {
        return await provider(url);
      } finally {
        active--;
      }
    });
    const assets: Asset[] = ['BTC', 'DOGE', 'ETH', 'SOL', 'XRP', 'LINK', 'ONDO', 'PEPE'];
    const results = await Promise.all(
      assets.map((asset) =>
        loader(asset, 'binance', 0, START + 3500 * DAY, new AbortController().signal),
      ),
    );
    expect(peak).toBe(4);
    expect(results.every((result) => result.data.length === 3500)).toBe(true);
  });
  it('expires cache and invalidates a wider stale copy after a forced refresh', async () => {
    let time = 0,
      calls = 0,
      price = 100;
    const provider = source(series(30), () => calls++);
    const loader = createComparisonLoader(
      async (url) => {
        const value = await provider(url);
        return { ...value, data: value.data.map((row) => ({ ...row, close: price })) };
      },
      () => time,
    );
    const signal = new AbortController().signal;
    await loader('BTC', 'binance', START, START + 30 * DAY, signal);
    price = 200;
    const updated = await loader(
      'BTC',
      'binance',
      START + 20 * DAY,
      START + 30 * DAY,
      signal,
      true,
    );
    expect(updated.data[0].close).toBe(200);
    const hit = await loader('BTC', 'binance', START + 25 * DAY, START + 30 * DAY, signal);
    expect(hit.data[0].close).toBe(200);
    expect(calls).toBe(2);
    time = 15 * 60000;
    await loader('BTC', 'binance', START + 25 * DAY, START + 30 * DAY, signal);
    expect(calls).toBe(3);
  });
  it('does not cache aborted or partial failed histories', async () => {
    let calls = 0;
    const controller = new AbortController();
    const provider = source(series(2000), () => calls++);
    let fail = true;
    const loader = createComparisonLoader(async (url) => {
      const value = await provider(url);
      if (fail && value.data[0]?.time !== START) throw new Error('page failed');
      return value;
    });
    await expect(
      loader('BTC', 'binance', START, START + 2000 * DAY, controller.signal),
    ).rejects.toThrow('page failed');
    const before = calls;
    fail = false;
    expect(
      (await loader('BTC', 'binance', START, START + 2000 * DAY, controller.signal)).data,
    ).toHaveLength(2000);
    expect(calls).toBeGreaterThan(before);
    controller.abort();
    await expect(
      loader('BTC', 'binance', START, START + 2000 * DAY, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('rejects out-of-range observations and a non-advancing cursor', async () => {
    const provider = source(series(2000));
    const signal = new AbortController().signal;
    const outside = createComparisonLoader(async (url) => {
      const value = await provider(url);
      return { ...value, data: [{ ...value.data[0], time: START - DAY }] };
    });
    await expect(outside('BTC', 'binance', START, START + 2000 * DAY, signal)).rejects.toThrow(
      '범위',
    );
    const cursor = createComparisonLoader(async (url) => ({
      ...(await provider(url)),
      nextCursor: START,
    }));
    await expect(cursor('BTC', 'binance', START, START + 2000 * DAY, signal)).rejects.toThrow(
      '범위',
    );
  });
});

import type { Asset, CandleResponse, Market } from '../shared/types';

type FetchPage = (url: string, signal?: AbortSignal) => Promise<CandleResponse>;
const DAY = 86400;
const TTL = 15 * 60000;
const abortError = () => new DOMException('Aborted', 'AbortError');

/** Bounded page fan-out and covering-range cache, shared by all comparison assets. */
export function createComparisonLoader(fetchPage: FetchPage, clock = () => Date.now()) {
  const cache = new Map<string, { from: number; to: number; value: CandleResponse; at: number }>();
  const queue: {
    run: () => Promise<CandleResponse>;
    signal: AbortSignal;
    resolve: (value: CandleResponse) => void;
    reject: (reason: unknown) => void;
  }[] = [];
  let active = 0;
  const pump = () => {
    while (active < 4 && queue.length) {
      const task = queue.shift()!;
      if (task.signal.aborted) {
        task.reject(abortError());
        continue;
      }
      active++;
      void task
        .run()
        .then(task.resolve, task.reject)
        .finally(() => {
          active--;
          pump();
        });
    }
  };
  const request = (url: string, signal: AbortSignal) =>
    new Promise<CandleResponse>((resolve, reject) => {
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      queue.push({ run: () => fetchPage(url, signal), signal, resolve, reject });
      pump();
    });
  const slice = (value: CandleResponse, from: number, to: number): CandleResponse => {
    const data = value.data.filter((candle) => candle.time >= from && candle.time < to);
    let gapCount = 0;
    for (let i = 1; i < data.length; i++) if (data[i].time - data[i - 1].time > DAY) gapCount++;
    return { data, meta: { ...value.meta, gapCount }, nextCursor: null };
  };
  return async function load(
    asset: Asset,
    market: Market,
    from: number,
    to: number,
    signal: AbortSignal,
    force = false,
  ): Promise<CandleResponse> {
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      from < 0 ||
      to <= from ||
      from % DAY ||
      to % DAY
    )
      throw new Error('비교 일봉의 조회 범위가 올바르지 않습니다.');
    if (signal.aborted) throw abortError();
    const prefix = asset + ':' + market + ':';
    for (const [key, hit] of cache) {
      if (clock() - hit.at >= TTL) {
        cache.delete(key);
        continue;
      }
      if (!force && key.startsWith(prefix) && hit.from <= from && hit.to >= to)
        return slice(hit.value, from, to);
    }
    const page = async (start: number, end: number) => {
      const value = await request(
        `/api/v1/candles?asset=${asset}&market=${market}&interval=1d&from=${start}&to=${end}&limit=1000`,
        signal,
      );
      if (
        !Array.isArray(value.data) ||
        value.data.length > 1000 ||
        !value.meta ||
        value.data.some(
          (candle) =>
            !candle ||
            typeof candle !== 'object' ||
            !Number.isFinite(candle.time) ||
            candle.time < start ||
            candle.time >= end,
        ) ||
        (value.nextCursor !== null &&
          (!Number.isFinite(value.nextCursor) ||
            value.nextCursor <= start ||
            value.nextCursor >= end))
      )
        throw new Error(asset + ' 일봉 응답의 형식·날짜 범위를 확인할 수 없습니다.');
      return value;
    };
    const first = await page(from, to);
    const chunks = [first];
    if (first.nextCursor !== null) {
      const windows: { from: number; to: number }[] = [];
      for (let start = first.nextCursor; start < to; start += 900 * DAY) {
        if (windows.length >= 20) throw new Error(asset + ' 비교 이력이 조회 한도를 초과했습니다.');
        windows.push({ from: start, to: Math.min(start + 900 * DAY, to) });
      }
      const rest = await Promise.all(
        windows.map(async (window) => {
          const value = await page(window.from, window.to);
          if (value.nextCursor !== null)
            throw new Error(asset + ' 일봉 페이지의 관측 간격이 일치하지 않습니다.');
          return value;
        }),
      );
      chunks.push(...rest);
    }
    if (signal.aborted) throw abortError();
    const data = [
      ...new Map(
        chunks.flatMap((chunk) => chunk.data).map((candle) => [candle.time, candle]),
      ).values(),
    ].sort((a, b) => a.time - b.time);
    const value = slice(
      {
        data,
        meta: {
          ...first.meta,
          stale: chunks.some((chunk) => chunk.meta.stale),
          warning: chunks.find((chunk) => chunk.meta.warning)?.meta.warning,
        },
        nextCursor: null,
      },
      from,
      to,
    );
    // A wider result replaces narrower copies. Keep source metadata intact when slicing.
    for (const [key, hit] of cache)
      if (key.startsWith(prefix) && (force || (from <= hit.from && to >= hit.to)))
        cache.delete(key);
    while (cache.size >= 32) cache.delete(cache.keys().next().value!);
    cache.set(prefix + from + ':' + to, { from, to, value, at: clock() });
    return value;
  };
}

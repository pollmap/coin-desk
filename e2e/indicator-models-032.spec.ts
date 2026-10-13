import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { DAY, rsi } from '../shared/math';
import {
  assetRainbowOrigin,
  assetRainbowContext,
  assetRainbowDiagnostics,
  ASSET_RAINBOW_VERSION,
  ASSET_RAINBOW_ANCHOR_VERSION,
} from '../shared/asset-rainbow';
import type { Candle, Point } from '../shared/types';
import type { ObservationSignal } from '../shared/signals';
import { hashRibbons, hashrateTrend } from '../shared/hash-ribbons';

// Explicit synthetic observations in an isolated browser fixture. These tests do not
// query providers or certify production coverage, provider freshness or trading signals.
const latestClosedDay = Math.floor(Date.now() / 1000 / DAY) * DAY - DAY;
function daily(values: number[]): Point[] {
  const first = latestClosedDay - (values.length - 1) * DAY;
  return values.map((value, index) => ({ time: first + index * DAY, value }));
}
function series(data: Point[], unit: string, asset: string) {
  return {
    data,
    price: [],
    nextCursor: null,
    meta: {
      source: 'Explicit synthetic E2E fixture',
      unit,
      market: `${asset} / isolated test data`,
      dataAsOf: data.at(-1)?.time ?? null,
      fetchedAt: latestClosedDay + DAY,
      historyStart: data[0]?.time ?? null,
      stale: false,
      calculationVersion: 'e2e-models-032',
      observationInterval: '1d',
    },
  };
}
function rainbowPrices(): Point[] {
  const origin = assetRainbowOrigin('DOGE', 'reference')!;
  return daily(Array(850).fill(0)).map((point, index) => ({
    time: point.time,
    value:
      0.002 * Math.sqrt(1 + (point.time - origin) / DAY) * Math.exp(0.08 * Math.sin(index / 11)),
  }));
}
function independentLastPosition(points: Point[], origin: number): number {
  const prior = points.slice(0, -1);
  const x = prior.map((point) => Math.log1p((point.time - origin) / DAY));
  const y = prior.map((point) => Math.log(point.value));
  const meanX = x.reduce((sum, value) => sum + value, 0) / x.length;
  const meanY = y.reduce((sum, value) => sum + value, 0) / y.length;
  const b =
    x.reduce((sum, value, index) => sum + (value - meanX) * (y[index] - meanY), 0) /
    x.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
  const a = meanY - b * meanX;
  const sigma = Math.sqrt(
    y.reduce((sum, value, index) => sum + (value - a - b * x[index]) ** 2, 0) / y.length,
  );
  const last = points.at(-1)!;
  return (Math.log(last.value) - a - b * Math.log1p((last.time - origin) / DAY)) / sigma;
}
async function referenceFixture(page: Page, state: { points: Point[] }) {
  const requests: string[] = [];
  await page.route('**/api/v1/reference?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('asset') !== 'DOGE') return route.continue();
    requests.push(url.href);
    await route.fulfill({ json: series(state.points, 'USD', 'DOGE') });
  });
  return requests;
}
async function hashFixture(page: Page, count = 400, priceAvailable = true) {
  const hash = daily(
    [100, 50, 200, 20, 300].flatMap((value) => Array(80).fill(value)).slice(-count),
  );
  const price = hash.map((point, index) => ({ time: point.time, value: 100 + index }));
  const requestedAssets: string[] = [];
  let priceRequests = 0;
  await page.route('**/api/v1/network?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('metric') !== 'hashrate') return route.continue();
    const asset = url.searchParams.get('asset')!;
    requestedAssets.push(asset);
    await route.fulfill({
      json: series(hash, ['DASH', 'ZEC'].includes(asset) ? 'GH/s' : 'TH/s', asset),
    });
  });
  await page.route('**/api/v1/reference?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('asset') !== 'BTC') return route.continue();
    priceRequests++;
    await route.fulfill({ json: series(priceAvailable ? price : [], 'USD', 'BTC') });
  });
  return { hash, price, requestedAssets, priceRequests: () => priceRequests };
}
function chart(page: Page) {
  return page.locator('[data-chart-kind="analysis"]');
}

function positionLabel(z: number): string {
  return z < -1.3
    ? '깊은 하단'
    : z < -0.55
      ? '하단'
      : z <= 0.55
        ? '중앙'
        : z <= 1.3
          ? '상단'
          : '높은 상단';
}
async function focusedOnly(page: Page) {
  await expect(
    page.locator(
      '.analysis-reading-date,.indicator-provenance,.indicator-transition-list,.chart-readings-table',
    ),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: '데이터 정보', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /CSV|내보내기|공유/ })).toHaveCount(0);
}
async function latestStays(page: Page) {
  const summary = page.locator('.analysis-reading-value');
  const value = await summary.innerText();
  const before = new URL(page.url()).searchParams.get('reading_date');
  const box = (await chart(page).boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await expect(page.getByTestId('chart-tooltip')).toBeVisible();
  await expect(page.getByTestId('chart-tooltip')).not.toHaveText(/\d{4}-\d{2}-\d{2}/);
  await chart(page).click({ position: { x: box.width * 0.5, y: box.height * 0.4 } });
  await chart(page).press('ArrowLeft');
  await expect(summary).toHaveText(value);
  expect(new URL(page.url()).searchParams.get('reading_date')).toBe(before);
  await focusedOnly(page);
}

test('asset rainbow preserves independent full-source regression while periods change only the window', async ({
  page,
}) => {
  const state = { points: rainbowPrices() };
  const requests = await referenceFixture(page, state);
  await page.goto('/coins/DOGE?metric=view:asset_rainbow&price_source=reference&period=all');
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  const origin = assetRainbowOrigin('DOGE', 'reference')!;
  const z = independentLastPosition(state.points, origin);
  expect(assetRainbowDiagnostics(state.points, origin).rows.at(-1)!.z).toBeCloseTo(z, 7);
  await expect(page.locator('.band-context')).toHaveText(positionLabel(z));
  await expect(chart(page)).toHaveAttribute('data-observations', '850');
  await expect(page).toHaveURL(new RegExp('rainbow_model=' + ASSET_RAINBOW_VERSION));
  const before = new URL(page.url()).searchParams;
  expect(before.get('rainbow_origin')).toBe(String(origin));
  expect(before.get('rainbow_anchor')).toBe(ASSET_RAINBOW_ANCHOR_VERSION);
  expect(before.get('rainbow_source')).toBe('reference');
  expect(before.get('rainbow_unit')).toBe('USD');
  expect(before.get('rainbow_revision')).toMatch(/^obs-v1-[0-9a-f]{16}$/);
  const requestCount = requests.length;
  const originalFrom = await chart(page).getAttribute('data-visible-from');
  await page
    .locator('.period-picker .segments')
    .getByRole('button', { name: '1년', exact: true })
    .click();
  await expect(
    page.locator('.period-picker .segments').getByRole('button', { name: '1년', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(chart(page)).not.toHaveAttribute('data-visible-from', originalFrom!);
  await expect(page.locator('.band-context')).toHaveText(positionLabel(z));
  expect(requests).toHaveLength(requestCount);
  expect(new URL(page.url()).searchParams.get('rainbow_revision')).toBe(
    before.get('rainbow_revision'),
  );
  await latestStays(page);
  await expect(page.locator('.indicator-workspace')).not.toContainText(
    ASSET_RAINBOW_ANCHOR_VERSION,
  );
  await expect(page.locator('.indicator-workspace')).not.toContainText(ASSET_RAINBOW_VERSION);
});

test('saved rainbow restores frozen model context while corrected observations are actually recalculated', async ({
  page,
}) => {
  const state = { points: rainbowPrices() };
  await referenceFixture(page, state);
  await page.goto('/coins/DOGE?metric=view:asset_rainbow&price_source=reference&period=all');
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  await expect(page).toHaveURL(/rainbow_revision=obs-v1-/);
  const saved = new URL(page.url()).searchParams;
  await page.getByRole('button', { name: '분석 저장', exact: true }).click();
  await page.getByLabel('작업공간 이름', { exact: true }).fill('원천별 레인보우 검증');
  await page.getByRole('button', { name: '현재 구성 저장', exact: true }).click();
  await page.getByRole('button', { name: '분석 저장 닫기', exact: true }).click();
  await page.goto('/workspace');
  state.points = state.points.map((point, index) =>
    index === 740 ? { ...point, value: point.value * 1.2 } : point,
  );
  const current = assetRainbowContext('DOGE', 'reference', state.points);
  expect(current.dataRevision).not.toBe(saved.get('rainbow_revision'));
  await page.getByRole('link', { name: /원천별 레인보우 검증/ }).click();
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  const restored = new URL(page.url()).searchParams;
  for (const key of [
    'rainbow_origin',
    'rainbow_anchor',
    'rainbow_model',
    'rainbow_source',
    'rainbow_unit',
    'rainbow_revision',
  ])
    expect(restored.get(key)).toBe(saved.get(key));
  const z = independentLastPosition(state.points, current.origin!);
  expect(assetRainbowDiagnostics(state.points, current.origin!).rows.at(-1)!.z).toBeCloseTo(z, 7);
  await expect(page.locator('.band-context')).toHaveText(positionLabel(z));
  await focusedOnly(page);
});

for (const [key, value] of [
  ['rainbow_model', 'unknown-v99'],
  ['rainbow_anchor', 'unknown-anchor'],
  ['rainbow_origin', '86400'],
  ['rainbow_source', 'upbit'],
  ['rainbow_unit', 'KRW'],
]) {
  test(
    'unverified ' + key + ' blocks history and requires an explicit model reset',
    async ({ page }) => {
      const requests = await referenceFixture(page, { points: rainbowPrices() });
      await page.goto(
        '/coins/DOGE?metric=view:asset_rainbow&price_source=reference&period=all&' +
          key +
          '=' +
          value,
      );
      await expect(
        page.getByText('저장한 분석 설정을 적용할 수 없습니다.', { exact: true }),
      ).toBeVisible();
      await expect(page.locator('.indicator-workspace')).toHaveAttribute(
        'data-availability',
        'unsupported',
      );
      await expect(chart(page)).toHaveCount(0);
      expect(requests).toHaveLength(0);
      await page.getByRole('button', { name: '현재 모델로 열기', exact: true }).click();
      await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
      await expect(page).toHaveURL(new RegExp('rainbow_anchor=' + ASSET_RAINBOW_ANCHOR_VERSION));
      expect(requests).toHaveLength(1);
      await focusedOnly(page);
    },
  );
}

test('BTC hash ribbons preserve exact latest means and one event per recovery cycle without public event lists', async ({
  page,
}) => {
  const fixture = await hashFixture(page);
  await page.goto('/coins/BTC?metric=view:hash_ribbons&period=all&price_source=reference');
  await expect(chart(page)).toHaveAttribute('data-primary-metric', 'view:hash_ribbons');
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  const calculated = hashRibbons(fixture.hash, fixture.price);
  const events = calculated.flatMap((row) =>
    row.events.map((event) => ({ event, time: row.time })),
  );
  expect(events.filter((event) => event.event === 'decrease')).toHaveLength(2);
  expect(events.filter((event) => event.event === 'recovery')).toHaveLength(2);
  expect(
    events.filter((event) => event.event === 'price-confirmed').map((event) => event.time),
  ).toEqual([fixture.hash[160].time, fixture.hash[320].time]);
  const mean30 = fixture.hash.slice(-30).reduce((sum, point) => sum + point.value, 0) / 30;
  const mean60 = fixture.hash.slice(-60).reduce((sum, point) => sum + point.value, 0) / 60;
  expect(
    Number(
      (await page.locator('.analysis-reading-value > span').first().innerText()).replace(/,/g, ''),
    ),
  ).toBeCloseTo(mean30, 2);
  const secondary = page.locator('.analysis-secondary-readings .analysis-secondary-reading');
  await expect(secondary).toHaveCount(1);
  await expect(secondary).toContainText('60일 평균');
  expect(Number((await secondary.locator('b').innerText()).replace(/,/g, ''))).toBeCloseTo(
    mean60,
    2,
  );
  await expect(page.locator('.analysis-legend')).toContainText('TH/s');
  expect(fixture.requestedAssets).toEqual(['BTC']);
  expect(fixture.priceRequests()).toBe(1);
  await latestStays(page);
});

test('short hash history keeps the sixty-day preparation contract without displaying diagnostics', async ({
  page,
}) => {
  const fixture = await hashFixture(page, 30);
  await page.goto('/coins/BTC?metric=view:hash_ribbons&price_source=reference&period=all');
  await expect(page.locator('.indicator-workspace')).toHaveAttribute(
    'data-availability',
    'insufficient-history',
  );
  expect(fixture.hash).toHaveLength(30);
  expect(hashRibbons(fixture.hash, fixture.price)).toEqual([]);
  expect(fixture.requestedAssets).toEqual(['BTC']);
  expect(fixture.priceRequests()).toBe(1);
  await expect(page.getByText('아직 이 지표를 표시할 수 없습니다.', { exact: true })).toBeVisible();
  await expect(chart(page)).toHaveCount(0);
  await expect(page.locator('.indicator-workspace')).not.toContainText('60일이 필요');
  await expect(page.getByRole('link', { name: '가격 차트 보기', exact: true })).toBeVisible();
});

test('missing BTC price conditions preserve hash means without fabricating price confirmations', async ({
  page,
}) => {
  const fixture = await hashFixture(page, 400, false);
  await page.goto('/coins/BTC?metric=view:hash_ribbons&price_source=reference&period=all');
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  await expect(page.getByText('가격 조건을 표시할 수 없습니다.', { exact: true })).toBeVisible();
  const calculated = hashRibbons(fixture.hash, []);
  expect(calculated.flatMap((row) => row.events)).toHaveLength(4);
  expect(calculated.some((row) => row.events.includes('price-confirmed'))).toBe(false);
  await expect(page.locator('.analysis-secondary-readings')).toContainText('60일 평균');
  expect(fixture.priceRequests()).toBe(1);
  await focusedOnly(page);
});

test('PoW hash trends keep GH/s units and cannot become ETH mining or BTC price confirmations', async ({
  page,
}) => {
  const fixture = await hashFixture(page);
  await page.goto('/coins/DASH?metric=view:hashrate_trend&price_source=binance&period=all');
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  await expect(page.locator('.analysis-legend')).toContainText('GH/s');
  await expect(page.locator('.analysis-legend')).not.toContainText('TH/s');
  expect(hashrateTrend(fixture.hash).some((row) => row.events.includes('price-confirmed'))).toBe(
    false,
  );
  expect(fixture.priceRequests()).toBe(0);
  await focusedOnly(page);
  await page.goto('/coins/ETH?metric=view:hash_ribbons&period=all');
  await expect(page.locator('.indicator-workspace')).toHaveAttribute(
    'data-availability',
    'unsupported',
  );
  await expect(chart(page)).toHaveCount(0);
  await expect(page.locator('.indicator-empty')).toContainText('ETH');
  await expect(page.locator('.indicator-empty')).toContainText('사용할 수 없습니다.');
  await expect(page.getByRole('link', { name: '사용 가능한 분석 열기' })).toBeVisible();
  expect(fixture.requestedAssets).toEqual(['DASH']);
  expect(fixture.priceRequests()).toBe(0);
});

async function legacyFixture(
  page: Page,
  status: ObservationSignal['status'] | 'missing',
  options: { rule?: ObservationSignal['rule']; source?: string } = {},
) {
  const observations = daily(Array.from({ length: 160 }, (_, index) => (index < 80 ? 0.9 : 1.25)));
  const time = observations[80].time;
  const rule = options.rule ?? 'mvrv1';
  const source = options.source ?? 'coinmetrics';
  const signal: ObservationSignal = {
    id: 'BTC:' + source + ':' + rule + ':' + time + ':up:observations-v1',
    asset: 'BTC',
    source,
    rule,
    time,
    previous: rule === 'rsi30' ? 25 : 0.9,
    previousTime: time - DAY,
    current: rule === 'rsi30' ? 35 : 1.25,
    threshold: rule === 'rsi30' ? 30 : 1,
    direction: 'up',
    condition: 'Explicit fixture ' + rule + ' crossing',
    unit: rule === 'rsi30' ? '지수' : '배',
    version: 'observations-v1',
    bar: '1d',
    status: status === 'missing' ? 'active' : status,
  };
  const requestedSignals: string[] = [];
  const signalResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/v1/signals' && url.searchParams.get('id') === signal.id;
  });
  await page.route('**/api/v1/network?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('asset') !== 'BTC' || url.searchParams.get('metric') !== 'mvrv')
      return route.continue();
    await route.fulfill({ json: series(observations, '배', 'BTC') });
  });
  await page.route('**/api/v1/signals?*', async (route) => {
    requestedSignals.push(new URL(route.request().url()).searchParams.get('id')!);
    await route.fulfill({ json: { data: status === 'missing' ? [] : [signal] } });
  });
  return { ...signal, requestedSignals, signalResponse };
}

for (const status of ['corrected', 'withdrawn', 'missing'] as const) {
  test(
    'legacy observation ' +
      status +
      ' preserves exact internal date semantics with a latest-only summary',
    async ({ page }) => {
      const signal = await legacyFixture(page, status);
      await page.goto(
        '/coins/BTC?' +
          new URLSearchParams({
            metric: 'net:mvrv',
            price_source: 'reference',
            period: 'all',
            signal: signal.id,
          }),
      );
      const response = await signal.signalResponse;
      expect(await response.json()).toEqual({
        data:
          status === 'missing'
            ? []
            : [
                Object.fromEntries(
                  Object.entries(signal).filter(
                    ([key]) => !['requestedSignals', 'signalResponse'].includes(key),
                  ),
                ),
              ],
      });
      await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
      expect(signal.requestedSignals).toEqual([signal.id]);
      if (status === 'corrected') {
        await expect(page).toHaveURL(new RegExp('reading_date=' + signal.time));
        await expect(page.locator('.analysis-reading-value')).toContainText('1.25');
        await latestStays(page);
      } else {
        // Hidden legacy links remain compatible without restoring removed public
        // observation notices or a date-clear control.
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        expect(new URL(page.url()).searchParams.has('reading_date')).toBe(false);
        expect(new URL(page.url()).searchParams.get('signal')).toBe(signal.id);
        await expect(page.locator('.analysis-reading-value')).toContainText('1.25');
        await expect(page.getByText(/선택한 전환을/)).toHaveCount(0);
        await expect(page.getByRole('button', { name: '최근값 보기', exact: true })).toHaveCount(0);
        await latestStays(page);
        await page.reload();
        await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
        await expect.poll(() => signal.requestedSignals).toEqual([signal.id, signal.id]);
        expect(new URL(page.url()).searchParams.has('reading_date')).toBe(false);
        expect(new URL(page.url()).searchParams.get('signal')).toBe(signal.id);
        await expect(page.locator('.analysis-reading-value')).toContainText('1.25');
      }
      await focusedOnly(page);
    },
  );
}

test('legacy reference RSI observations cannot pin an Upbit RSI chart or mix source values', async ({
  page,
}) => {
  const signal = await legacyFixture(page, 'active', { rule: 'rsi30', source: 'reference' });
  const upbitCandles = new Map<number, Candle>();
  const candleRequests: string[] = [];
  await page.route('**/api/v1/candles?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('asset') !== 'BTC' || url.searchParams.get('market') !== 'upbit')
      return route.continue();
    candleRequests.push(url.toString());
    const response = await route.fetch();
    const body = await response.json();
    for (const candle of body.data as Candle[]) upbitCandles.set(candle.time, candle);
    await route.fulfill({ response, json: body });
  });
  await page.goto(
    '/coins/BTC?' +
      new URLSearchParams({
        metric: 'rsi',
        price_source: 'upbit',
        period: 'all',
        signal: signal.id,
      }),
  );
  const response = await signal.signalResponse;
  expect((await response.json()).data[0].source).toBe('reference');
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  await expect(chart(page)).toHaveAttribute('data-primary-metric', 'rsi');
  expect(new URL(page.url()).searchParams.get('price_source')).toBe('upbit');
  expect(new URL(page.url()).searchParams.has('reading_date')).toBe(false);
  expect(new URL(page.url()).searchParams.get('signal')).toBe(signal.id);
  expect(signal.requestedSignals).toEqual([signal.id]);
  expect(candleRequests.length).toBeGreaterThan(0);
  expect(
    candleRequests.every((request) => new URL(request).searchParams.get('interval') === '1d'),
  ).toBe(true);
  const actualSource = [...upbitCandles.values()]
    .filter((candle) => candle.closed && candle.closeTime <= Date.now() / 1000)
    .sort((a, b) => a.time - b.time)
    .map((candle) => ({ time: candle.time, value: candle.close }));
  const sourceRsi = rsi(actualSource, 14).at(-1)!;
  expect(sourceRsi).toBeDefined();
  await expect(page.locator('.analysis-primary-unit')).toHaveText('RSI');
  const displayedNumber = await page
    .locator('.analysis-reading-value > span:not(.analysis-reading-asset)')
    .innerText();
  expect(Number(displayedNumber.replace(/,/g, ''))).toBeCloseTo(sourceRsi.value, 2);
  await expect(page.getByText(/선택한 전환을/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '전환 선택 해제', exact: true })).toHaveCount(0);
  await latestStays(page);
  expect(new URL(page.url()).searchParams.has('reading_date')).toBe(false);
});

test('an explicit legacy date wins over corrected signals while public summary and URL settings stay stable', async ({
  page,
}) => {
  const signal = await legacyFixture(page, 'corrected');
  const explicit = signal.time - 15 * DAY;
  await page.goto(
    '/coins/BTC?' +
      new URLSearchParams({
        metric: 'net:mvrv',
        price_source: 'reference',
        period: 'all',
        signal: signal.id,
        reading_date: String(explicit),
      }),
  );
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  expect(signal.requestedSignals).toEqual([signal.id]);
  expect(new URL(page.url()).searchParams.get('reading_date')).toBe(String(explicit));
  // This legacy date has a 0.9 historical observation; the public headline must show latest 1.25.
  await expect(page.locator('.analysis-reading-value')).toContainText('1.25');
  await latestStays(page);
  await page.reload();
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  expect(new URL(page.url()).searchParams.get('reading_date')).toBe(String(explicit));
  await expect(page.locator('.analysis-reading-value')).toContainText('1.25');
  await focusedOnly(page);
});

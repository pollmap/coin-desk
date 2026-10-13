import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { DAY } from '../shared/math';
import {
  assetRainbowOrigin,
  ASSET_RAINBOW_VERSION,
  ASSET_RAINBOW_ANCHOR_VERSION,
} from '../shared/asset-rainbow';
import type { Point } from '../shared/types';
import type { ObservationSignal } from '../shared/signals';

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

test('asset rainbow uses a full-source fit while period changes only the visible range', async ({
  page,
}) => {
  const state = { points: rainbowPrices() };
  const requests = await referenceFixture(page, state);
  await page.goto('/coins/DOGE?metric=view:asset_rainbow&price_source=reference&period=all');
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  const z = independentLastPosition(state.points, assetRainbowOrigin('DOGE', 'reference')!);
  await expect(page.locator('.band-context')).toContainText(z.toFixed(2) + 'σ');
  await expect(page).toHaveURL(new RegExp(`rainbow_model=${ASSET_RAINBOW_VERSION}`));
  const before = new URL(page.url()).searchParams;
  expect(before.get('rainbow_origin')).toBe(String(assetRainbowOrigin('DOGE', 'reference')));
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
  await expect(page.locator('.band-context')).toContainText(z.toFixed(2) + 'σ');
  expect(requests).toHaveLength(requestCount);
  expect(new URL(page.url()).searchParams.get('rainbow_revision')).toBe(
    before.get('rainbow_revision'),
  );
  await page.getByRole('button', { name: '데이터 정보', exact: true }).click();
  const info = page.getByRole('dialog', { name: '데이터 정보', exact: true });
  await expect(info).toContainText('850개 확정 관측');
  await expect(info).toContainText(ASSET_RAINBOW_ANCHOR_VERSION);
  await expect(info).toContainText(ASSET_RAINBOW_VERSION);
});

test('saved rainbow restores its model context and discloses later source revisions', async ({
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
  await page.getByRole('button', { name: '데이터 정보', exact: true }).click();
  const info = page.getByRole('dialog', { name: '데이터 정보', exact: true });
  await expect(info).toContainText('저장 이후 관측이 변경됐습니다.');
  await expect(info).toContainText('모형 설정은 유지하고 최신 수정 관측으로 계산합니다.');
});

for (const [key, value] of [
  ['rainbow_model', 'unknown-v99'],
  ['rainbow_anchor', 'unknown-anchor'],
  ['rainbow_origin', '86400'],
  ['rainbow_source', 'upbit'],
  ['rainbow_unit', 'KRW'],
]) {
  test(`unverified ${key} blocks history and requires an explicit current-model reset`, async ({
    page,
  }) => {
    const requests = await referenceFixture(page, { points: rainbowPrices() });
    await page.goto(
      `/coins/DOGE?metric=view:asset_rainbow&price_source=reference&period=all&${key}=${value}`,
    );
    await expect(
      page.getByText('저장한 레인보우 모델의 기준을 확인할 수 없습니다.', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('.indicator-workspace')).toHaveAttribute(
      'data-availability',
      'unsupported',
    );
    await expect(chart(page)).toHaveCount(0);
    expect(requests).toHaveLength(0);
    await page.getByRole('button', { name: '현재 모델로 열기', exact: true }).click();
    await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
    await expect(page).toHaveURL(new RegExp(`rainbow_anchor=${ASSET_RAINBOW_ANCHOR_VERSION}`));
    expect(requests).toHaveLength(1);
  });
}

test('BTC hash ribbons show actual calculated means and one event per recovery condition', async ({
  page,
}) => {
  const fixture = await hashFixture(page);
  await page.goto('/coins/BTC?metric=view:hash_ribbons&period=all&price_source=reference');
  await expect(chart(page)).toHaveAttribute('data-primary-metric', 'view:hash_ribbons');
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  await expect(page.locator('.analysis-secondary-readings')).toContainText('60일 평균');
  await expect(page.locator('.analysis-legend')).toContainText('TH/s');
  const transitions = page.locator('.indicator-transition-list');
  await expect(transitions.locator('summary')).toContainText('6개');
  await transitions.locator('summary').click();
  await expect(transitions.getByRole('button', { name: /해시레이트 감소 교차/ })).toHaveCount(2);
  await expect(transitions.getByRole('button', { name: /해시레이트 회복 교차/ })).toHaveCount(2);
  await expect(transitions.getByRole('button', { name: /회복 후 가격 조건 충족/ })).toHaveCount(2);
  expect(fixture.requestedAssets).toEqual(['BTC']);
  expect(fixture.priceRequests()).toBe(1);
  const selected = fixture.hash[320].time;
  await transitions
    .getByRole('button', { name: /회복 후 가격 조건 충족/ })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`reading_date=${selected}`));
  await expect(page.locator('.analysis-reading-date')).toContainText('날짜 고정');
  await expect(page.locator('.analysis-reading-date')).toContainText(
    new Date(selected * 1000).toISOString().slice(0, 10),
  );
});

test('short hash histories explain the sixty-day preparation condition precisely', async ({
  page,
}) => {
  await hashFixture(page, 30);
  await page.goto('/coins/BTC?metric=view:hash_ribbons&price_source=reference&period=all');
  await expect(page.locator('.indicator-workspace')).toHaveAttribute(
    'data-availability',
    'insufficient-history',
  );
  await expect(page.getByText(/연속한 확정 해시레이트 60일이 필요합니다\./)).toBeVisible();
  await expect(page.getByText(/현재 30개 일별 관측이 있습니다/)).toBeVisible();
  await expect(chart(page)).toHaveCount(0);
  await expect(page.getByText('아직 수집된 관측이 없습니다.', { exact: true })).toHaveCount(0);
});

test('missing BTC price conditions preserve hash lines without fabricating confirmations', async ({
  page,
}) => {
  await hashFixture(page, 400, false);
  await page.goto('/coins/BTC?metric=view:hash_ribbons&price_source=reference&period=all');
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  await expect(page.getByText(/USD 가격 이력이 없어 가격 조건은 표시하지 않습니다/)).toBeVisible();
  const transitions = page.locator('.indicator-transition-list');
  await expect(transitions.locator('summary')).toContainText('4개');
  await transitions.locator('summary').click();
  await expect(transitions.getByRole('button', { name: /회복 후 가격 조건 충족/ })).toHaveCount(0);
  await expect(page.locator('.analysis-secondary-readings')).toContainText('60일 평균');
});

test('PoW hash trend preserves source units and cannot become ETH mining or BTC confirmation', async ({
  page,
}) => {
  const fixture = await hashFixture(page);
  await page.goto('/coins/DASH?metric=view:hashrate_trend&price_source=binance&period=all');
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  await expect(page.locator('.analysis-legend')).toContainText('GH/s');
  await expect(page.locator('.analysis-legend')).not.toContainText('TH/s');
  const transitions = page.locator('.indicator-transition-list');
  await transitions.locator('summary').click();
  await expect(transitions.getByRole('button', { name: /회복 후 가격 조건 충족/ })).toHaveCount(0);
  expect(fixture.priceRequests()).toBe(0);
  await page.goto('/coins/ETH?metric=view:hash_ribbons&period=all');
  await expect(page.locator('.indicator-workspace')).toHaveAttribute(
    'data-availability',
    'unsupported',
  );
  await expect(chart(page)).toHaveCount(0);
  await expect(
    page.getByText('확보되지 않은 데이터를 다른 코인의 값으로 대체하지 않습니다.', { exact: true }),
  ).toBeVisible();
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
    id: `BTC:${source}:${rule}:${time}:up:observations-v1`,
    asset: 'BTC',
    source,
    rule,
    time,
    previous: rule === 'rsi30' ? 25 : 0.9,
    previousTime: time - DAY,
    current: rule === 'rsi30' ? 35 : 1.25,
    threshold: rule === 'rsi30' ? 30 : 1,
    direction: 'up',
    condition: `Explicit fixture ${rule} crossing`,
    unit: rule === 'rsi30' ? '지수' : '배',
    version: 'observations-v1',
    bar: '1d',
    status: status === 'missing' ? 'active' : status,
  };
  await page.route('**/api/v1/network?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('asset') !== 'BTC' || url.searchParams.get('metric') !== 'mvrv')
      return route.continue();
    await route.fulfill({ json: series(observations, '배', 'BTC') });
  });
  await page.route('**/api/v1/signals?*', async (route) => {
    await route.fulfill({ json: { data: status === 'missing' ? [] : [signal] } });
  });
  return signal;
}

for (const status of ['corrected', 'withdrawn', 'missing'] as const) {
  test(`legacy observation link handles ${status} without manufacturing a selected date`, async ({
    page,
  }) => {
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
    await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
    if (status === 'corrected') {
      await expect(
        page.getByText('원천 수정이 반영된 전환입니다. 현재 관측값으로 표시합니다.', {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`reading_date=${signal.time}`));
      await expect(page.locator('.analysis-reading-date')).toContainText(
        new Date(signal.time * 1000).toISOString().slice(0, 10),
      );
      await expect(page.locator('.analysis-reading-date')).toContainText('날짜 고정');
    } else {
      await expect(
        page.getByText(
          status === 'withdrawn'
            ? /선택한 전환은 원천 수정으로 철회됐습니다/
            : /선택한 전환을 찾을 수 없습니다/,
        ),
      ).toBeVisible();
      expect(new URL(page.url()).searchParams.has('reading_date')).toBe(false);
      await expect(page.locator('.analysis-reading-date')).toContainText('최근 확정값');
      await page.getByRole('button', { name: '최근값 보기', exact: true }).click();
      expect(new URL(page.url()).searchParams.has('signal')).toBe(false);
      await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
    }
  });
}

test('legacy reference RSI observations do not pin an Upbit RSI chart', async ({ page }) => {
  const signal = await legacyFixture(page, 'active', { rule: 'rsi30', source: 'reference' });
  await page.goto(
    '/coins/BTC?' +
      new URLSearchParams({
        metric: 'rsi',
        price_source: 'upbit',
        period: 'all',
        signal: signal.id,
      }),
  );
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  await expect(chart(page)).toHaveAttribute('data-primary-metric', 'rsi');
  await expect(page.getByText(/선택한 전환은 다른 지표 또는 가격 원천의 관측입니다/)).toBeVisible();
  expect(new URL(page.url()).searchParams.get('price_source')).toBe('upbit');
  expect(new URL(page.url()).searchParams.has('reading_date')).toBe(false);
  await expect(page.locator('.analysis-reading-date')).toContainText('최근 확정값');
  await page.getByRole('button', { name: '데이터 정보', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '데이터 정보', exact: true })).toContainText(
    'Upbit',
  );
  await page.keyboard.press('Escape');
  expect(new URL(page.url()).searchParams.has('reading_date')).toBe(false);
  await expect(page.locator('.analysis-reading-date')).toContainText('최근 확정값');
});

test('an explicit reading date takes precedence over a corrected signal and latest stays unpinned', async ({
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
  await expect(
    page.getByText('원천 수정이 반영된 전환입니다. 현재 관측값으로 표시합니다.', { exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get('reading_date')).toBe(String(explicit));
  await expect(page.locator('.analysis-reading-date')).toContainText(
    new Date(explicit * 1000).toISOString().slice(0, 10),
  );
  await expect(page.locator('.analysis-reading-date')).toContainText('날짜 고정');
  await page.getByRole('button', { name: '최근값 보기', exact: true }).click();
  await expect(page.locator('.analysis-reading-date')).toContainText('최근 확정값');
  expect(new URL(page.url()).searchParams.has('reading_date')).toBe(false);
  await page.getByRole('button', { name: '데이터 정보', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '데이터 정보', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.analysis-reading-date')).toContainText('최근 확정값');
  expect(new URL(page.url()).searchParams.has('reading_date')).toBe(false);
  expect(new URL(page.url()).searchParams.has('signal')).toBe(false);
  await page.reload();
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  await expect(page.locator('.analysis-reading-date')).toContainText('최근 확정값');
});

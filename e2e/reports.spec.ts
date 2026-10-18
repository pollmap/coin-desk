import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { PublishedReport, ReportScope, ReportType } from '../shared/report-types';

const start = '2026-10-17T00:00:00.000Z',
  end = '2026-10-18T00:00:00.000Z';
function fixture(
  scope: ReportScope = 'global',
  type: ReportType = 'daily',
  id = scope + '-' + type,
): PublishedReport {
  return {
    reportId: id,
    reportType: type,
    scopeId: scope,
    title: scope === 'global' ? '10월 18일 시장 흐름' : '10월 18일 Injective 시장',
    periodStart: start,
    periodEnd: end,
    publishedAt: end,
    revision: 1,
    publicationStatus: 'published',
    dataQuality: 'complete',
    highlights: [
      '관심 종목의 거래대금 변화',
      '현물과 파생시장의 차이',
      '같은 기간으로 비교한 시장 규모',
    ],
    dataCutoff: end,
    generatedAt: end,
    supersedesReportId: null,
    supersededByReportId: null,
    sections: [
      {
        kind: 'facts',
        title: '시장 규모',
        items: [
          { label: '전체 시가총액', value: '2500000000000.125', unit: 'USD', evidenceIds: ['e1'] },
        ],
      },
      {
        kind: 'table',
        title: '관심 코인',
        rows: [
          {
            label: 'INJ',
            href: '/coins/INJ',
            facts: [
              { label: '가격', value: '11.25', unit: 'USD', evidenceIds: ['e1'] },
              { label: '시가총액', value: '1125000000', unit: 'USD', evidenceIds: ['e1'] },
            ],
          },
          {
            label: 'ETH',
            href: '/coins/ETH',
            facts: [
              { label: '가격', value: null, unit: 'USD', evidenceIds: ['e1'] },
              { label: '시가총액', value: '360000000000', unit: 'USD', evidenceIds: ['e1'] },
            ],
          },
        ],
      },
      { kind: 'note', title: '읽는 법', text: '시가총액과 거래대금은 서로 다른 지표입니다.' },
    ],
    evidence: [
      {
        id: 'e1',
        entityId: '시장',
        entityType: 'global',
        metric: '시가총액',
        value: '2500000000000.125',
        unit: 'USD',
        source: 'CoinGecko',
        sourceUrl: 'https://www.coingecko.com/',
        scope: 'CoinGecko 수록 시장',
        dataAsOf: end,
        fetchedAt: end,
        periodStart: start,
        periodEnd: end,
        status: 'verified',
        calculationVersion: 'hidden-version',
        contentHash: 'hidden-evidence-hash',
      },
    ],
    coverageNotes: [],
    methodologyVersion: 'hidden-methodology',
    templateVersion: 'hidden-template',
    schemaVersion: 1,
    evidenceHash: 'hidden-report-hash',
  };
}

async function mockReports(page: Page, report?: PublishedReport) {
  const requests: string[] = [];
  await page.route('**/api/v1/reports**', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);
    const scope: ReportScope =
      url.searchParams.get('scope') === 'injective' ? 'injective' : 'global';
    const type: ReportType = url.searchParams.get('type') === 'weekly' ? 'weekly' : 'daily';
    const current = report ?? fixture(scope, type);
    const json =
      url.pathname === '/api/v1/reports'
        ? {
            data: [current],
            nextCursor: null,
            status: 'ready',
            schedule: { timezone: 'Asia/Seoul', daily: '09:10', weekly: '월요일 09:20' },
          }
        : { data: current, status: 'ready' };
    await route.fulfill({ json });
  });
  return requests;
}

async function expectReportEntryUncovered(page: Page) {
  const geometry = await page.locator('.report-back').evaluate((element) => {
    const link = element.getBoundingClientRect();
    const header = document.querySelector('.topbar')!.getBoundingClientRect();
    const hit = document.elementFromPoint(link.x + link.width / 2, link.y + link.height / 2);
    const skip = document.querySelector('.skip-link')!.getBoundingClientRect();
    return {
      scrollY,
      linkTop: link.top,
      headerBottom: header.bottom,
      linkUncovered: element === hit || element.contains(hit),
      skipBottom: skip.bottom,
    };
  });
  expect(geometry.scrollY).toBe(0);
  expect(geometry.linkTop).toBeGreaterThanOrEqual(geometry.headerBottom);
  expect(geometry.linkUncovered).toBe(true);
  expect(geometry.skipBottom).toBeLessThanOrEqual(0);
  return geometry;
}

for (const width of [320, 390, 768, 1000, 1280, 1440, 1920]) {
  test(`reports list, detail and evidence fit both themes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const apiRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/')) apiRequests.push(request.url());
    });
    await mockReports(page);
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: '시장 보고서', exact: true })).toBeVisible();
    await expect(page.locator('.product-nav a')).toHaveCount(3);
    if (width === 390 || width === 1280) {
      await page.screenshot({ path: test.info().outputPath('report-list.png'), fullPage: true });
    }
    await page.getByRole('link', { name: /10월 18일 시장 흐름/ }).click();
    await expect(
      page.getByRole('heading', { name: '10월 18일 시장 흐름', exact: true }),
    ).toBeFocused();
    await expectReportEntryUncovered(page);
    await expect(page.locator('.report-highlights li')).toHaveCount(3);
    await expect(page.locator('.report-fact dd')).toHaveText('2.5조 USD');
    await expect(page.locator('.report-table tbody tr').nth(1).locator('td').first()).toHaveText(
      '—',
    );
    expect(
      apiRequests.filter((url) => /\/api\/v1\/(?:onchain|overview|quotes|search)/.test(url)),
    ).toEqual([]);
    await expect(page.getByText('CoinGecko 수록 시장')).not.toBeVisible();
    await page.locator('.report-evidence summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('CoinGecko 수록 시장')).toBeVisible();
    await expect(page.locator('.report-evidence')).toContainText('2,500,000,000,000.125 USD');
    await expect(page.getByRole('link', { name: 'CoinGecko 원문' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    await page.keyboard.press('Escape');
    await expect(page.getByText('CoinGecko 수록 시장')).not.toBeVisible();
    await expect(page.locator('.report-evidence summary')).toBeFocused();
    expect(
      await page.locator('.report-evidence summary').evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return element === hit || element.contains(hit);
      }),
    ).toBe(true);
    await expect(page.getByText(/hidden-|수집 시각|계산 버전|내보내기|공유/)).toHaveCount(0);
    for (let theme = 0; theme < 2; theme++) {
      expect(
        (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
          .violations,
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(
        false,
      );
      if (width === 390 || width === 1280) {
        // Capture the entry viewport, not fixed elements composited into a
        // full-page image while the evidence keyboard check is scrolled down.
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await page.locator('#report-title').focus();
        await expectReportEntryUncovered(page);
        await page.screenshot({
          path: test.info().outputPath('report-detail-theme-' + theme + '.png'),
          fullPage: true,
        });
      }
      await page.getByRole('button', { name: /테마로 변경/ }).click();
    }
    await page.getByRole('link', { name: 'INJ', exact: true }).click();
    await expect(page).toHaveURL(/\/coins\/INJ$/);
    await expect(page.locator('.coin-dashboard[data-asset="INJ"]')).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: '10월 18일 시장 흐름' })).toBeVisible();
  });
}

for (const width of [390, 1280]) {
  test(`report direct entry and browser return leave its list link uncovered at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    await mockReports(page);
    await page.goto('/reports/global-daily');
    await expect(page.getByRole('heading', { name: '10월 18일 시장 흐름' })).toBeFocused();
    const direct = await expectReportEntryUncovered(page);
    await page.screenshot({ path: test.info().outputPath('report-direct-entry.png') });
    await page.locator('.report-evidence summary').focus();
    await page.keyboard.press('Enter');
    await page.getByRole('link', { name: 'INJ', exact: true }).click();
    await expect(page).toHaveURL(/\/coins\/INJ$/);
    await expect(page.locator('.coin-dashboard[data-asset="INJ"]')).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: '10월 18일 시장 흐름' })).toBeFocused();
    const returned = await expectReportEntryUncovered(page);
    await test.info().attach('entry-geometry.json', {
      body: JSON.stringify({ direct, returned }, null, 2),
      contentType: 'application/json',
    });
  });
}

test('report entry keeps market and INJ chart routes and fetches only on opening', async ({
  page,
}) => {
  const requests = await mockReports(page);
  await page.goto('/');
  await expect(page.getByRole('link', { name: '보고서', exact: true })).toBeVisible();
  expect(requests).toEqual([]);
  await page.getByRole('link', { name: '보고서', exact: true }).click();
  await expect(page.getByRole('heading', { name: '시장 보고서', exact: true })).toBeVisible();
  await page.goto('/coins/INJ');
  await page.getByRole('link', { name: 'Injective 보고서', exact: true }).click();
  await expect(page).toHaveURL(/reports\?scope=injective/);
  await expect(page.getByRole('button', { name: 'Injective', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('scope switches isolate delayed requests and latest links preserve selected period', async ({
  page,
}) => {
  let releaseGlobal!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseGlobal = resolve;
  });
  await page.route('**/api/v1/reports**', async (route) => {
    const url = new URL(route.request().url());
    const scope =
      url.searchParams.get('scope') === 'injective' || url.pathname.includes('/injective-')
        ? 'injective'
        : 'global';
    const type = url.searchParams.get('type') === 'weekly' ? 'weekly' : 'daily';
    if (scope === 'global') await held;
    const current = fixture(scope, type);
    await route
      .fulfill({
        json:
          url.pathname === '/api/v1/reports'
            ? { data: [current], nextCursor: null, status: 'ready' }
            : { data: current, status: 'ready' },
      })
      .catch(() => {});
  });
  await page.goto('/reports');
  await page.getByRole('button', { name: 'Injective', exact: true }).click();
  await expect(page.getByRole('link', { name: /10월 18일 Injective 시장/ })).toBeVisible();
  releaseGlobal();
  await expect(page.getByRole('link', { name: /10월 18일 시장 흐름/ })).toHaveCount(0);
  await page.getByRole('combobox', { name: '보고서 주기' }).selectOption('weekly');
  await page.getByRole('link', { name: '최신 보고서', exact: true }).click();
  await expect(page).toHaveURL(/\/reports\/injective-weekly\?scope=injective&type=weekly/);
  await expect(page.getByRole('link', { name: 'INJ 차트 보기' })).toBeVisible();
});

test('missing reports, failed requests and retry show one current state', async ({ page }) => {
  let failed = false;
  await page.route('**/api/v1/reports**', (route) =>
    route.fulfill({
      status: failed ? 503 : 200,
      json: failed
        ? { error: '/srv/private-token-do-not-render' }
        : { data: [], nextCursor: null, status: 'pending' },
    }),
  );
  await page.goto('/reports');
  await expect(page.getByText('아직 발행된 보고서가 없습니다.')).toBeVisible();
  await expect(page.getByText('보고서를 불러오는 중…')).toHaveCount(0);
  failed = true;
  await page.getByRole('button', { name: 'Injective', exact: true }).click();
  await expect(page.getByText('보고서를 불러오지 못했습니다.')).toBeVisible();
  await expect(page.getByText(/private-token|아직 발행된|불러오는 중/)).toHaveCount(0);
  failed = false;
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.getByText('아직 발행된 보고서가 없습니다.')).toBeVisible();
});

test('list paging resets when scope changes and browser back restores selection', async ({
  page,
}) => {
  await page.route('**/api/v1/reports**', (route) => {
    const query = new URL(route.request().url()).searchParams;
    const scope = query.get('scope') === 'injective' ? 'injective' : 'global';
    const current = fixture(scope);
    if (query.has('cursor')) current.title = '10월 17일 시장 흐름';
    return route.fulfill({
      json: {
        data: [current],
        nextCursor: query.has('cursor') ? null : 'opaque-page-2',
        status: 'ready',
      },
    });
  });
  await page.goto('/reports?type=daily&scope=global');
  await page.getByRole('link', { name: '이전 보고서', exact: true }).click();
  await expect(page).toHaveURL(/cursor=opaque-page-2/);
  await expect(page.getByRole('heading', { name: '10월 17일 시장 흐름' })).toBeVisible();
  await page.getByRole('button', { name: 'Injective', exact: true }).click();
  await expect(page).not.toHaveURL(/cursor=/);
  await expect(page.getByRole('heading', { name: '10월 18일 Injective 시장' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: '10월 17일 시장 흐름' })).toBeVisible();
  await expect(page.getByRole('button', { name: '전체 시장', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('partial and corrected reports preserve limitations and use safe links', async ({ page }) => {
  const report = fixture('injective', 'weekly');
  report.dataQuality = 'partial';
  report.coverageNotes = ['전주 비교에 필요한 14일 자료가 없어 해당 변화율은 제외했습니다.'];
  report.supersededByReportId = 'corrected-report';
  report.publicationStatus = 'superseded';
  report.evidence[0].sourceUrl = 'javascript:alert(1)';
  report.sections.push({
    kind: 'facts',
    title: '잘못된 이동 주소',
    items: [
      {
        label: '연결하지 않음',
        value: '0',
        unit: 'USD',
        evidenceIds: ['e1'],
        href: '//example.com',
      },
    ],
  });
  await mockReports(page, report);
  await page.goto('/reports/injective-weekly');
  await expect(page.getByText(report.coverageNotes[0])).toBeVisible();
  await expect(page.getByRole('link', { name: '정정된 보고서 보기' })).toHaveAttribute(
    'href',
    '/reports/corrected-report',
  );
  await expect(page.getByRole('link', { name: '연결하지 않음' })).toHaveCount(0);
  await page.locator('.report-evidence summary').click();
  await expect(page.getByRole('link', { name: 'CoinGecko 원문' })).toHaveCount(0);
  await expect(page.locator('.report-facts').last()).toContainText('0 USD');
});

test('200 percent text and reduced motion retain report actions and readable tables', async ({
  page,
}) => {
  await mockReports(page);
  await page.setViewportSize({ width: 640, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/reports/global-daily');
  await page.addStyleTag({
    content:
      '.reports-page { font-size: 200%; } .reports-page h1 { font-size: 48px; } .report-table { font-size: 28px; }',
  });
  await expect(page.getByRole('heading', { name: '10월 18일 시장 흐름' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(
    false,
  );
  await page.locator('.report-table-scroll').focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('link', { name: '보고서 목록' }).click();
  await expect(page.getByRole('heading', { name: '시장 보고서', exact: true })).toBeVisible();
});

test('display rounding preserves exact evidence and never turns tiny prices into zero', async ({
  page,
}) => {
  const report = fixture();
  report.sections = [
    {
      kind: 'facts',
      title: '수치 표기',
      items: [
        { label: '변화율', value: '-1.234567890123456789', unit: '%', evidenceIds: ['e1'] },
        { label: '작은 가격', value: '0.00000000000012345', unit: 'USD', evidenceIds: ['e1'] },
        { label: '비용', value: '19.995', unit: 'USD', evidenceIds: ['e1'] },
      ],
    },
  ];
  report.evidence[0].value = '-1.234567890123456789';
  report.evidence[0].unit = '%';
  await mockReports(page, report);
  await page.goto('/reports/global-daily');
  await expect(page.locator('.report-fact dd')).toHaveText(['-1.23 %', '1.23e-13 USD', '20 USD']);
  await page.locator('.report-evidence summary').click();
  await expect(page.locator('.report-evidence')).toContainText('-1.234567890123456789 %');
});

test('a nonexistent report stops retrying and returns to the report list', async ({ page }) => {
  const calls: string[] = [];
  await page.route('**/api/v1/reports**', (route) => {
    const url = new URL(route.request().url());
    calls.push(url.pathname);
    return route.fulfill(
      url.pathname.endsWith('/missing-report')
        ? { status: 404, json: { error: '보고서를 찾을 수 없습니다.', code: 'NOT_FOUND' } }
        : { json: { data: [fixture()], nextCursor: null, status: 'ready' } },
    );
  });
  await page.clock.install();
  await page.goto('/reports/missing-report');
  await expect(page.getByRole('heading', { name: '보고서를 찾을 수 없습니다.' })).toBeVisible();
  await expect(page.getByText('보고서를 불러오는 중…')).toHaveCount(0);
  await page.clock.fastForward(60_000);
  expect(calls.filter((url) => url.endsWith('/missing-report'))).toHaveLength(1);
  await page.getByRole('link', { name: '보고서 목록' }).click();
  await expect(page.getByRole('heading', { name: '시장 보고서', exact: true })).toBeVisible();
});

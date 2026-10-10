import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const stage = process.argv[2] || 'before';
const browser = await chromium.launch();
const reports = [];
try {
  for (const [name, base] of [
    ['pages', 'https://coin-desk.pages.dev'],
    ['vps', 'https://coin-desk.62.171.141.206.sslip.io'],
  ]) {
    const calibrations = [];
    for (let i = 0; i < 8; i++) {
      const start = Date.now();
      const r = await fetch('https://coin-desk.62.171.141.206.sslip.io/healthz', {
        cache: 'no-store',
      });
      await r.text();
      const end = Date.now();
      calibrations.push({
        rtt: end - start,
        lower: Date.parse(r.headers.get('date')) - end,
        upper: Date.parse(r.headers.get('date')) + 1000 - start,
      });
    }
    const lower = Math.max(...calibrations.map((x) => x.lower)),
      upper = Math.min(...calibrations.map((x) => x.upper));
    if (lower > upper) throw new Error('Clock calibration failed');
    const offset = (lower + upper) / 2,
      error = (upper - lower) / 2;
    const samples = [];
    for (let i = 0; i < 20; i++) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: 1250000,
        uploadThroughput: 625000,
      });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      await page.addInitScript(() => {
        window.__perf = { lcp: 0, paints: [], received: [], marketRequests: 0 };
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) window.__perf.lcp = e.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        const Native = window.EventSource;
        window.EventSource = class extends Native {
          constructor(url, opts) {
            super(url, opts);
            const seen = new Map();
            this.addEventListener('quotes', (event) => {
              const payload = JSON.parse(event.data),
                received = performance.now();
              for (const q of payload.quotes || []) {
                const prev = seen.get(q.asset);
                seen.set(q.asset, q);
                if (!prev || prev.price === q.price || prev.tradedAt >= q.tradedAt) continue;
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => {
                    const row = [...document.querySelectorAll('.market-table tbody tr')].find(
                      (r) => r.querySelector('th small')?.textContent === q.asset,
                    );
                    const cell = row?.querySelector('.market-price-cell a,td:nth-child(3) a');
                    const value = Number(cell?.textContent.replace(/[^0-9.]/g, ''));
                    if (cell && Math.abs(value - q.price) <= Math.max(1e-8, q.price * 1e-8)) {
                      window.__perf.paints.push(performance.now() - received);
                      window.__perf.received.push(Date.now() - q.receivedAt * 1000);
                    }
                  }),
                );
              }
            });
          }
        };
      });
      const apis = [];
      page.on('request', (r) => {
        if (r.url().includes('/api/v1/')) apis.push(r.url().split('/api/v1/')[1]);
      });
      await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page
        .locator('.market-table tbody tr')
        .first()
        .waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForTimeout(i === 0 ? 30000 : 5000);
      const sample = await page.evaluate(() => ({
        ...window.__perf,
        rows: document.querySelectorAll('.market-table tbody tr').length,
        resources: performance
          .getEntriesByType('resource')
          .map((r) => ({ url: r.name, duration: r.duration, bytes: r.transferSize })),
      }));
      sample.apis = apis;
      samples.push(sample);
      if (i === 0) await page.screenshot({ path: `work/quality-performance-${stage}-${name}.png` });
      await context.close();
    }
    const p95 = (a) =>
      a.length ? [...a].sort((x, y) => x - y)[Math.ceil(a.length * 0.95) - 1] : null;
    const paints = samples.flatMap((s) => s.paints),
      e2e = samples.flatMap((s) => s.received.map((v) => v + offset));
    reports.push({
      stage,
      name,
      base,
      checkedAt: new Date().toISOString(),
      browser: browser.version(),
      viewport: '1280x800',
      downlinkMbps: 10,
      uplinkMbps: 5,
      addedLatencyMs: 0,
      cpuRate: 1,
      contexts: 20,
      clockOffsetMs: offset,
      clockErrorMs: error,
      lcpSamplesMs: samples.map((s) => s.lcp),
      lcpP95Ms: p95(samples.map((s) => s.lcp)),
      paintSamples: paints.length,
      clientReceiptToPaintP95Ms: p95(paints),
      hubReceiptToPaintP95Ms: p95(e2e),
      hubReceiptToPaintUpperMs: e2e.length ? p95(e2e) + error : null,
      samples,
    });
    writeFileSync(`work/quality-performance-${stage}.json`, JSON.stringify(reports, null, 2));
    console.log(JSON.stringify({ ...reports.at(-1), samples: undefined }));
  }
} finally {
  await browser.close();
}

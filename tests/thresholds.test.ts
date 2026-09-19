import { describe, expect, it, vi } from 'vitest';
import type { IPrimitivePaneRenderer, SeriesAttachedParameter } from 'lightweight-charts';
import { THRESHOLDS, realizedPosition, thresholdState } from '../shared/thresholds';
import { ThresholdBands } from '../src/ThresholdBands';

describe('source-reviewed reference zones', () => {
  it('keeps Coin Metrics network assets on source-specific break-even boundaries without BTC overheating bands', () => {
    expect(THRESHOLDS.network_mvrv.boundaries.map((b) => b.value)).toEqual([1]);
    expect(THRESHOLDS.network_nupl.boundaries.map((b) => b.value)).toEqual([0]);
    expect(thresholdState('network_mvrv', 100)?.label).not.toMatch(/과열|과매수/);
    expect(thresholdState('network_nupl', 0.99)?.label).toBe('순미실현 이익');
    expect(thresholdState('network_nupl', -2)?.label).toBe('순미실현 손실');
    expect(THRESHOLDS.network_mvrv.sources[0].url).toContain('docs.coinmetrics.io');
  });
  it('keeps MVRV extreme regions strict and labels exact 1 and 3.7 boundaries', () => {
    expect(thresholdState('mvrv', 0.99)?.label).toBe('저평가 참고');
    expect(thresholdState('mvrv', 1)).toMatchObject({ label: '손익분기', boundary: true });
    expect(thresholdState('mvrv', 3.5)?.label).toBe('중간 구간');
    expect(thresholdState('mvrv', 3.7)?.boundary).toBe(true);
    expect(thresholdState('mvrv', 3.70001)?.label).toBe('과열 참고');
    expect(thresholdState('mvrv', 83)?.label).toBe('과열 참고');
    expect(THRESHOLDS.mvrv.sources[0].url).toContain('userguide.cryptoquant.com');
    expect(THRESHOLDS.mvrv.note).toContain('3.5');
  });

  it('does not reuse full-market overheating thresholds for holder cohorts or SOPR', () => {
    for (const id of ['sth_mvrv', 'lth_mvrv', 'sopr_24h']) {
      expect(THRESHOLDS[id].boundaries.map((b) => b.value)).toEqual([1]);
      expect(thresholdState(id, 0.5)?.label).toContain('손실');
      expect(thresholdState(id, 1)?.boundary).toBe(true);
      expect(thresholdState(id, 100)?.label).toContain('이익');
      expect(thresholdState(id, 100)?.label).not.toMatch(/과열|과매수/);
    }
    expect(THRESHOLDS.mvrv_z.boundaries.map((b) => b.value)).toEqual([0]);
    expect(thresholdState('mvrv_z', 9)?.label).not.toContain('과열');
  });

  it('classifies NUPL in raw ratios, including negative losses and exact percentage boundaries', () => {
    expect(thresholdState('nupl', -0.5)?.label).toBe('순미실현 손실');
    expect(thresholdState('nupl', 0)?.label).toBe('손익분기');
    expect(thresholdState('nupl', 0.249)?.label).toBe('낮은 미실현 이익');
    expect(thresholdState('nupl', 0.25)?.boundary).toBe(true);
    expect(thresholdState('nupl', 0.251)?.label).toBe('중간 미실현 이익');
    expect(thresholdState('nupl', 0.75)?.boundary).toBe(true);
    expect(thresholdState('nupl', 0.751)?.label).toBe('과열 참고');
  });

  it('recognizes valid RSI extremes without classifying absent, non-finite, or impossible RSI', () => {
    expect(thresholdState('rsi', 0)?.label).toBe('과매도 참고');
    expect(thresholdState('rsi', 30)?.boundary).toBe(true);
    expect(thresholdState('rsi', 50)?.label).toBe('중립 구간');
    expect(thresholdState('rsi', 70)?.boundary).toBe(true);
    expect(thresholdState('rsi', 100)?.label).toBe('과매수 참고');
    for (const value of [null, undefined, NaN, Infinity, -1, 101])
      expect(thresholdState('rsi', value)).toBeNull();
    expect(thresholdState('unregistered', 1)).toBeNull();
  });

  it('compares realized price only to a positive finite price observed on the exact same date', () => {
    const reference = { time: 100, value: 100 };
    expect(realizedPosition(reference, { time: 100, value: 150 })).toMatchObject({
      ratio: 1.5,
      percent: 50,
    });
    expect(realizedPosition(reference, { time: 100, value: 75 })).toMatchObject({
      ratio: 0.75,
      percent: -25,
    });
    expect(realizedPosition(reference, { time: 100, value: 100 })?.label).toBe('실현가격과 같음');
    for (const price of [
      undefined,
      { time: 101, value: 150 },
      { time: 99, value: 150 },
      { time: 100, value: NaN },
      { time: 100, value: 0 },
    ])
      expect(realizedPosition(reference, price)).toBeNull();
    expect(realizedPosition({ time: 100, value: 0 }, reference)).toBeNull();
    expect(thresholdState('realized_price', 1)).toBeNull();
  });
});

function drawBands(id: string, coordinate: (value: number) => number | null, factor = 1) {
  const primitive = new ThresholdBands(THRESHOLDS[id].bands, factor);
  const fillRect = vi.fn(),
    requestUpdate = vi.fn(),
    priceToCoordinate = vi.fn(coordinate);
  primitive.attached({
    series: { priceToCoordinate },
    requestUpdate,
  } as unknown as SeriesAttachedParameter);
  const target = {
    useMediaCoordinateSpace: (callback: (scope: unknown) => void) =>
      callback({
        context: { save() {}, restore() {}, fillRect, globalAlpha: 1, fillStyle: '' },
        mediaSize: { width: 400, height: 100 },
      }),
  } as unknown as Parameters<IPrimitivePaneRenderer['draw']>[0];
  const draw = () => primitive.paneViews()[0].renderer()!.draw(target);
  return { primitive, fillRect, requestUpdate, priceToCoordinate, draw };
}

describe('reference backgrounds preserve the actual chart scale', () => {
  it('maps percentage boundaries once through the owning series and clips to the pane', () => {
    const fixture = drawBands('nupl', (value) => 100 - value, 100);
    fixture.draw();
    expect(fixture.priceToCoordinate.mock.calls.flat()).toEqual(
      expect.arrayContaining([0, 25, 50, 75]),
    );
    expect(fixture.priceToCoordinate.mock.calls.flat()).not.toContain(7500);
    expect(fixture.fillRect.mock.calls).toEqual([
      [0, 75, 400, 25],
      [0, 50, 400, 25],
      [0, 25, 400, 25],
      [0, 0, 400, 25],
    ]);
    expect(fixture.primitive).not.toHaveProperty('autoscaleInfo');
    expect(fixture.primitive.paneViews()[0].zOrder?.()).toBe('bottom');
  });

  it('uses native logarithmic coordinates without synthetic boundary data or stretching offscreen regions', () => {
    const fixture = drawBands('mvrv', (value) => 70 - Math.log10(value) * 100);
    fixture.draw();
    const rows = fixture.fillRect.mock.calls;
    expect(rows[0]).toEqual([0, 70, 400, 30]);
    expect(rows[1][1]).toBeCloseTo(70 - Math.log10(3.7) * 100);
    for (const [, y, , height] of rows) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y + height).toBeLessThanOrEqual(100);
    }
    expect(fixture.primitive).not.toHaveProperty('autoscaleInfo');
  });

  it('hides and restores annotations without modifying chart or series options, and detaches cleanly', () => {
    const fixture = drawBands('rsi', (value) => 100 - value);
    fixture.primitive.setVisible(false);
    fixture.draw();
    expect(fixture.fillRect).not.toHaveBeenCalled();
    fixture.primitive.setVisible(true);
    fixture.draw();
    expect(fixture.fillRect).toHaveBeenCalledTimes(3);
    fixture.primitive.detached();
    fixture.draw();
    expect(fixture.fillRect).toHaveBeenCalledTimes(3);
    expect(fixture.requestUpdate).toHaveBeenCalledTimes(3);
  });
});

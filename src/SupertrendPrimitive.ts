import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  SeriesAttachedParameter,
  Time,
  SeriesType,
  UTCTimestamp,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import { bucketEnd } from '../shared/math';
import type { Interval } from '../shared/types';
import type { SupertrendRow } from '../shared/supertrend';

/** Stepped trend line and a solid translucent fill; never join flips or missing candles. */
export class SupertrendPrimitive
  implements ISeriesPrimitive<Time>, IPrimitivePaneView, IPrimitivePaneRenderer
{
  private chart?: IChartApi;
  private series?: ISeriesApi<SeriesType>;
  private request?: () => void;
  constructor(
    private rows: SupertrendRow[],
    private interval: Interval,
  ) {}
  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart;
    this.series = p.series;
    this.request = p.requestUpdate;
  }
  detached() {
    this.chart = undefined;
    this.series = undefined;
    this.request = undefined;
  }
  setRows(rows: SupertrendRow[]) {
    this.rows = rows;
    this.request?.();
  }
  paneViews() {
    return [this];
  }
  zOrder() {
    return 'bottom' as const;
  }
  renderer() {
    return this;
  }
  draw(target: CanvasRenderingTarget2D) {
    if (!this.chart || !this.series) return;
    const chart = this.chart,
      series = this.series;
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      const range = chart.timeScale().getVisibleRange();
      if (!range) return;
      const light = document.documentElement.dataset.theme === 'light';
      ctx.save();
      ctx.lineWidth = 1.5;
      for (let i = 1; i < this.rows.length; i++) {
        const a = this.rows[i - 1],
          b = this.rows[i];
        if (
          a.direction !== b.direction ||
          b.time !== bucketEnd(a.time, this.interval) ||
          b.time < Number(range.from) ||
          a.time > Number(range.to)
        )
          continue;
        const x1 = chart.timeScale().timeToCoordinate(a.time as UTCTimestamp),
          x2 = chart.timeScale().timeToCoordinate(b.time as UTCTimestamp);
        const y1 = series.priceToCoordinate(a.value),
          y2 = series.priceToCoordinate(b.value),
          p1 = series.priceToCoordinate(a.bodyMiddle),
          p2 = series.priceToCoordinate(b.bodyMiddle);
        if ([x1, x2, y1, y2, p1, p2].some((v) => v === null)) continue;
        const color =
          a.direction === 'up' ? (light ? '#b62d43' : '#ff7f8b') : light ? '#255db8' : '#7faaff';
        ctx.fillStyle = color;
        ctx.globalAlpha = light ? 0.08 : 0.12;
        ctx.beginPath();
        ctx.moveTo(x1!, p1!);
        ctx.lineTo(x2!, p2!);
        ctx.lineTo(x2!, y2!);
        ctx.lineTo(x2!, y1!);
        ctx.lineTo(x1!, y1!);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(x1!, y1!);
        ctx.lineTo(x2!, y1!);
        ctx.lineTo(x2!, y2!);
        ctx.stroke();
      }
      ctx.restore();
    });
  }
}

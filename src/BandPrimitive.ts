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
export interface BandRow {
  time: number;
  bands: number[];
}
const COLORS = [
  '#7655ca',
  '#5269cd',
  '#318eb8',
  '#339e94',
  '#5cac67',
  '#b9af4d',
  '#d29b44',
  '#d37843',
  '#ba5b5b',
];
/** One primitive behind the series; polygons never bridge missing UTC days. */
export class BandPrimitive
  implements ISeriesPrimitive<Time>, IPrimitivePaneView, IPrimitivePaneRenderer
{
  private chart?: IChartApi;
  private series?: ISeriesApi<SeriesType>;
  private request?: () => void;
  constructor(private rows: BandRow[]) {}
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
  setRows(rows: BandRow[]) {
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
      series = this.series,
      rows = this.rows;
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      const range = chart.timeScale().getVisibleRange();
      if (!range) return;
      ctx.save();
      ctx.globalAlpha = 0.24;
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1],
          b = rows[i];
        if (b.time - a.time !== 86400 || b.time < Number(range.from) || a.time > Number(range.to))
          continue;
        const x1 = chart.timeScale().timeToCoordinate(a.time as UTCTimestamp),
          x2 = chart.timeScale().timeToCoordinate(b.time as UTCTimestamp);
        if (x1 === null || x2 === null) continue;
        for (let k = 0; k < a.bands.length - 1; k++) {
          const ys = [a.bands[k], b.bands[k], b.bands[k + 1], a.bands[k + 1]].map((v) =>
            series.priceToCoordinate(v),
          );
          if (ys.some((y) => y === null)) continue;
          ctx.fillStyle = COLORS[Math.round((k * 8) / Math.max(1, a.bands.length - 2))];
          ctx.beginPath();
          ctx.moveTo(x1, ys[0]!);
          ctx.lineTo(x2, ys[1]!);
          ctx.lineTo(x2, ys[2]!);
          ctx.lineTo(x1, ys[3]!);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    });
  }
}

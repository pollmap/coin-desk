import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
} from 'lightweight-charts';
import type { ThresholdBand } from '../shared/thresholds';

/** Background annotation only. No autoscaleInfo or synthetic series is added,
 * so offscreen thresholds never stretch the chart's price or time range. */
export class ThresholdBands implements ISeriesPrimitive {
  private attachedTo?: SeriesAttachedParameter;
  private visible = true;
  private readonly views: IPrimitivePaneView[];
  constructor(
    private readonly bands: readonly ThresholdBand[],
    private readonly factor = 1,
  ) {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) => {
        if (!this.visible || !this.attachedTo) return;
        target.useMediaCoordinateSpace(({ context, mediaSize }) => {
          const height = mediaSize.height;
          context.save();
          context.globalAlpha = 0.085;
          for (const band of this.bands) {
            const top =
              band.upper === null
                ? 0
                : this.attachedTo!.series.priceToCoordinate(band.upper * this.factor);
            const bottom =
              band.lower === null
                ? height
                : this.attachedTo!.series.priceToCoordinate(band.lower * this.factor);
            if (
              top === null ||
              bottom === null ||
              !Number.isFinite(top) ||
              !Number.isFinite(bottom)
            )
              continue;
            const y = Math.max(0, Math.min(height, top));
            const end = Math.max(0, Math.min(height, bottom));
            if (end <= y) continue;
            context.fillStyle = band.color;
            context.fillRect(0, y, mediaSize.width, end - y);
          }
          context.restore();
        });
      },
    };
    this.views = [{ zOrder: () => 'bottom', renderer: () => renderer }];
  }
  attached(parameters: SeriesAttachedParameter) {
    this.attachedTo = parameters;
    parameters.requestUpdate();
  }
  detached() {
    this.attachedTo = undefined;
  }
  paneViews() {
    return this.views;
  }
  setVisible(visible: boolean) {
    this.visible = visible;
    this.attachedTo?.requestUpdate();
  }
}

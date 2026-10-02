import { createChart as createOriginalChart, ColorType } from 'lightweight-charts';

/** Repaint canvas options in place: a theme change never resets the user's viewport. */
export function createDeskChart(...args: Parameters<typeof createOriginalChart>) {
  const chart = createOriginalChart(...args);
  const originalColors = new WeakMap<object, string>();
  const paint = () => {
    const light = document.documentElement.dataset.theme === 'light';
    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: light ? '#ffffff' : '#101216' },
        textColor: light ? '#48576a' : '#a4b2c1',
      },
      grid: {
        vertLines: { color: light ? '#e8edf1' : '#292e37' },
        horzLines: { color: light ? '#e8edf1' : '#292e37' },
      },
      crosshair: {
        vertLine: { labelBackgroundColor: '#465680' },
        horzLine: { labelBackgroundColor: '#465680' },
      },
    });
    for (const pane of chart.panes())
      for (const series of pane.getSeries()) {
        const options = series.options();
        if ('upColor' in options)
          series.applyOptions({
            upColor: light ? '#b62d43' : '#ff7f8b',
            downColor: light ? '#255db8' : '#7faaff',
            ...('wickUpColor' in options
              ? {
                  wickUpColor: light ? '#b62d43' : '#ff7f8b',
                  wickDownColor: light ? '#255db8' : '#7faaff',
                  borderUpColor: light ? '#b62d43' : '#ff7f8b',
                  borderDownColor: light ? '#255db8' : '#7faaff',
                }
              : {}),
          });
        if (!('color' in options) || typeof options.color !== 'string') continue;
        const original = originalColors.get(series) ?? options.color;
        originalColors.set(series, original);
        const rgb = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(original);
        if (rgb && series.seriesType() === 'Line') {
          const parts = [0, 2, 4].map((i) => parseInt(rgb[1].slice(i, i + 2), 16));
          const color = light
            ? '#' +
              parts
                .map((v) =>
                  Math.round(v * 0.65)
                    .toString(16)
                    .padStart(2, '0'),
                )
                .join('')
            : original;
          series.applyOptions({ color });
        }
      }
  };
  paint();
  const frame = requestAnimationFrame(() => {
    paint();
    const surface = typeof args[0] === 'string' ? document.getElementById(args[0]) : args[0];
    if (surface) surface.dataset.chartReadyMs = String(Math.round(performance.now()));
  });
  window.addEventListener('coin-desk-theme', paint);
  const remove = chart.remove.bind(chart);
  chart.remove = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('coin-desk-theme', paint);
    remove();
  };
  return chart;
}

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHART_TOUCH_CANCEL_SOURCES,
  CHART_TOUCH_CANCEL_VERSION,
  chartTouchCancelPlugin,
  patchChartTouchCancel,
} from '../scripts/chart-touch-cancel';
import type { ResolvedConfig } from 'vite';

type Variant = keyof typeof CHART_TOUCH_CANCEL_SOURCES;
type Touch = { identifier: number; clientX: number; clientY: number; pageX: number; pageY: number };
type TouchInput = {
  type: string;
  timeStamp: number;
  touches: Touch[];
  changedTouches: Touch[];
  target: TestTarget;
  preventDefault: () => void;
  cancelable: boolean;
};
class TestTarget {
  listeners = new Map<string, Set<(event: TouchInput) => void>>();
  ownerDocument!: {
    documentElement: TestTarget;
    addEventListener: TestTarget['addEventListener'];
    removeEventListener: TestTarget['removeEventListener'];
  };
  addEventListener(type: string, handler: (event: TouchInput) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(handler);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, handler: (event: TouchInput) => void) {
    this.listeners.get(type)?.delete(handler);
  }
  dispatch(type: string, event: TouchInput) {
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler(event);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0 };
  }
  contains(node: unknown) {
    return node === this;
  }
}
const touch = (identifier: number): Touch => ({
  identifier,
  clientX: 80,
  clientY: 70,
  pageX: 80,
  pageY: 70,
});
const original = (variant: Variant) =>
  readFileSync(
    resolve('node_modules/lightweight-charts/dist', CHART_TOUCH_CANCEL_SOURCES[variant].file),
    'utf8',
  );

/** Runs each actual distribution's patched input class, not a rewritten cancellation algorithm. */
function installedHandler(variant: Variant, patched = true) {
  const source = patched ? patchChartTouchCancel(original(variant), variant) : original(variant);
  const start =
    variant === 'development'
      ? source.indexOf('class MouseEventHandler {')
      : source.indexOf('class Mn{constructor(t,i,n){this.Rf=0');
  const end = source.indexOf(
    variant === 'development' ? '\nfunction getDistance(' : 'function gn(',
    start,
  );
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const helpers: Record<string, unknown> = {
    isIOS: () => false,
    isFF: () => false,
    preventScrollByWheelClick: () => {},
    ensureNotNull: (value: unknown) => {
      if (value === null) throw new Error('unexpected null touch');
      return value;
    },
    touchWithId: (touches: Touch[], id: number) => touches.find((t) => t.identifier === id) ?? null,
    eventTimeStamp: (event: TouchInput) => event.timeStamp,
    getPosition: (t: Touch) => ({ _internal_x: t.pageX, _internal_y: t.pageY }),
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    getDistance: () => 70,
    preventDefault: (event: TouchInput) => event.preventDefault(),
    pn: () => false,
    wn: () => {},
    u: (value: unknown) => {
      if (value === null) throw new Error('unexpected null touch');
      return value;
    },
    Cn: (touches: Touch[], id: number) => touches.find((t) => t.identifier === id) ?? null,
    xn: (event: TouchInput) => event.timeStamp,
    Sn: (t: Touch) => ({ _t: t.pageX, ut: t.pageY }),
    gn: () => 70,
    bn: (event: TouchInput) => event.preventDefault(),
  };
  const Handler = new Function(
    ...Object.keys(helpers),
    source.slice(start, end) +
      `; return ${variant === 'development' ? 'MouseEventHandler' : 'Mn'};`,
  )(...Object.values(helpers));
  const root = new TestTarget(),
    target = new TestTarget();
  target.ownerDocument = {
    documentElement: root,
    addEventListener: root.addEventListener.bind(root),
    removeEventListener: root.removeEventListener.bind(root),
  };
  const events: string[] = [];
  let locked = false;
  const handlers =
    variant === 'development'
      ? {
          _internal_touchStartEvent: () => {
            locked = true;
          },
          _internal_touchEndEvent: (event: { _internal_srcType: string; Qp: string }) => {
            locked = false;
            events.push(event._internal_srcType ?? event.Qp);
          },
          _internal_tapEvent: () => events.push('tap'),
          _internal_doubleTapEvent: () => events.push('doubletap'),
          _internal_pinchStartEvent: () => events.push('pinch-start'),
          _internal_pinchEndEvent: () => events.push('pinch-end'),
        }
      : {
          Op: () => {
            locked = true;
          },
          Vp: (event: { Qp: string }) => {
            locked = false;
            events.push(event.Qp);
          },
          Bp: () => events.push('tap'),
          _p: () => events.push('doubletap'),
          $p: () => events.push('pinch-start'),
          qp: () => events.push('pinch-end'),
        };
  const instance = new Handler(target, handlers, {});
  const input = (type: string, changed = [touch(1)], remaining: Touch[] = []): TouchInput => ({
    type,
    timeStamp: Date.now(),
    changedTouches: changed,
    touches: remaining,
    target,
    cancelable: true,
    preventDefault: vi.fn(),
  });
  return {
    target,
    root,
    instance,
    fields: CHART_TOUCH_CANCEL_SOURCES[variant].fields,
    events,
    input,
    locked: () => locked,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
for (const variant of ['development', 'production'] as const)
  describe(variant + ' reviewed touchcancel cleanup', () => {
    it('reproduces the original dependency consuming the next unrelated button touchend', () => {
      const { target, root, input, events, locked } = installedHandler(variant, false);
      target.dispatch('touchstart', input('touchstart', [touch(1)], [touch(1)]));
      target.dispatch('touchcancel', input('touchcancel'));
      expect(locked()).toBe(true);
      expect(root.listeners.get('touchend')?.size).toBe(1);
      const unrelated = input('touchend');
      root.dispatch('touchend', unrelated);
      expect(unrelated.preventDefault).toHaveBeenCalled();
      expect(events).toContain('tap');
    });
    it('rejects any changed source or version and preserves original banner', () => {
      const source = original(variant);
      expect(() => patchChartTouchCancel(source, variant, '5.2.2')).toThrow('Unreviewed');
      expect(() => patchChartTouchCancel(source + '\n', variant)).toThrow('Unreviewed');
      expect(patchChartTouchCancel(source, variant).slice(0, source.indexOf('*/') + 2)).toBe(
        source.slice(0, source.indexOf('*/') + 2),
      );
      expect(patchChartTouchCancel(source, variant)).toContain(
        'BoriChart touchcancel cleanup; Lightweight Charts ' + CHART_TOUCH_CANCEL_VERSION,
      );
    });
    it('releases root handlers and model lock without a fabricated tap, touchend or click', () => {
      const {
        target,
        root,
        instance,
        fields: f,
        input,
        events,
        locked,
      } = installedHandler(variant);
      target.dispatch('touchstart', input('touchstart', [touch(1)], [touch(1)]));
      expect(locked()).toBe(true);
      expect(root.listeners.get('touchend')?.size).toBe(1);
      instance[f.longTap] = true;
      target.dispatch('touchcancel', input('touchcancel'));
      expect(instance[f.active]).toBeNull();
      expect(instance[f.unsubscribe]).toBeNull();
      expect(instance[f.moveStart]).toBeNull();
      expect(instance[f.longTap]).toBe(false);
      expect(locked()).toBe(false);
      expect(events).toEqual(['touchcancel']);
      expect(root.listeners.get('touchend')?.size).toBe(0);
      expect(root.listeners.get('touchmove')?.size).toBe(0);
      const external = input('touchend');
      root.dispatch('touchend', external);
      expect(external.preventDefault).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(events).toEqual(['touchcancel']);
      target.dispatch('touchstart', input('touchstart', [touch(2)], [touch(2)]));
      expect(instance[f.active]).toBe(2);
      expect(root.listeners.get('touchend')?.size).toBe(1);
      target.dispatch('touchcancel', input('touchcancel', [touch(2)]));
      expect(locked()).toBe(false);
    });
    it('ends an active pinch on cancellation and allows the next real pinch', () => {
      const { target, instance, fields: f, input, events } = installedHandler(variant);
      target.dispatch(
        'touchstart',
        input('touchstart', [touch(1), touch(2)], [touch(1), touch(2)]),
      );
      expect(events).toEqual(['pinch-start']);
      target.dispatch('touchcancel', input('touchcancel', [touch(1), touch(2)]));
      expect(events).toEqual(['pinch-start', 'pinch-end', 'touchcancel']);
      expect(instance[f.pinchDistance]).toBe(0);
      target.dispatch(
        'touchstart',
        input('touchstart', [touch(3), touch(4)], [touch(3), touch(4)]),
      );
      expect(events.at(-1)).toBe('pinch-start');
      target.dispatch('touchcancel', input('touchcancel', [touch(3), touch(4)]));
    });
    it('releases a terminated gesture even when the browser cancel supplies no matching changed touch', () => {
      const {
        target,
        root,
        instance,
        fields: f,
        input,
        events,
        locked,
      } = installedHandler(variant);
      target.dispatch('touchstart', input('touchstart', [touch(1)], [touch(1)]));
      target.dispatch('touchcancel', input('touchcancel', []));
      expect(instance[f.active]).toBeNull();
      expect(instance[f.unsubscribe]).toBeNull();
      expect(root.listeners.get('touchend')?.size).toBe(0);
      expect(locked()).toBe(false);
      expect(events).toEqual(['touchcancel']);
      target.dispatch('touchcancel', input('touchcancel', []));
      expect(events).toEqual(['touchcancel']);
    });
    it('retains the uncanceled primary finger when only the secondary pinch finger is canceled', () => {
      const { target, instance, fields: f, input, events } = installedHandler(variant);
      target.dispatch(
        'touchstart',
        input('touchstart', [touch(1), touch(2)], [touch(1), touch(2)]),
      );
      target.dispatch('touchcancel', input('touchcancel', [touch(2)], [touch(1)]));
      expect(instance[f.active]).toBe(1);
      expect(events).toEqual(['pinch-start', 'pinch-end']);
      target.dispatch('touchcancel', input('touchcancel', [touch(1)]));
      expect(events.at(-1)).toBe('touchcancel');
    });
  });

it('transforms only the exact dependency entry points in dev/build and leaves installed files intact', () => {
  const plugin = chartTouchCancelPlugin();
  (plugin.configResolved as (config: ResolvedConfig) => void)({
    root: process.cwd(),
  } as ResolvedConfig);
  const transform = plugin.transform as (source: string, id: string) => { code: string } | null;
  expect(transform('export {}', '/src/AnalysisChart.tsx')).toBeNull();
  for (const variant of ['development', 'production'] as const) {
    const spec = CHART_TOUCH_CANCEL_SOURCES[variant],
      source = original(variant);
    expect(
      transform(
        source,
        'C:\\project\\node_modules\\lightweight-charts\\dist\\' + spec.file + '?v=test',
      )?.code,
    ).toContain('BoriChart touchcancel cleanup');
    expect(original(variant)).toBe(source);
  }
});

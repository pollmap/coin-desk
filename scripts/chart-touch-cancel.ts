import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

export const CHART_TOUCH_CANCEL_VERSION = '5.2.1';
export const CHART_TOUCH_CANCEL_SOURCES = {
  development: {
    file: 'lightweight-charts.development.mjs',
    sha256: '350786b76b81fd99d2fd4f782ad9a35747883cce3c2671d0b35eade8b397a4ae',
    listener:
      "this._private__target.addEventListener('touchcancel', this._private__clearLongTapTimeout.bind(this));",
    fields: {
      active: '_private__activeTouchId',
      target: '_private__target',
      clearLongTap: '_private__clearLongTapTimeout',
      unsubscribe: '_private__unsubscribeRootTouchEvents',
      moveStart: '_private__touchMoveStartPosition',
      longTap: '_private__longTapActive',
      cancelTap: '_private__cancelTap',
      exceeded: '_private__touchMoveExceededManhattanDistance',
      preventDrag: '_private__preventTouchDragProcess',
      resetTap: '_private__resetTapTimeout',
      stopPinch: '_private__stopPinch',
      checkPinch: '_private__checkPinchState',
      pinchDistance: '_private__startPinchDistance',
      pinchPrevented: '_private__pinchPrevented',
      lastTouch: '_private__lastTouchEventTimeStamp',
      makeCompat: '_private__makeCompatEvent',
      processTouch: '_private__processTouchEvent',
      handler: '_private__handler',
      endCallback: '_internal_touchEndEvent',
      findTouch: 'touchWithId',
      eventTime: 'eventTimeStamp',
    },
  },
  production: {
    file: 'lightweight-charts.production.mjs',
    sha256: 'faf0924968b1cbb9ea5bb6baa43a27ed6a0802341c07238b72ae869ffebab90c',
    listener: 'this.vp.addEventListener("touchcancel",this.wp.bind(this))',
    fields: {
      active: 'tp',
      target: 'vp',
      clearLongTap: 'wp',
      unsubscribe: 'Yf',
      moveStart: 'Of',
      longTap: 'Lf',
      cancelTap: 'Wf',
      exceeded: 'Nf',
      preventDrag: 'Xf',
      resetTap: 'cp',
      stopPinch: 'Kp',
      checkPinch: 'Yp',
      pinchDistance: 'Gf',
      pinchPrevented: 'Zf',
      lastTouch: 'Qf',
      makeCompat: 'hp',
      processTouch: 'op',
      handler: 'up',
      endCallback: 'Vp',
      findTouch: 'Cn',
      eventTime: 'xn',
    },
  },
} as const;

type Variant = keyof typeof CHART_TOUCH_CANCEL_SOURCES;
const hash = (source: string) => createHash('sha256').update(source, 'utf8').digest('hex');

/**
 * The reviewed 5.2.1 distribution only clears its long-tap timer on touchcancel.
 * Root touch listeners then consume the next unrelated button's touchend.
 * This source-hash-limited change releases that gesture without dispatching a
 * touchend, tap or click. Existing drag/axis/pinch finish callbacks receive the
 * original cancel event to release their model locks; tap counters stay reset.
 */
export function patchChartTouchCancel(
  source: string,
  variant: Variant,
  version: string = CHART_TOUCH_CANCEL_VERSION,
) {
  const spec = CHART_TOUCH_CANCEL_SOURCES[variant];
  if (version !== CHART_TOUCH_CANCEL_VERSION || hash(source) !== spec.sha256)
    throw new Error(
      'Unreviewed Lightweight Charts version/source: touchcancel cleanup not applied.',
    );
  if (source.split(spec.listener).length !== 2)
    throw new Error(
      'The reviewed Lightweight Charts touchcancel listener must occur exactly once.',
    );
  const f = spec.fields;
  const notice = `/*! BoriChart touchcancel cleanup; Lightweight Charts ${version}; original SHA256 ${spec.sha256}. TradingView license/banner preserved. */`;
  const replacement = `this.${f.target}.addEventListener('touchcancel', function(event) {
  this.${f.clearLongTap}();
  const active = this.${f.active};
  const canceled = active === null ? null : ${f.findTouch}(event.changedTouches, active);
  if (active !== null && canceled === null && event.touches.length !== 0) {
    this.${f.checkPinch}(event.touches);
    return;
  }
  this.${f.active} = null;
  this.${f.lastTouch} = ${f.eventTime}(event);
  this.${f.moveStart} = null;
  this.${f.longTap} = false;
  this.${f.cancelTap} = true;
  this.${f.exceeded} = false;
  this.${f.preventDrag} = false;
  if (this.${f.unsubscribe} !== null) {
    this.${f.unsubscribe}();
    this.${f.unsubscribe} = null;
  }
  this.${f.resetTap}();
  this.${f.stopPinch}();
  this.${f.pinchDistance} = 0;
  this.${f.pinchPrevented} = false;
  if (active !== null) {
    const compatibleCancel = this.${f.makeCompat}(event, canceled ?? undefined);
    this.${f.processTouch}(compatibleCancel, this.${f.handler}.${f.endCallback});
  }
}.bind(this))${variant === 'development' ? ';' : ''}`;
  const patched = source.replace(spec.listener, replacement);
  // Rollup can drop legal comments inside a class method. Preserve the original
  // license and place the change notice beside it at module level.
  const bannerEnd = patched.indexOf('*/') + 2;
  return patched.slice(0, bannerEnd) + '\n' + notice + patched.slice(bannerEnd);
}

/** Runs before Vite transforms in dev and build; node_modules remains unchanged. */
export function chartTouchCancelPlugin(): Plugin {
  let version = '';
  return {
    name: 'bori-chart-touch-cancel-5-2-1',
    enforce: 'pre',
    configResolved(config) {
      const directory = resolve(config.root, 'node_modules/lightweight-charts');
      version = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')).version;
      for (const variant of ['development', 'production'] as const)
        patchChartTouchCancel(
          readFileSync(
            resolve(directory, 'dist', CHART_TOUCH_CANCEL_SOURCES[variant].file),
            'utf8',
          ),
          variant,
          version,
        );
    },
    transform(source, id) {
      const path = id.replaceAll('\\', '/').split('?')[0];
      for (const variant of ['development', 'production'] as const) {
        const spec = CHART_TOUCH_CANCEL_SOURCES[variant];
        if (path.endsWith('/node_modules/lightweight-charts/dist/' + spec.file))
          return { code: patchChartTouchCancel(source, variant, version), map: null };
      }
      return null;
    },
  };
}

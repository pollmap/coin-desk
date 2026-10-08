import { useLayoutEffect, useRef } from 'react';
import { ASSETS } from '../shared/catalog';
import { relativePair } from '../shared/relative-pair';
import type { Asset } from '../shared/types';

export function RelativeControls({
  asset,
  params,
  change,
}: {
  asset: Asset;
  params: URLSearchParams;
  change: (values: Record<string, string | null>) => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const pair = relativePair(asset, params);
  const mode = ['percent', 'ratio'].includes(params.get('normalization') ?? '')
    ? params.get('normalization')!
    : 'index';
  const window = [30, 90, 365].includes(Number(params.get('correlation')))
    ? Number(params.get('correlation'))
    : 90;
  const selection = useRef({
    benchmark_asset: pair.benchmark as string,
    normalization: mode,
    correlation: String(window),
  });
  useLayoutEffect(() => {
    selection.current = {
      benchmark_asset: pair.benchmark,
      normalization: mode,
      correlation: String(window),
    };
  }, [pair.benchmark, mode, window]);
  function update(key: keyof typeof selection.current, value: string) {
    // Router updates are asynchronous; compose rapid edits from the last intent,
    // not a controlled select temporarily restored to an older render's value.
    selection.current = { ...selection.current, [key]: value };
    change({ ...selection.current, correlation_asset: null });
  }
  return (
    <details
      className="relative-controls"
      ref={menu}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && menu.current?.open) {
          event.stopPropagation();
          menu.current.open = false;
          menu.current.querySelector('summary')?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null) && menu.current)
          menu.current.open = false;
      }}
    >
      <summary aria-label="비교 설정" title={pair.benchmark + ' 비교 설정'}>
        {pair.benchmark}
        <span className="relative-compare-label"> 비교</span>
      </summary>
      <div className="relative-control-fields">
        <label>
          비교 코인
          <select
            aria-label="비교 코인"
            value={pair.benchmark}
            onChange={(event) => update('benchmark_asset', event.target.value)}
          >
            {ASSETS.filter((item) => item.id !== pair.asset).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          비교 기준
          <select
            aria-label="비교 기준"
            value={mode}
            onChange={(event) => update('normalization', event.target.value)}
          >
            <option value="index">시작값 100</option>
            <option value="percent">% 변화</option>
            <option value="ratio">가격 비율</option>
          </select>
        </label>
        <label>
          상관 기간
          <select
            aria-label="상관 기간"
            value={window}
            onChange={(event) => update('correlation', event.target.value)}
          >
            {[30, 90, 365].map((days) => (
              <option key={days} value={days}>
                {days}일
              </option>
            ))}
          </select>
        </label>
      </div>
    </details>
  );
}

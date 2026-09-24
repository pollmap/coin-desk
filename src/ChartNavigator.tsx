import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { IChartApi, UTCTimestamp } from 'lightweight-charts';
import type { Point } from '../shared/types';
import { dateLabel } from './lib';

/** Full history remains visible even when the main chart is zoomed into a cycle. */
export function ChartNavigator({
  rows,
  chart,
  label,
  log = false,
}: {
  rows: readonly Point[];
  chart: RefObject<IChartApi | null>;
  label: string;
  log?: boolean;
}) {
  const [range, setRange] = useState([0, Math.max(0, rows.length - 1)]);
  const path = useMemo(() => {
    if (!rows.length) return '';
    const values = rows.map((p) => p.value);
    const useLog = log && values.every((v) => v > 0);
    const scaled = values.map((v) => (useLog ? Math.log(v) : v));
    const min = Math.min(...scaled),
      max = Math.max(...scaled),
      span = max - min || 1;
    // Preserve extrema in each pixel bucket instead of skipping isolated peaks.
    const stride = Math.max(1, Math.ceil(rows.length / 400));
    const sampled: number[] = [];
    for (let i = 0; i < rows.length; i += stride) {
      let low = i,
        high = i;
      for (let j = i; j < Math.min(i + stride, rows.length); j++) {
        if (rows[j].value < rows[low].value) low = j;
        if (rows[j].value > rows[high].value) high = j;
      }
      sampled.push(...[low, high].sort((a, b) => a - b));
    }
    return sampled
      .map(
        (i, n) =>
          `${n ? 'L' : 'M'}${((i / Math.max(1, rows.length - 1)) * 1000).toFixed(2)},${(40 - ((scaled[i] - min) / span) * 34).toFixed(2)}`,
      )
      .join(' ');
  }, [rows, log]);
  useEffect(() => {
    let api: IChartApi | null = null;
    const sync = () => {
      const v = api?.timeScale().getVisibleRange();
      if (!v) return;
      let left = rows.findIndex((p) => p.time >= Number(v.from));
      let right = rows.findIndex((p) => p.time > Number(v.to));
      setRange([Math.max(0, left), right < 0 ? rows.length - 1 : Math.max(left, right - 1)]);
    };
    const frame = requestAnimationFrame(() => {
      api = chart.current;
      sync();
      api?.timeScale().subscribeVisibleTimeRangeChange(sync);
    });
    return () => {
      cancelAnimationFrame(frame);
      try {
        api?.timeScale().unsubscribeVisibleTimeRangeChange(sync);
      } catch {
        /* Chart may have been removed first. */
      }
    };
  }, [rows, chart]);
  if (rows.length < 2) return null;
  const apply = (index: number, value: number) => {
    const next = [...range];
    next[index] = value;
    next[0] = Math.min(next[0], next[1] - 1);
    next[1] = Math.max(next[1], next[0] + 1);
    setRange(next);
    chart.current?.timeScale().setVisibleRange({
      from: rows[next[0]].time as UTCTimestamp,
      to: rows[next[1]].time as UTCTimestamp,
    });
  };
  return (
    <div className="history-navigator" aria-label={label + ' 전체 이력 탐색'}>
      <div className="navigator-plot">
        <svg viewBox="0 0 1000 46" preserveAspectRatio="none" aria-hidden="true">
          <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect
            x={(range[0] / (rows.length - 1)) * 1000}
            y="0"
            width={((range[1] - range[0]) / (rows.length - 1)) * 1000}
            height="46"
            fill="currentColor"
            opacity=".12"
          />
        </svg>
      </div>
      <div className="navigator-sliders">
        <label>
          시작
          <input
            aria-label={label + ' 범위 시작'}
            type="range"
            min="0"
            max={rows.length - 2}
            value={range[0]}
            onChange={(e) => apply(0, Number(e.target.value))}
          />
        </label>
        <label>
          종료
          <input
            aria-label={label + ' 범위 종료'}
            type="range"
            min="1"
            max={rows.length - 1}
            value={range[1]}
            onChange={(e) => apply(1, Number(e.target.value))}
          />
        </label>
      </div>
      <div className="navigator-dates">
        <span>{dateLabel(rows[0].time)}</span>
        <span>
          전체 이력{log ? ' · 로그' : ''} · {rows.length.toLocaleString()}개 관측
        </span>
        <span>{dateLabel(rows.at(-1)!.time)}</span>
      </div>
    </div>
  );
}

export function ChartTools({
  chart,
  rows,
  label,
  unit,
  source,
  onExport,
  onZoom,
  onReset,
  exportLabel = '보이는 구간 CSV',
}: {
  chart: RefObject<IChartApi | null>;
  rows: readonly Point[];
  label: string;
  unit: string;
  source: string;
  onExport?: () => void;
  onZoom?: (factor: number) => void;
  onReset?: () => void;
  exportLabel?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState('');
  const [share, setShare] = useState('');
  const csv = () => {
    const range = chart.current?.timeScale().getVisibleRange();
    const visible = rows.filter(
      (p) => !range || (p.time >= Number(range.from) && p.time <= Number(range.to)),
    );
    const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
    const content =
      '\uFEFF' +
      [
        'date_utc,value,unit,source',
        ...visible.map(
          (p) =>
            `${new Date(p.time * 1000).toISOString()},${p.value},${quote(unit === '비율' || unit === '%' ? 'ratio' : unit)},${quote(source)}`,
        ),
      ].join('\r\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `Coin-Desk-${label}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(`${visible.length.toLocaleString()}개 관측을 내보냈습니다.`);
  };
  return (
    <div ref={host} className="chart-utility-bar">
      {onZoom && (
        <div className="chart-zoom-actions" role="group" aria-label="차트 확대와 범위">
          <button aria-label={label + ' 차트 확대'} onClick={() => onZoom(1 / 1.4)}>
            ＋
          </button>
          <button aria-label={label + ' 차트 축소'} onClick={() => onZoom(1.4)}>
            −
          </button>
          <button onClick={onReset}>전체 이력</button>
        </div>
      )}
      <div>
        <button
          onClick={async () => {
            const panel = host.current?.closest('section');
            if (document.fullscreenElement) {
              await document.exitFullscreen();
              return;
            }
            try {
              await panel?.requestFullscreen();
            } catch {
              setMessage('이 브라우저는 전체화면을 지원하지 않습니다.');
            }
          }}
        >
          전체화면
        </button>
        <button
          onClick={async () => {
            setShare(location.href);
            try {
              await navigator.clipboard.writeText(location.href);
              setMessage('화면 링크를 복사했습니다.');
            } catch {
              setMessage('주소를 선택해 복사해 주세요.');
            }
          }}
        >
          링크 공유
        </button>
        <button onClick={onExport ?? csv} disabled={!rows.length}>
          {exportLabel}
        </button>
      </div>
      {share && (
        <label className="chart-share-address">
          공유 주소
          <input
            aria-label="공유 주소"
            value={share}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
          />
          <button onClick={() => setShare('')}>닫기</button>
        </label>
      )}
      <small role="status">{message}</small>
    </div>
  );
}

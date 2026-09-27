import { useEffect, useState } from 'react';
import { Minus, MoveUpRight, GalleryVertical, Ruler, Undo2, X } from 'lucide-react';
import type { IChartApi, ISeriesApi, SeriesType, UTCTimestamp } from 'lightweight-charts';
import { validAnnotations, type Annotation, type DrawingKind } from '../shared/annotations';

export function readAnnotations(key: string): Annotation[] {
  try {
    return validAnnotations(
      JSON.parse(localStorage.getItem('coin-desk.drawings.v2:' + key) || '[]'),
    );
  } catch {
    return [];
  }
}
export function ChartDrawings({
  chart,
  series,
  storageKey,
  onChange,
}: {
  chart: IChartApi;
  series: ISeriesApi<SeriesType>;
  storageKey: string;
  onChange?: (items: Annotation[]) => void;
}) {
  const [mode, setMode] = useState<DrawingKind | null>(null),
    [items, setItems] = useState(() => readAnnotations(storageKey)),
    [draft, setDraft] = useState<Annotation['points']>([]),
    [revision, redraw] = useState(0),
    [error, setError] = useState('');
  useEffect(() => {
    setItems(readAnnotations(storageKey));
    setDraft([]);
    setMode(null);
  }, [storageKey]);
  useEffect(() => {
    const restore = () => setItems(readAnnotations(storageKey));
    window.addEventListener('coin-desk-annotations', restore);
    return () => window.removeEventListener('coin-desk-annotations', restore);
  }, [storageKey]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMode(null);
        setDraft([]);
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  useEffect(() => {
    const refresh = () => redraw((v) => v + 1);
    chart.timeScale().subscribeVisibleTimeRangeChange(refresh);
    chart.subscribeCrosshairMove(refresh);
    window.addEventListener('resize', refresh);
    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(refresh);
      chart.unsubscribeCrosshairMove(refresh);
      window.removeEventListener('resize', refresh);
    };
  }, [chart]);
  function persist(next: Annotation[]) {
    try {
      localStorage.setItem('coin-desk.drawings.v2:' + storageKey, JSON.stringify(next));
      setItems(next);
      onChange?.(next);
      setError('');
    } catch {
      setError('주석 저장 공간을 확인해 주세요. 기존 주석은 보존됩니다.');
    }
  }
  useEffect(() => {
    if (!mode) return;
    const click: Parameters<IChartApi['subscribeClick']>[0] = (event) => {
      if (!event.point || event.time === undefined || (event.paneIndex ?? 0) !== 0) return;
      const value = series.coordinateToPrice(event.point.y);
      if (value === null) return;
      const points = [...draft, { time: Number(event.time), value }];
      const count = mode === 'horizontal' ? 1 : mode === 'channel' ? 3 : 2;
      if (points.length === count) {
        persist([...items, { id: crypto.randomUUID(), kind: mode, points }].slice(-60));
        setDraft([]);
        setMode(null);
      } else setDraft(points);
    };
    chart.subscribeClick(click);
    return () => chart.unsubscribeClick(click);
  }, [chart, series, mode, draft, items, storageKey]);
  const width = chart.timeScale().width(),
    height = chart.panes()[0]?.getHeight() ?? 0;
  const position = (p: Annotation['points'][number]) => ({
    x: chart.timeScale().timeToCoordinate(p.time as UTCTimestamp),
    y: series.priceToCoordinate(p.value),
  });
  const draw = (a: Annotation) => {
    const pts = a.points.map(position);
    if (pts.some((p) => p.x === null || p.y === null)) return null;
    const [p, q, r] = pts as { x: number; y: number }[];
    if (a.kind === 'horizontal') return <line key={a.id} x1={0} x2={width} y1={p.y} y2={p.y} />;
    const delta =
      a.kind === 'channel' ? r.y - (p.y + ((q.y - p.y) * (r.x - p.x)) / (q.x - p.x || 1)) : 0;
    return (
      <g key={a.id}>
        <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} />
        {a.kind === 'channel' && <line x1={p.x} y1={p.y + delta} x2={q.x} y2={q.y + delta} />}{' '}
        {a.kind === 'measure' && (
          <>
            <rect
              x={Math.min(p.x, q.x)}
              y={Math.min(p.y, q.y)}
              width={Math.abs(q.x - p.x)}
              height={Math.abs(q.y - p.y)}
              fill="#65d4bc18"
              strokeDasharray="4 3"
            />
            <text
              x={Math.min(width - 150, Math.max(4, (p.x + q.x) / 2))}
              y={Math.max(18, Math.min(p.y, q.y) - 8)}
              stroke="none"
              fill="currentColor"
            >
              {a.points[0].value === 0
                ? '—'
                : ((a.points[1].value / a.points[0].value - 1) * 100).toFixed(2) + '%'}{' '}
              · {Math.abs((a.points[1].time - a.points[0].time) / 86400).toFixed(1)}일
            </text>
          </>
        )}
      </g>
    );
  };
  return (
    <>
      <svg
        className="drawing-overlay"
        width={width}
        height={height}
        aria-hidden="true"
        data-revision={revision}
      >
        <g stroke="#d9ac54" strokeWidth="1.5">
          {items.map(draw)}
          {draft.map((p, i) => {
            const xy = position(p);
            return xy.x !== null && xy.y !== null ? (
              <circle key={i} cx={xy.x} cy={xy.y} r={4} />
            ) : null;
          })}
        </g>
      </svg>
      <div
        className="drawing-toolbar"
        role="group"
        aria-label="차트 주석"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setMode(null);
            setDraft([]);
          }
        }}
      >
        {(
          [
            ['horizontal', '수평선'],
            ['trend', '추세선'],
            ['channel', '평행 채널'],
            ['measure', '구간 측정'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-label={label}
            title={label}
            aria-pressed={mode === id}
            onClick={() => {
              setMode(mode === id ? null : id);
              setDraft([]);
            }}
          >
            {id === 'horizontal' ? (
              <Minus size={18} />
            ) : id === 'trend' ? (
              <MoveUpRight size={18} />
            ) : id === 'channel' ? (
              <GalleryVertical size={18} />
            ) : (
              <Ruler size={18} />
            )}
          </button>
        ))}
        <button
          aria-label="실행 취소"
          title="실행 취소"
          disabled={!items.length}
          onClick={() => persist(items.slice(0, -1))}
        >
          <Undo2 size={18} />
        </button>
        {mode && (
          <button
            aria-label="주석 취소"
            title="주석 취소 · Escape"
            onClick={() => {
              setMode(null);
              setDraft([]);
            }}
          >
            <X size={18} />
          </button>
        )}
        <span className="drawing-instruction" role="status">
          {error ||
            (mode
              ? mode === 'horizontal'
                ? '한 점 선택'
                : mode === 'channel'
                  ? '기준 두 점, 폭 한 점 선택'
                  : '두 점 선택'
              : '')}
        </span>
      </div>
    </>
  );
}

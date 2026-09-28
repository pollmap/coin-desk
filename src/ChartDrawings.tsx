import { useEffect, useRef, useState } from 'react';
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
  initialTool,
}: {
  chart: IChartApi;
  series: ISeriesApi<SeriesType>;
  storageKey: string;
  onChange?: (items: Annotation[]) => void;
  initialTool?: DrawingKind;
}) {
  const [mode, setMode] = useState<DrawingKind | null>(null),
    [items, setItems] = useState(() => readAnnotations(storageKey)),
    [draft, setDraft] = useState<Annotation['points']>([]),
    [revision, redraw] = useState(0),
    [error, setError] = useState('');
  // Two rapid clicks can arrive before a passive effect resubscribes. Keep the
  // draft synchronous so the second point cannot overwrite the first one.
  const draftRef = useRef<Annotation['points']>([]);
  function updateDraft(points: Annotation['points']) {
    draftRef.current = points;
    setDraft(points);
  }
  useEffect(() => {
    setItems(readAnnotations(storageKey));
    updateDraft([]);
    setMode(initialTool ?? null);
  }, [storageKey, initialTool]);
  useEffect(() => {
    const restore = () => setItems(readAnnotations(storageKey));
    window.addEventListener('coin-desk-annotations', restore);
    return () => window.removeEventListener('coin-desk-annotations', restore);
  }, [storageKey]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMode(null);
        updateDraft([]);
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  useEffect(() => {
    let frame = 0;
    const refresh = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          redraw((v) => v + 1);
        });
    };
    const hasDrawing = items.length > 0 || draft.length > 0;
    chart.timeScale().subscribeVisibleTimeRangeChange(refresh);
    if (hasDrawing) chart.subscribeCrosshairMove(refresh);
    window.addEventListener('resize', refresh);
    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(refresh);
      if (hasDrawing) chart.unsubscribeCrosshairMove(refresh);
      window.removeEventListener('resize', refresh);
      cancelAnimationFrame(frame);
    };
  }, [chart, items.length, draft.length]);
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
  // LWC suppresses a second, distant click inside its double-click timeout.
  // While drawing, take pointer coordinates directly from our primary-pane SVG
  // and convert them using the public chart API; normal chart gestures are untouched.
  function pointAt(x: number, y: number) {
    if (!mode) return;
    const time = chart.timeScale().coordinateToTime(x);
    const value = series.coordinateToPrice(y);
    if (typeof time !== 'number' || value === null || !Number.isFinite(value)) return;
    const points = [...draftRef.current, { time, value }];
    const count = mode === 'horizontal' ? 1 : mode === 'channel' ? 3 : 2;
    if (points.length === count) {
      persist([...items, { id: crypto.randomUUID(), kind: mode, points }].slice(-60));
      updateDraft([]);
      setMode(null);
    } else updateDraft(points);
  }
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
        style={
          mode ? { pointerEvents: 'auto', touchAction: 'none', cursor: 'crosshair' } : undefined
        }
        onClick={
          mode
            ? (event) => {
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                if (rect.width && rect.height)
                  pointAt(
                    ((event.clientX - rect.left) * width) / rect.width,
                    ((event.clientY - rect.top) * height) / rect.height,
                  );
              }
            : undefined
        }
      >
        {mode && <rect width={width} height={height} fill="transparent" pointerEvents="all" />}
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
            updateDraft([]);
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
              updateDraft([]);
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
              updateDraft([]);
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
                  ? `기준 두 점, 폭 한 점 선택 (${draft.length}/3)`
                  : `두 점 선택 (${draft.length}/2)`
              : '')}
        </span>
      </div>
    </>
  );
}

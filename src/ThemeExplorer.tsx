import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from './hooks';
import type { themesResponse } from '../shared/knowledge';
import type { ThemeMarketResponse } from '../shared/theme-market';
import type { ThemeMatrixPoint } from '../shared/market-matrix';
import type { Asset, Market } from '../shared/types';
import { ASSETS } from '../shared/catalog';
import { availableMarket, supportsMarket } from '../shared/asset-registry';
import { AssetLogo } from './AssetLogo';
import { numeric } from './lib';

const labels = {
  'up-volume-up': '상승',
  'down-volume-up': '조정',
  'volume-down': '거래량 감소',
  baseline: '기준선',
} as const;
const change = (value: number) => (value > 0 ? '+' : '') + numeric(value) + '%';

function ThemeMap({
  points,
  domain,
  selected,
  select,
}: {
  points: ThemeMatrixPoint[];
  domain: ThemeMatrixPoint[];
  selected: string | null;
  select: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const resize = () => setWidth(Math.max(240, Math.round(element.clientWidth)));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const height = width < 600 ? 340 : 390;
  const left = 45,
    right = width - 25,
    top = 45,
    bottom = height - 58;
  const cx = (left + right) / 2,
    cy = (top + bottom) / 2;
  const xRange = Math.max(5, ...domain.map((p) => Math.abs(p.x))) * 1.15;
  // Signed log coordinates retain actual ratios and keep extreme volume readable.
  const volume = (ratio: number) => Math.sign(ratio - 1) * Math.log1p(Math.abs(ratio - 1));
  const yRange = Math.max(Math.log(2), ...domain.map((p) => Math.abs(volume(p.y)))) * 1.15;
  const x = (value: number) => cx + ((value / xRange) * (right - left)) / 2;
  const y = (value: number) => cy - ((volume(value) / yRange) * (bottom - top)) / 2;
  const boxes: { left: number; top: number; width: number; height: number }[] = [];
  const captions = new Map(
    points
      .filter((point) => width >= 600 || selected === point.id)
      .map((point) => {
        const px = x(point.x),
          py = y(point.y),
          textWidth = Math.max(42, point.title.length * 12);
        let box = { left: px + 12, top: py - 21, width: textWidth, height: 18 };
        for (let attempt = 0; attempt < 80; attempt++) {
          const direction = attempt % 2 === 0 ? 1 : -1;
          const row = Math.floor(attempt / 2);
          const dy = row === 0 ? -21 : (row % 2 === 0 ? -1 : 1) * (Math.ceil(row / 2) * 21);
          box = {
            left: Math.max(
              left,
              Math.min(right - textWidth, px + (direction > 0 ? 12 : -textWidth - 12)),
            ),
            top: Math.max(top + 20, Math.min(bottom - 18, py + dy)),
            width: textWidth,
            height: 18,
          };
          if (
            !boxes.some(
              (other) =>
                box.left < other.left + other.width + 4 &&
                box.left + box.width + 4 > other.left &&
                box.top < other.top + other.height + 3 &&
                box.top + box.height + 3 > other.top,
            )
          )
            break;
        }
        boxes.push(box);
        return [point.id, { x: box.left, y: box.top + 13 }];
      }),
  );
  return (
    <div className="theme-map" ref={host}>
      <svg
        viewBox={'0 0 ' + width + ' ' + height}
        role="group"
        aria-label="테마 가격 변화와 거래량 매트릭스"
      >
        <text x={left} y="18" className="theme-map-axis">
          거래량 배수
        </text>
        <text x={left + 6} y={top - 9} className="theme-map-zone">
          조정 · 거래량 증가
        </text>
        <text x={right - 6} y={top - 9} textAnchor="end" className="theme-map-zone">
          상승 · 거래량 증가
        </text>
        <text x={cx} y={bottom - 8} textAnchor="middle" className="theme-map-zone">
          거래량 감소
        </text>
        <line x1={left} x2={right} y1={cy} y2={cy} className="theme-map-baseline" />
        <line x1={cx} x2={cx} y1={top} y2={bottom} className="theme-map-baseline" />
        {[0, 0.5, 1, 2, 4, 8]
          .filter((v) => Math.abs(volume(v)) <= yRange)
          .map((v) => (
            <g key={v}>
              <text x={left - 8} y={y(v) + 4} textAnchor="end" className="theme-map-axis">
                {v}×
              </text>
              {v !== 1 && (
                <line x1={left} x2={right} y1={y(v)} y2={y(v)} className="theme-map-grid" />
              )}
            </g>
          ))}
        {[-1, 0, 1].map((sign) => (
          <text
            key={sign}
            x={x((sign * xRange) / 1.15)}
            y={bottom + 23}
            textAnchor="middle"
            className="theme-map-axis"
          >
            {sign === 0 ? '0' : numeric((sign * xRange) / 1.15, 1)}%
          </text>
        ))}
        <text x={cx} y={height - 5} textAnchor="middle" className="theme-map-axis">
          7일 가격 변화
        </text>
        {points.map((point) => (
          <g
            key={point.id}
            transform={'translate(' + x(point.x) + ',' + y(point.y) + ')'}
            className={
              'theme-map-point ' + point.status + (selected === point.id ? ' selected' : '')
            }
            role="button"
            tabIndex={0}
            aria-pressed={selected === point.id}
            aria-label={
              point.title +
              ' · ' +
              labels[point.status] +
              ' · ' +
              change(point.x) +
              ' · 거래량 ' +
              numeric(point.y) +
              '배'
            }
            onClick={() => select(point.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                select(point.id);
              }
            }}
          >
            <rect x="-22" y="-22" width="44" height="44" fill="transparent" />
            <circle r={selected === point.id ? 9 : 6} />
            {captions.has(point.id) && (
              <>
                <line
                  x1="0"
                  y1="0"
                  x2={captions.get(point.id)!.x - x(point.x)}
                  y2={captions.get(point.id)!.y - y(point.y) - 4}
                  className="theme-map-caption-line"
                />
                <text
                  x={captions.get(point.id)!.x - x(point.x)}
                  y={captions.get(point.id)!.y - y(point.y)}
                  className="theme-map-caption"
                >
                  {point.title}
                </text>
              </>
            )}
            <title>
              {point.title} · {change(point.x)} · {numeric(point.y)}×
            </title>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function ThemeExplorer({
  selected,
  onSelect,
  href,
  market,
}: {
  selected: string | null;
  onSelect: (id: string | null) => void;
  href: (asset: Asset) => string;
  market: Market;
}) {
  const catalog = useData<ReturnType<typeof themesResponse>>('/api/v1/themes', false, 3600000);
  const matrix = useData<ThemeMarketResponse>(
    '/api/v1/theme-market?market=' + market,
    false,
    60000,
  );
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [query, market]);
  const failed = !!(matrix.error || catalog.error);
  const matrixReady = !failed && matrix.data?.market === market;
  const points = matrixReady ? matrix.data!.themes.points : [];
  const byId = new Map(points.map((p) => [p.id, p]));
  const groups = (catalog.data?.themes ?? []).filter(
    (t) =>
      (!selected || t.id === selected) &&
      (!query || t.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
  );
  const eligible = groups.flatMap((theme) => (byId.has(theme.id) ? [byId.get(theme.id)!] : []));
  const pageCount = Math.max(1, Math.ceil(eligible.length / 12));
  const currentPage = Math.min(page, pageCount - 1);
  const visiblePoints = eligible.slice(currentPage * 12, currentPage * 12 + 12);
  return (
    <section className="theme-explorer" aria-label="테마 탐색">
      <div className="theme-heading">
        <div>
          <h2>테마 흐름</h2>
          <small>구성 코인 중앙값</small>
        </div>
        {selected && <button onClick={() => onSelect(null)}>전체 테마</button>}
      </div>
      {failed ? (
        <p role="alert">
          테마 흐름을 열지 못했습니다.{' '}
          <button
            onClick={() => {
              catalog.reload();
              matrix.reload();
            }}
          >
            다시 시도
          </button>
        </p>
      ) : !matrix.data || !catalog.data ? (
        <p role="status">불러오는 중…</p>
      ) : eligible.length ? (
        <>
          <ThemeMap points={visiblePoints} domain={points} selected={selected} select={onSelect} />
          {pageCount > 1 && (
            <nav className="theme-map-pages" aria-label="매트릭스 테마 탐색">
              <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
                이전
              </button>
              <span>
                {currentPage + 1} / {pageCount}
              </span>
              <button
                disabled={currentPage === pageCount - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                다음
              </button>
            </nav>
          )}
        </>
      ) : groups.length ? (
        <p>테마 흐름을 표시할 수 없습니다.</p>
      ) : null}
      <label className="theme-search">
        <span className="sr-only">테마 검색</span>
        <input
          type="search"
          placeholder="밈, AI, RWA…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {catalog.data && (
        <div className="theme-list">
          {groups.map((theme) => {
            const point = byId.get(theme.id);
            return (
              <section key={theme.id} className="theme-row">
                <button
                  className="theme-select"
                  aria-pressed={selected === theme.id}
                  onClick={() => onSelect(selected === theme.id ? null : theme.id)}
                >
                  <strong>{theme.title}</strong>
                  {point && <span className="theme-count">{point.usableMembers}종목</span>}
                  {point && (
                    <span className={'theme-state ' + point.status}>{labels[point.status]}</span>
                  )}
                  {point && (
                    <span className="theme-summary">
                      <b className={point.x >= 0 ? 'up' : 'down'}>{change(point.x)}</b>
                      <span>{numeric(point.y)}×</span>
                    </span>
                  )}
                </button>
                {selected === theme.id && (
                  <ul className="theme-members">
                    {theme.members.map(({ asset }) => {
                      const coin = matrixReady
                        ? matrix.data!.points.find((p) => p.asset === asset)
                        : undefined;
                      return (
                        <li key={asset}>
                          <Link to={href(asset)}>
                            <AssetLogo asset={asset} size={24} />
                            <span>
                              {ASSETS.find((a) => a.id === asset)?.name}
                              <small>
                                {asset}
                                {!supportsMarket(asset, market) &&
                                  (availableMarket(asset, market) === 'binance'
                                    ? ' · Binance USDT'
                                    : ' · Upbit KRW')}
                              </small>
                            </span>
                          </Link>
                          {coin && (
                            <span className="theme-member-change">{change(coin.return7d)}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
          {!groups.length && <p>일치하는 테마가 없습니다.</p>}
        </div>
      )}
    </section>
  );
}

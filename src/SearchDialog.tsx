import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { Asset } from '../shared/types';
import type { SearchHit } from '../shared/search';
import { availableMarket, supportsMarket, referenceAssets } from '../shared/asset-registry';
import { ASSETS } from '../shared/catalog';
import { defaultAnalysisUrl } from '../shared/default-analysis';
import { DeskDialog } from './DeskDialog';
import { AssetLogo } from './AssetLogo';
import './search-dialog.css';

export default function SearchDialog({
  open,
  close,
  asset,
  initialQuery,
  trigger,
}: {
  open: boolean;
  close: () => void;
  asset: Asset;
  initialQuery: string;
  trigger: React.RefObject<HTMLElement | null>;
}) {
  const location = useLocation(),
    input = useRef<HTMLInputElement>(null),
    enterQuery = useRef<string | null>(null),
    scrollPosition = useRef({ x: window.scrollX, y: window.scrollY, href: window.location.href });
  const [query, setQuery] = useState(initialQuery),
    [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ query: string; hits: SearchHit[]; error?: string }>();
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    }
  }, [open, initialQuery]);
  useEffect(() => {
    if (!open || !query.trim()) {
      setLoading(false);
      return;
    }
    const controller = new AbortController(),
      typed = query.trim();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(
          '/api/v1/search?' + new URLSearchParams({ q: typed, asset, limit: '20' }),
          { signal: controller.signal },
        );
        if (!r.ok) throw new Error('검색을 불러오지 못했습니다.');
        const body = (await r.json()) as { hits: SearchHit[] };
        if (!controller.signal.aborted) setResult({ query: typed, hits: body.hits });
      } catch (e) {
        if (!controller.signal.aborted)
          setResult({
            query: typed,
            hits: [],
            error: e instanceof Error ? e.message : '검색 실패',
          });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, asset, retry]);
  const hits = result?.query === query.trim() ? result.hits : [];
  useEffect(() => {
    if (
      enterQuery.current &&
      enterQuery.current === query.trim() &&
      !loading &&
      result?.query === query.trim() &&
      result.hits[0] &&
      document.activeElement === input.current
    ) {
      enterQuery.current = null;
      document.querySelector<HTMLAnchorElement>('.search-hit')?.click();
    }
  }, [result, loading, query]);
  function destination(hit: SearchHit) {
    const next = new URL(hit.href, window.location.origin),
      previous = new URLSearchParams(location.search);
    // Support is resolved server-side; preserve explicit viewing settings, never an unrelated asset.
    for (const k of ['period', 'chart_from', 'chart_to', 'compare_price', 'benchmark_asset'])
      if (previous.has(k)) next.searchParams.set(k, previous.get(k)!);
    const moduleSource = previous.get('price_source') ?? previous.get('market');
    if (moduleSource && !['view:btc_rainbow', 'view:powerlaw'].includes(hit.metric ?? '')) {
      // The chart route validates source availability for the selected asset.
      const basis =
        moduleSource === 'reference' && referenceAssets.includes(hit.asset)
          ? 'reference'
          : availableMarket(hit.asset, moduleSource === 'upbit' ? 'upbit' : 'binance');
      next.searchParams.set('price_source', basis);
      if (basis !== 'reference' && supportsMarket(hit.asset, basis))
        next.searchParams.set('market', basis);
    }
    return next.pathname + next.search;
  }
  return (
    <DeskDialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          const position = scrollPosition.current;
          close();
          requestAnimationFrame(() => {
            if (window.location.href === position.href) window.scrollTo(position.x, position.y);
          });
        }
      }}
      title="코인·지표 검색"
      sheet
      returnFocus={trigger}
    >
      <div
        className="search-dialog-content"
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
            const nodes = [
              ...e.currentTarget.querySelectorAll<HTMLElement>('input,.search-hit,button'),
            ];
            const i = nodes.indexOf(document.activeElement as HTMLElement);
            nodes[(i + (e.key === 'ArrowDown' ? 1 : nodes.length - 1)) % nodes.length]?.focus();
            e.preventDefault();
          }
          if (e.key === 'Enter' && e.target === input.current && loading)
            enterQuery.current = query.trim();
          if (e.key === 'Enter' && e.target === input.current && !loading && hits[0]) {
            e.preventDefault();
            e.currentTarget.querySelector<HTMLAnchorElement>('.search-hit')?.click();
          }
        }}
      >
        <input
          ref={input}
          type="search"
          maxLength={100}
          aria-label="코인·지표 검색"
          placeholder="예: 비트코인 고평가, 펭귄 추세"
          value={query}
          onChange={(e) => {
            enterQuery.current = null;
            setQuery(e.target.value);
          }}
        />
        {location.pathname === '/' && hits.some((hit) => hit.kind === 'asset') && (
          <Link
            className="search-filter-link"
            to={
              '/?' +
              new URLSearchParams({
                ...Object.fromEntries(new URLSearchParams(location.search)),
                q: query.trim(),
              })
            }
            onClick={close}
          >
            목록에서 보기
          </Link>
        )}
        <div
          className="search-hits"
          id="product-search-results"
          aria-live="polite"
          aria-busy={loading}
        >
          {!query.trim() ? (
            ASSETS.slice(0, 6).map((a) => (
              <Link
                className="search-hit"
                key={a.id}
                to={defaultAnalysisUrl(a.id, 'upbit')}
                onClick={close}
              >
                <AssetLogo asset={a.id} size={24} />
                <span>{a.name}</span>
                <small>{a.id}</small>
              </Link>
            ))
          ) : loading ? (
            <p role="status">검색 중…</p>
          ) : result?.error && result.query === query.trim() ? (
            <p role="alert">
              {result.error} <button onClick={() => setRetry((v) => v + 1)}>다시 시도</button>
            </p>
          ) : hits.length ? (
            hits.map((h) => (
              <Link className="search-hit" key={h.id} to={destination(h)} onClick={close}>
                <AssetLogo asset={h.asset} size={24} />
                <span>
                  <b>{h.title}</b>
                  <small>{h.reason}</small>
                </span>
                <small>{h.asset}</small>
              </Link>
            ))
          ) : (
            <p role="status">일치하는 코인이나 지표가 없습니다.</p>
          )}
        </div>
      </div>
    </DeskDialog>
  );
}

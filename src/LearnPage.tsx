import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Search, Star, X } from 'lucide-react';
import {
  GUIDE_CATEGORIES,
  GUIDE_PRESETS,
  guideArticle,
  guideChartLink,
  guideContext,
  guideHref,
  searchGuides,
  type GuideArticle,
} from '../shared/learning-catalog';
import { GuideReadingBody } from './IndicatorReading';
import { guideReading, readingLesson } from '../shared/guide-reading';
import { trendFilter } from '../shared/candle-patterns';
import { ASSETS } from '../shared/catalog';
import { validPriceBasis } from '../shared/indicator-catalog';
import { networkMetric } from '../shared/network-catalog';
import { priceBasis, basisName, type PriceBasis } from '../shared/analysis-workspace';
import { AssetLogo } from './AssetLogo';
import { saved, save } from './lib';
import { useData } from './hooks';
import type { Asset } from '../shared/types';
import './learn.css';
const PRIMARY_ASSETS = ASSETS.map((a) => a.id);

function ApplyGuide({
  article,
  asset,
  basis,
  params,
  change,
}: {
  article: GuideArticle;
  asset: Asset;
  basis: PriceBasis;
  params: URLSearchParams;
  change: (patch: Record<string, string | null>) => void;
}) {
  const permitted = article.assets.filter((a) => PRIMARY_ASSETS.includes(a));
  const supported = article.assets.includes(asset);
  const useAsset = supported ? asset : permitted[0];
  const catalogUrl =
    article.action.kind !== 'panel'
      ? null
      : article.action.id.startsWith('net:')
        ? `/api/v1/network-catalog?asset=${useAsset}`
        : article.action.id.startsWith('btc:')
          ? '/api/v1/metrics?asset=BTC'
          : null;
  const catalog = useData<{ data: { id: string; observations?: number }[] }>(catalogUrl);
  const sources = article.basis?.includes(basis) || !article.basis ? [basis] : article.basis;
  const metric = article.action.kind === 'panel' ? article.action.id.slice(4) : '';
  const unavailable =
    catalogUrl &&
    catalog.data &&
    !catalog.data.data.some((m) => m.id === metric && (m.observations ?? 0) > 0);
  return (
    <div className="guide-apply" aria-label="이 기능 사용하기">
      <div className="learn-controls">
        <label>
          코인
          <select
            aria-label="사전 코인"
            value={asset}
            onChange={(e) => change({ asset: e.target.value })}
          >
            {PRIMARY_ASSETS.map((a) => (
              <option key={a} value={a}>
                {ASSETS.find((x) => x.id === a)?.name} · {a}
              </option>
            ))}
          </select>
        </label>
        <label>
          가격 기준
          <select
            aria-label="사전 가격 기준"
            value={basis}
            onChange={(e) => change({ price_source: e.target.value })}
          >
            {(['reference', 'upbit', 'binance'] as const).map((b) => (
              <option key={b} value={b}>
                {basisName(b)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {article.action.kind === 'pattern' && (
        <div className="guide-trend">
          <label>
            추세 확인
            <select
              aria-label="사전 패턴 추세 필터"
              value={trendFilter(params.get('pattern_trend'))}
              onChange={(e) => change({ pattern_trend: e.target.value })}
            >
              <option value="sma50">이전 종가와 SMA 50</option>
              <option value="sma50-200">이전 종가 · SMA 50 · SMA 200</option>
              <option value="none">추세 없이 형태만</option>
            </select>
          </label>
        </div>
      )}
      <div className="guide-context">
        <AssetLogo asset={useAsset} size={25} />
        <strong>{useAsset}</strong>
        {article.unit && <span>{article.unit}</span>}
      </div>
      {!supported && <p>{asset}에는 제공하지 않습니다. 지원 코인으로 열 수 있습니다.</p>}
      {article.basis && !article.basis.includes(basis) && (
        <p>이 가격 기준에는 표시할 수 없습니다. 다른 가격 기준을 선택해 주세요.</p>
      )}
      {catalog.error ? (
        <p role="alert">지표를 확인하지 못했습니다. 다시 열어 주세요.</p>
      ) : catalogUrl && catalog.loading ? (
        <p role="status">불러오는 중…</p>
      ) : unavailable ? (
        <p role="status">이 지표를 표시할 수 없습니다. 다른 지표를 선택해 주세요.</p>
      ) : (
        sources.map((source) => {
          const to = guideChartLink(article, useAsset, source, params);
          return (
            to && (
              <Link className="guide-primary" key={source} to={to}>
                {useAsset} · {basisName(source)}에서 열기 <ArrowUpRight size={17} />
              </Link>
            )
          );
        })
      )}
    </div>
  );
}
function OptionalApply(props: Parameters<typeof ApplyGuide>[0]) {
  const [open, setOpen] = useState(false);
  const action = props.article.action;
  if (action.kind === 'link' && action.path === '/status') return null;
  const destination =
    action.kind === 'link'
      ? {
          '/workspace': '내 작업공간 열기',
          '/workspace/library': '개인 자료함 열기',
          '/status': '데이터 상태 보기',
        }[action.path]
      : undefined;
  if (action.kind === 'link' && destination) {
    return (
      <footer className="guide-use">
        <Link className="guide-primary" to={action.path}>
          {destination} <ArrowUpRight size={17} />
        </Link>
      </footer>
    );
  }
  return (
    <details className="guide-use" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>설명을 읽었다면, 차트에서 확인하기</summary>
      {open && <ApplyGuide {...props} />}
    </details>
  );
}
export function LearnPage() {
  const { id } = useParams();
  const { hash } = useLocation();
  const heading = useRef<HTMLDivElement>(null);
  const previousId = useRef(id);
  const [params, setParams] = useSearchParams();
  const asset = PRIMARY_ASSETS.includes(params.get('asset') as Asset)
    ? (params.get('asset') as Asset)
    : 'BTC';
  const basis = validPriceBasis(
      asset,
      params.get('price_source') || params.get('market'),
    ) as PriceBasis,
    query = (params.get('q') ?? '').slice(0, 200),
    category = params.get('category') ?? '전체';
  const onlySaved = params.get('saved') === '1';
  const [favorites, setFavorites] = useState<string[]>(() => {
    const v = saved<unknown>('guide-favorites', []);
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string' && !!guideArticle(x))
      : [];
  });
  const article = useMemo(() => {
    const original = guideArticle(id ?? '');
    const definition = id === 'net-hashrate' ? networkMetric(asset, 'hashrate') : undefined;
    return original && definition
      ? { ...original, unit: definition.unit, formula: definition.formula }
      : original;
  }, [id, asset]);
  const lesson = useMemo(() => (article ? readingLesson(article, asset) : null), [article, asset]);
  const results = useMemo(
    () =>
      searchGuides(query).filter(
        (g) =>
          (category === '전체' || g.category === category) &&
          (!onlySaved || favorites.includes(g.id)),
      ),
    [query, category, onlySaved, favorites],
  );
  function change(patch: Record<string, string | null>, replace = false) {
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if ('asset' in patch || 'price_source' in patch) {
          const origin = guideContext(p);
          for (const key of ['guide_context_asset', 'guide_context_source']) {
            const value = origin.get(key);
            if (value) n.set(key, value);
          }
        }
        for (const [k, v] of Object.entries(patch)) v === null ? n.delete(k) : n.set(k, v);
        return n;
      },
      { replace },
    );
  }
  function favorite(key: string) {
    const next = favorites.includes(key) ? favorites.filter((x) => x !== key) : [...favorites, key];
    setFavorites(next);
    save('guide-favorites', next);
  }
  useEffect(() => {
    document.title = (article?.title ?? '분석 사전') + ' | 보리차트';
    const sectionId = hash.slice(1);
    const section = ['meaning', 'method', 'example', 'data', 'limits'].includes(sectionId)
      ? heading.current?.querySelector<HTMLElement>(`#${sectionId}`)
      : null;
    const changedArticle = previousId.current !== id;
    previousId.current = id;
    if (!section && !changedArticle) return;
    // Native popstate restoration finishes after the event's React commit.
    // Restore the reading destination together on the following frame.
    const frame = requestAnimationFrame(() => {
      if (section) {
        const details = section.querySelector('details');
        if (details) details.open = true;
        section.scrollIntoView({ block: 'start', behavior: 'instant' });
        section.focus({ preventScroll: true });
      } else {
        heading.current?.scrollIntoView({ block: 'start' });
        heading.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [article, id, hash]);
  return (
    <div className="learn-page" ref={heading}>
      <header className="learn-heading">
        <div>
          {id && (
            <Link to={guideHref(undefined, params)} className="guide-back">
              <ArrowLeft size={15} /> 사전 목록
            </Link>
          )}
          {!id && (
            <>
              <h1 tabIndex={-1} data-route-focus>
                분석 사전
              </h1>
            </>
          )}
        </div>
      </header>
      {id ? (
        article && lesson ? (
          <div className="guide-layout" key={article.id}>
            <nav className="guide-toc" aria-label="이 설명의 목차">
              <strong>이 설명에서</strong>
              <a href="#meaning">무엇을 보나요</a>
              <a href="#example">{lesson.procedural ? '사용 예시' : '숫자로 읽어보기'}</a>
              <a href="#method">{lesson.procedural ? '사용 방법' : '계산식·조건'}</a>
              <a href="#limits">해석할 때 주의할 점</a>
            </nav>
            <article className="guide-article">
              <div className="guide-kicker">
                {article.category}
                {article.advanced ? ' · 상세 분석' : ''}
              </div>
              <div className="guide-title">
                <h1 tabIndex={-1} data-route-focus>
                  {article.title}
                </h1>
                <button
                  aria-label="이 설명 즐겨찾기"
                  aria-pressed={favorites.includes(id)}
                  onClick={() => favorite(id)}
                >
                  <Star size={19} fill={favorites.includes(id) ? 'currentColor' : 'none'} />
                </button>
              </div>
              {article.english && <p className="guide-english">{article.english}</p>}
              {!article.assets.includes(asset) && (
                <p className="guide-asset-note">
                  이 설명의 차트는 {article.assets.length === 1 ? article.assets[0] : '지원 코인'}
                  에서 사용할 수 있습니다. 현재 선택한 {asset}에는 적용되지 않습니다.
                </p>
              )}
              <GuideReadingBody article={article} asset={asset} anchors />
              <section className="guide-related" aria-label="이어 읽기">
                <h2>이어 읽기</h2>
                {article.related.map((key) => {
                  const g = guideArticle(key);
                  return (
                    g && (
                      <Link className="guide-related-link" key={key} to={guideHref(key, params)}>
                        {g.title}
                        <ArrowRight size={16} />
                      </Link>
                    )
                  );
                })}
                <Link className="guide-related-link" to={guideHref(undefined, params)}>
                  사전 목록으로
                  <ArrowRight size={16} />
                </Link>
              </section>
              <OptionalApply
                article={article}
                asset={asset}
                basis={basis}
                params={params}
                change={change}
              />
            </article>
          </div>
        ) : (
          <div className="empty-state">
            <h1>설명을 찾지 못했습니다.</h1>
            <Link to="/learn">분석 사전에서 찾기</Link>
          </div>
        )
      ) : (
        <>
          <form className="learn-search" role="search" onSubmit={(e) => e.preventDefault()}>
            <Search size={20} />
            <input
              type="search"
              aria-label="분석 사전 검색"
              placeholder="가격 위치 밴드, 이동평균, MVRV, 펀딩률…"
              value={query}
              onChange={(e) => change({ q: e.target.value || null }, true)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') change({ q: null });
              }}
            />
            {query && (
              <button
                type="button"
                aria-label="사전 검색 지우기"
                onClick={() => change({ q: null })}
              >
                <X size={18} />
              </button>
            )}
          </form>
          {!query && !onlySaved && category === '전체' && (
            <section className="learn-presets" aria-label="목적별 시작">
              <h2>여기부터 읽어보세요</h2>
              <div>
                {GUIDE_PRESETS.map((p) => {
                  return (
                    <Link key={p.id} to={guideHref(p.guide, params)}>
                      <strong>{p.title}</strong>
                      <span>
                        {p.description}
                        <ArrowRight size={15} />
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
          <div className="learn-filters" role="group" aria-label="사전 분류">
            {['전체', ...GUIDE_CATEGORIES].map((c) => (
              <button
                key={c}
                aria-pressed={category === c}
                onClick={() => change({ category: c === '전체' ? null : c })}
              >
                {c}
              </button>
            ))}
            <button
              aria-pressed={onlySaved}
              onClick={() => change({ saved: onlySaved ? null : '1' })}
            >
              <Star size={14} />
              즐겨찾기
            </button>
          </div>
          <div className="learn-result-heading">
            <span role="status">{results.length}개 설명</span>
            <small>뜻 · 계산식 · 예시</small>
          </div>
          <div className="learn-list">
            {GUIDE_CATEGORIES.map((group) => {
              const members = results.filter((g) => g.category === group);
              return (
                members.length > 0 && (
                  <section className="learn-group" key={group} aria-label={group + ' 설명'}>
                    <h2>{group}</h2>
                    {members.map((g) => (
                      <div className="learn-row" key={g.id}>
                        <Link to={guideHref(g.id, params)}>
                          <span className="learn-row-main">
                            <strong>{g.title}</strong>
                            <span>{guideReading(g.id).meaning}</span>
                          </span>
                          <span className="learn-row-meta">
                            <small>
                              {g.assets.includes(asset)
                                ? `${asset}에 적용 가능`
                                : `${asset} 미지원`}
                            </small>
                          </span>
                          <ArrowRight size={16} />
                        </Link>
                        <button
                          aria-label={g.title + ' 즐겨찾기'}
                          aria-pressed={favorites.includes(g.id)}
                          onClick={() => favorite(g.id)}
                        >
                          <Star
                            size={16}
                            fill={favorites.includes(g.id) ? 'currentColor' : 'none'}
                          />
                        </button>
                      </div>
                    ))}
                  </section>
                )
              );
            })}
          </div>
          {!results.length && (
            <div className="empty-state">
              <BookOpen size={28} />
              <p>
                {onlySaved
                  ? '저장한 설명이 없습니다. 별표로 자주 보는 설명을 모으세요.'
                  : '검색 결과가 없습니다. 다른 이름을 쓰거나 분류를 초기화해 보세요.'}
              </p>
              <button onClick={() => change({ q: null, category: null, saved: null })}>
                전체 설명 보기
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

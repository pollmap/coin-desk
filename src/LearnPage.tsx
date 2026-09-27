import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, BookOpen, Search, Star, X } from 'lucide-react';
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
import { PATTERNS, trendFilter } from '../shared/candle-patterns';
import { ASSETS, PRIMARY_ASSETS } from '../shared/catalog';
import { priceBasis, basisName, type PriceBasis } from '../shared/analysis-workspace';
import { AssetLogo } from './AssetLogo';
import { saved, save } from './lib';
import { useData } from './hooks';
import type { Asset } from '../shared/types';
import './learn.css';

export function PatternExample({ id }: { id: string }) {
  const p = PATTERNS.find((p) => p.id === id);
  if (!p) return null;
  return (
    <figure className="pattern-example">
      <svg
        viewBox="0 0 360 180"
        role="img"
        aria-label={p.title + ' 설명용 캔들 모양. 실제 가격 자료가 아닙니다.'}
      >
        <line x1="24" x2="336" y1="151" y2="151" stroke="var(--border)" />
        {p.demo.map((c, i) => {
          const x = p.demo.length === 1 ? 170 : 115 + i * 115,
            y = (v: number) => 151 - v * 1.3;
          const color = c.close >= c.open ? '#2f9b83' : '#c36076';
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth="3" />
              <rect
                x={x - 22}
                y={y(Math.max(c.open, c.close))}
                width="44"
                height={Math.max(3, Math.abs(c.close - c.open) * 1.3)}
                fill={color}
                rx="2"
              />
              <text x={x} y="174" textAnchor="middle" fill="currentColor">
                {p.demo.length === 1 ? '확정 봉' : i === 0 ? '앞 봉' : '현재 확정 봉'}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption>설명용 예시 · 실제 시세가 아닙니다</figcaption>
    </figure>
  );
}
function ApplyGuide({
  article,
  asset,
  basis,
  params,
}: {
  article: GuideArticle;
  asset: Asset;
  basis: PriceBasis;
  params: URLSearchParams;
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
    <aside className="guide-apply" aria-label="이 기능 사용하기">
      <h2>내 차트에 적용</h2>
      <div className="guide-context">
        <AssetLogo asset={useAsset} size={25} />
        <strong>{useAsset}</strong>
        <span>{article.unit ?? '선택 원천의 단위'}</span>
      </div>
      {!supported && <p>{asset}에는 제공하지 않습니다. 지원 코인으로 열 수 있습니다.</p>}
      {article.basis && !article.basis.includes(basis) && (
        <p>{basisName(basis)}에는 필요한 데이터가 없습니다. 사용할 원천을 선택하세요.</p>
      )}
      {catalogUrl && catalog.loading ? (
        <p role="status">실제 관측 범위를 확인하고 있습니다…</p>
      ) : unavailable ? (
        <p role="status">
          이 코인의 실제 관측이 아직 없습니다. <Link to="/status">데이터 상태</Link>
        </p>
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
      {catalog.error && (
        <small role="status">
          지원 범위를 확인하지 못했습니다. 차트에서 수집 상태를 확인할 수 있습니다.
        </small>
      )}
      <small>코인·원천·날짜 범위를 이어서 엽니다.</small>
      {article.related.length > 0 && (
        <>
          <h3>함께 보기</h3>
          {article.related.map((id) => {
            const g = guideArticle(id);
            return (
              g && (
                <Link className="guide-related-link" key={id} to={guideHref(id, params)}>
                  {g.title} <ArrowUpRight size={14} />
                </Link>
              )
            );
          })}
        </>
      )}
    </aside>
  );
}
export function LearnPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const asset = PRIMARY_ASSETS.includes(params.get('asset') as Asset)
    ? (params.get('asset') as Asset)
    : 'BTC';
  const basis = priceBasis(params),
    query = (params.get('q') ?? '').slice(0, 200),
    category = params.get('category') ?? '전체';
  const onlySaved = params.get('saved') === '1';
  const [favorites, setFavorites] = useState<string[]>(() => {
    const v = saved<unknown>('guide-favorites', []);
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string' && !!guideArticle(x))
      : [];
  });
  const [detail, setDetail] = useState(
    () => saved<string>('guide-reading-mode', 'summary') === 'detail',
  );
  const article = guideArticle(id ?? '');
  const patternId = article?.action.kind === 'pattern' ? article.action.id : undefined;
  const patternDefinition = PATTERNS.find((p) => p.id === patternId);
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
    document.title = (article?.title ?? '분석 사전') + ' | Coin Desk';
  }, [article]);
  return (
    <div className="learn-page">
      <header className="learn-heading">
        <div>
          {id && (
            <Link to={guideHref(undefined, params)} className="guide-back">
              <ArrowLeft size={15} /> 사전 목록
            </Link>
          )}
          <h1>{id ? '분석 가이드' : '분석 사전'}</h1>
          {!id && <p>알고 싶은 것을 찾고, 내 코인 차트에서 바로 확인하세요.</p>}
        </div>
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
      </header>
      {id ? (
        article ? (
          <div className="guide-layout">
            <article className="guide-article">
              <div className="guide-kicker">
                {article.category}
                {article.advanced ? ' · 상세 분석' : ''}
              </div>
              <div className="guide-title">
                <h2>{article.title}</h2>
                <button
                  aria-label="이 설명 즐겨찾기"
                  aria-pressed={favorites.includes(id)}
                  onClick={() => favorite(id)}
                >
                  <Star size={19} fill={favorites.includes(id) ? 'currentColor' : 'none'} />
                </button>
              </div>
              {article.english && <p className="guide-english">{article.english}</p>}
              <p className="guide-intro">{article.summary}</p>
              <div className="guide-mode" role="group" aria-label="설명 깊이">
                {[false, true].map((value) => (
                  <button
                    key={String(value)}
                    aria-pressed={detail === value}
                    onClick={() => {
                      setDetail(value);
                      save('guide-reading-mode', value ? 'detail' : 'summary');
                    }}
                  >
                    {value ? '산식까지 자세히' : '핵심만 보기'}
                  </button>
                ))}
              </div>
              {article.action.kind === 'pattern' && <PatternExample id={article.action.id} />}
              <section>
                <h3>어떻게 읽나요?</h3>
                <p>{article.read}</p>
              </section>
              <section>
                <h3>차트에서 해보기</h3>
                <ol>
                  {article.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </section>
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
                  <small>
                    현재 봉 직전까지의 확정 종가로 추세를 확인합니다. 중립 도지형에는 적용하지
                    않습니다.
                  </small>
                </div>
              )}
              <details open={detail || undefined} className="guide-method">
                <summary>산식·판정 조건</summary>
                {article.action.kind !== 'pattern' && <p>{article.formula}</p>}
                {article.action.kind === 'pattern' && (
                  <>
                    <ul>
                      {patternDefinition?.rules.map((rule) => (
                        <li key={rule}>{rule}</li>
                      ))}
                    </ul>
                    <p>
                      추세 필터: 상승형은 이전 종가 &lt; SMA50, 하락형은 이전 종가 &gt; SMA50. 강화
                      필터는 SMA50 &lt; SMA200 또는 그 반대 조건을 추가합니다. 관측
                      누락·미확정·잘못된 봉 이후에는 연속 표본을 다시 쌓습니다.
                    </p>
                  </>
                )}
              </details>
              <section className="guide-caution">
                <h3>해석할 때 확인할 점</h3>
                <p>{article.caution}</p>
              </section>
              {article.source && (
                <a className="guide-source" href={article.source} target="_blank" rel="noreferrer">
                  정의·참고 원문 <ArrowUpRight size={14} />
                </a>
              )}
            </article>
            <ApplyGuide article={article} asset={asset} basis={basis} params={params} />
          </div>
        ) : (
          <div className="empty-state">
            <h2>설명을 찾지 못했습니다.</h2>
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
              placeholder="RSI, 장악형, 미결제약정, 추세선…"
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
              <h2>무엇을 확인하고 싶으세요?</h2>
              <div>
                {GUIDE_PRESETS.map((p) => {
                  const n = guideContext(params);
                  n.set('guide', p.guide);
                  if ('visual' in p) n.set('visual', p.visual);
                  if ('panels' in p) n.set('panels', p.panels);
                  const a = p.id === 'onchain' ? 'BTC' : asset;
                  n.set('asset', a);
                  return (
                    <Link key={p.id} to={('section' in p ? `/${p.section}/${a}` : '/') + '?' + n}>
                      <strong>{p.title}</strong>
                      <span>
                        {p.description}
                        <ArrowUpRight size={15} />
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
            <small>{asset} 지원 여부와 적용할 원천을 함께 표시합니다.</small>
          </div>
          <div className="learn-list">
            {results.map((g) => (
              <div className="learn-row" key={g.id}>
                <Link to={guideHref(g.id, params)}>
                  <span className="learn-row-main">
                    <strong>{g.title}</strong>
                    <span>{g.summary}</span>
                  </span>
                  <span className="learn-row-meta">
                    <span>{g.category}</span>
                    <small>
                      {g.assets.includes(asset)
                        ? `${asset} 지원`
                        : g.assets.filter((a) => PRIMARY_ASSETS.includes(a)).join(' · ') + ' 지원'}
                      {g.basis
                        ? ' · ' +
                          g.basis
                            .map((b) => (b === 'reference' ? 'USD' : '거래소'))
                            .filter((v, i, a) => a.indexOf(v) === i)
                            .join('/')
                        : ' '}
                    </small>
                  </span>
                  <ArrowUpRight size={16} />
                </Link>
                <button
                  aria-label={g.title + ' 즐겨찾기'}
                  aria-pressed={favorites.includes(g.id)}
                  onClick={() => favorite(g.id)}
                >
                  <Star size={16} fill={favorites.includes(g.id) ? 'currentColor' : 'none'} />
                </button>
              </div>
            ))}
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
          <p className="learn-footnote">
            설명과 적용 기준은 Coin Desk의 현재 지원 기능을 따릅니다.
          </p>
        </>
      )}
    </div>
  );
}

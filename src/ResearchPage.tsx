import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Star, ArrowUpRight } from 'lucide-react';
import { ASSETS, isPrimaryAsset } from '../shared/catalog';
import { RESEARCH_AUTHORS, RESEARCH_LIST_URL, authorSearch } from '../shared/research';
import { PUBLIC_SOURCES, type PublicResearchFeed } from '../shared/public-research';
import { AssetHeader } from './AssetHeader';
import type { Asset } from '../shared/types';
import { useData } from './hooks';
import { saved, save, dateLabel } from './lib';

export function ResearchPage() {
  const [params, setParams] = useSearchParams();
  const asset = ASSETS.find((a) => a.id === params.get('asset'))?.id || 'all';
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'all' | 'x' | 'video' | 'official' | 'authors'>('all');
  const [onlyStars, setOnlyStars] = useState(false);
  const [stars, setStars] = useState<string[]>(() =>
    saved('research-stars', ['cantonmeow', 'DanCoinInvestor', 'Cryptollica', 'CW8900']),
  );
  const result = useData<PublicResearchFeed>('/api/v1/research/public', false, 300000);
  const needle = query.trim().replace(/^@/, '').toLowerCase();
  const authors = RESEARCH_AUTHORS.filter(
    (a) =>
      (a.name + ' ' + a.handle).toLowerCase().includes(needle) &&
      (!onlyStars || stars.includes(a.handle)),
  );
  const posts = (result.data?.posts || []).filter((p) => {
    const source = PUBLIC_SOURCES.find((s) => s.id === p.source);
    return (
      (asset === 'all'
        ? !p.assets.length || p.assets.some(isPrimaryAsset)
        : p.assets.includes(asset as Asset)) &&
      (view === 'all' || view === 'authors' || p.kind === view) &&
      (!onlyStars || (source?.handle && stars.includes(source.handle))) &&
      (!needle ||
        (p.title + ' ' + source?.name + ' ' + source?.handle).toLowerCase().includes(needle))
    );
  });
  return (
    <div className="research-page">
      {asset !== 'all' ? (
        <AssetHeader
          asset={asset}
          current="research"
          subtitle="공식 소식 · 분석가 · 영상"
          href={(a) => '/research?asset=' + a}
        />
      ) : (
        <div className="page-heading">
          <h1>리서치 모아보기</h1>
          <a href={RESEARCH_LIST_URL} target="_blank" rel="noreferrer">
            내 X 리스트 ↗
          </a>
        </div>
      )}
      <div className="research-view-tabs" aria-label="리서치 종류">
        {(
          [
            ['all', '전체 원문'],
            ['official', '공식 소식'],
            ['x', '분석가'],
            ['video', '영상'],
            ['authors', '관심 계정'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="research-toolbar">
        <label>
          리서치 검색
          <input
            type="search"
            placeholder="코인, 제목, CW, @cantonmeow…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          찾아볼 코인
          <select
            value={asset}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value === 'all') next.delete('asset');
              else next.set('asset', e.target.value);
              setParams(next, { replace: true });
            }}
          >
            <option value="all">BTC · DOGE · ETH + 시장</option>
            {ASSETS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.id}
              </option>
            ))}
          </select>
        </label>
        <button
          className="desk-button"
          aria-pressed={onlyStars}
          onClick={() => setOnlyStars((v) => !v)}
        >
          <Star size={15} />
          즐겨찾기 {stars.length}
        </button>
      </div>
      {view !== 'authors' && (
        <section className="research-feed" aria-label="수집한 원문">
          <div className="research-section-heading">
            <h2>최근 원문</h2>
            <span>{posts.length}개</span>
          </div>
          {result.error && (
            <p role="alert">
              리서치를 불러오지 못했습니다. <button onClick={result.reload}>다시 시도</button>
            </p>
          )}
          {posts.map((post) => {
            const source = PUBLIC_SOURCES.find((s) => s.id === post.source);
            return (
              <a
                className="research-post public-post"
                key={post.source + post.id}
                href={post.url}
                target="_blank"
                rel="noreferrer"
              >
                <span className="post-kind">
                  {post.kind === 'official' ? '공식' : post.kind === 'video' ? '영상' : 'X'}
                </span>
                <div>
                  <strong>{post.title}</strong>
                  <span>
                    {source?.name}
                    {post.kind === 'x' && post.media ? ' · 차트·미디어' : ''}
                    {post.assets.length ? ' · ' + post.assets.join(' · ') : ''}
                  </span>
                </div>
                <time>{dateLabel(post.publishedAt, true)}</time>
                <ArrowUpRight size={16} />
              </a>
            );
          })}
          {!posts.length && (
            <p className="empty-state">
              {result.loading ? '원문을 불러오는 중…' : '이 조건으로 수집된 원문이 없습니다.'}{' '}
              <button onClick={() => setView('authors')}>관심 계정에서 찾기</button>
            </p>
          )}
        </section>
      )}
      {view === 'authors' && (
        <>
          <div className="research-section-heading">
            <h2>관심 계정</h2>
            <span role="status">
              {authors.length} / {RESEARCH_AUTHORS.length}개 계정
            </span>
          </div>
          <div className="research-authors">
            {authors.map((author) => (
              <article className="research-author" key={author.handle}>
                <button
                  className={'author-star ' + (stars.includes(author.handle) ? 'active' : '')}
                  aria-label={author.name + ' 즐겨찾기'}
                  aria-pressed={stars.includes(author.handle)}
                  onClick={() =>
                    setStars((old) => {
                      const next = old.includes(author.handle)
                        ? old.filter((x) => x !== author.handle)
                        : [...old, author.handle];
                      save('research-stars', next);
                      return next;
                    })
                  }
                >
                  <Star size={17} />
                </button>
                <a
                  className="author-name"
                  href={'https://x.com/' + author.handle}
                  target="_blank"
                  rel="noreferrer"
                >
                  <strong>{author.name}</strong>
                  <span>@{author.handle}</span>
                </a>
                <div className="author-links">
                  <a href={authorSearch(author.handle, asset)} target="_blank" rel="noreferrer">
                    {asset === 'all' ? '최근 글' : asset + ' 글 찾기'} ↗
                  </a>
                  <a
                    href={'https://x.com/' + author.handle + '/media'}
                    target="_blank"
                    rel="noreferrer"
                  >
                    차트·미디어 ↗
                  </a>
                  {author.youtube && (
                    <a href={author.youtube} target="_blank" rel="noreferrer">
                      영상 ↗
                    </a>
                  )}
                  {author.website && (
                    <a href={author.website} target="_blank" rel="noreferrer">
                      웹사이트 ↗
                    </a>
                  )}
                </div>
              </article>
            ))}
            {!authors.length && (
              <p className="empty-state">검색 결과가 없습니다. 이름이나 @아이디로 찾아보세요.</p>
            )}
          </div>
        </>
      )}
      <details className="research-source">
        <summary>출처 · 수집 상태</summary>
        <p>
          공개 RSS·영상 피드와 X 프로필의 원문 링크를 서버에서 매시간 순환 수집합니다. 로그인·유료
          API 없이 공개된 글만 수집하며 차단·미제공 상태의 계정은 원문으로 연결합니다. 코인 분류는
          제목·공개 본문에 명시된 이름을 기준으로 하므로 모든 관련 글을 포함하지는 않습니다.
        </p>
        <div className="source-health-list">
          {PUBLIC_SOURCES.map((source) => {
            const state = result.data?.sources.find((s) => s.id === source.id);
            return (
              <div key={source.id}>
                <a
                  href={
                    source.kind === 'x'
                      ? source.url
                      : source.kind === 'video'
                        ? 'https://www.youtube.com/@' +
                          (source.id === 'cat-video' ? 'cantonmeow' : 'TGMTrading')
                        : source.url
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {source.name} · {source.kind}
                </a>
                <span>
                  {state?.state === 'ready'
                    ? '수집 중'
                    : state?.state === 'error'
                      ? '수집 지연'
                      : '첫 수집 대기'}
                </span>
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}

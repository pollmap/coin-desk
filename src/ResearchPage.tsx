import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Star, ArrowUpRight } from 'lucide-react';
import { ASSETS } from '../shared/catalog';
import {
  RESEARCH_AUTHORS,
  RESEARCH_LIST_URL,
  authorSearch,
  type ResearchFeed,
} from '../shared/research';
import type { Asset } from '../shared/types';
import { useData } from './hooks';
import { saved, save, dateLabel } from './lib';

export function ResearchPage() {
  const [params, setParams] = useSearchParams();
  const asset = ASSETS.find((a) => a.id === params.get('asset'))?.id || 'all';
  const [query, setQuery] = useState('');
  const [onlyStars, setOnlyStars] = useState(false);
  const [stars, setStars] = useState<string[]>(() =>
    saved('research-stars', ['cantonmeow', 'DanCoinInvestor', 'Cryptollica', 'CW8900']),
  );
  const result = useData<ResearchFeed>('/api/v1/research', false, 300000);
  const needle = query.trim().replace(/^@/, '').toLowerCase();
  const authors = RESEARCH_AUTHORS.filter(
    (a) =>
      (a.name + ' ' + a.handle).toLowerCase().includes(needle) &&
      (!onlyStars || stars.includes(a.handle)),
  );
  const posts = (result.data?.posts || []).filter(
    (p) =>
      (asset === 'all' || p.assets.includes(asset as Asset)) &&
      authors.some((a) => a.handle.toLowerCase() === p.handle.toLowerCase()),
  );
  return (
    <div className="research-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">RESEARCH DESK</div>
          <h1>리서치 모아보기</h1>
          <p>관심 있는 사람의 차트와 관점을 원문으로 확인하세요.</p>
        </div>
        <a className="desk-button" href={RESEARCH_LIST_URL} target="_blank" rel="noreferrer">
          내 X 리스트 ↗
        </a>
      </div>
      <div className="research-toolbar">
        <label>
          계정 찾기
          <input
            type="search"
            placeholder="CW, 조재우, @cantonmeow…"
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
            <option value="all">모든 코인</option>
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
      <section className="research-feed" aria-label="수집한 원문">
        <div className="research-section-heading">
          <h2>최근 원문</h2>
          <span>
            {result.data?.state === 'ready'
              ? 'X 리스트에서 수집'
              : result.loading
                ? '연결 확인 중'
                : '자동 수집 연결 대기'}
          </span>
        </div>
        {result.error ? (
          <p role="alert">
            수집 상태를 확인하지 못했습니다. 아래 계정의 원문은 바로 열 수 있습니다.{' '}
            <button onClick={result.reload}>다시 확인</button>
          </p>
        ) : result.data?.message ? (
          <p>{result.data.message}</p>
        ) : null}
        {posts.length ? (
          posts.map((post) => (
            <a
              className="research-post"
              key={post.id}
              href={post.url}
              target="_blank"
              rel="noreferrer"
            >
              <b>@{post.handle}</b>
              <span>
                {post.assets.join(' · ') || '시장 관점'}
                {post.media ? ' · 차트·미디어' : ''}
              </span>
              <time>{dateLabel(post.publishedAt, true)}</time>
              <ArrowUpRight size={16} />
            </a>
          ))
        ) : (
          <p className="muted">
            {result.data?.state === 'ready'
              ? '선택한 조건에 맞는 원문이 없습니다.'
              : '계정별 X 원문·코인 검색·공개 영상은 아래 목록에서 이용할 수 있습니다.'}
          </p>
        )}
      </section>
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
      <details className="research-source">
        <summary>목록과 원문에 대해</summary>
        <p>
          사용자가 제공한 37개 계정입니다. 인증 여부·수익률을 검증한 추천 목록은 아닙니다. 코인별
          링크는 X 검색을 열며 검색 결과와 로그인이 필요할 수 있습니다. 자동 수집은 제공된 X
          리스트의 최근 글 중 이 목록의 계정만 표시합니다. 차트·영상은 원문에서 확인하며 분석가의
          의견을 시장 수치에 섞지 않습니다.
        </p>
      </details>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, CandlestickChart, X } from 'lucide-react';
import {
  PATTERNS,
  type PatternId,
  type PatternHit,
  type TrendFilter,
} from '../shared/candle-patterns';
import { guideHref, guideArticle, guideChartLink } from '../shared/learning-catalog';
import type { Asset } from '../shared/types';
import type { PriceBasis } from '../shared/analysis-workspace';
import { basisName } from '../shared/analysis-workspace';
import { numeric } from './lib';
import './learn.css';

export function PatternPicker({
  selected,
  trend,
  asset,
  basis,
  params,
  onChange,
}: {
  selected: PatternId[];
  trend: TrendFilter;
  asset: Asset;
  basis: PriceBasis;
  params: URLSearchParams;
  onChange: (patch: Record<string, string | null>) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState(selected),
    [filter, setFilter] = useState(trend);
  const close = () => {
    ref.current?.close();
    opener.current?.focus();
  };
  return (
    <>
      <button
        ref={opener}
        onClick={() => {
          setDraft(selected);
          setFilter(trend);
          ref.current?.showModal();
        }}
      >
        <CandlestickChart size={16} />
        캔들 패턴{selected.length ? ` ${selected.length}` : ''}
      </button>
      <dialog
        ref={ref}
        className="pattern-config"
        aria-labelledby="pattern-config-title"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <header>
          <h2 id="pattern-config-title">캔들 패턴</h2>
          <button aria-label="패턴 설정 닫기" onClick={close}>
            <X size={19} />
          </button>
        </header>
        {basis === 'reference' ? (
          <div>
            <p>
              실제 시가·고가·저가·종가가 필요합니다. 거래소를 선택해 상승 장악형부터 확인하세요.
            </p>
            {(['upbit', 'binance'] as const).map((b) => (
              <Link
                className="guide-primary"
                key={b}
                to={guideChartLink(guideArticle('pattern-bullish-engulfing')!, asset, b, params)!}
                onClick={close}
              >
                {basisName(b)} 캔들로 열기
              </Link>
            ))}
          </div>
        ) : (
          <>
            <fieldset>
              <legend>관찰할 형태 · 확정 봉만 표시</legend>
              {PATTERNS.map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    checked={draft.includes(p.id)}
                    onChange={(e) =>
                      setDraft(
                        e.target.checked ? [...draft, p.id] : draft.filter((id) => id !== p.id),
                      )
                    }
                  />
                  <span>
                    {p.title}
                    <small> · {p.english}</small>
                  </span>
                  <Link
                    to={guideHref('pattern-' + p.id, params)}
                    aria-label={p.title + ' 설명'}
                    onClick={close}
                  >
                    <BookOpen size={16} />
                  </Link>
                </label>
              ))}
            </fieldset>
            <label htmlFor="pattern-trend-filter">앞선 추세</label>
            <select
              id="pattern-trend-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value as TrendFilter)}
            >
              <option value="sma50">이전 종가와 SMA 50</option>
              <option value="sma50-200">이전 종가 · SMA 50 · SMA 200</option>
              <option value="none">추세 없이 형태만</option>
            </select>
            <p>
              <small>
                마감 전 봉과 누락 구간에서는 확정하지 않습니다. 중립 도지형은 방향 필터를 쓰지
                않습니다. 추세 없이 보면 망치형·교수형처럼 같은 모양이 중복될 수 있습니다.
              </small>
            </p>
            <footer>
              <button onClick={() => setDraft([])}>선택 해제</button>
              <button
                onClick={() => {
                  onChange({ patterns: draft.join(','), pattern_trend: filter });
                  close();
                }}
              >
                차트에 적용
              </button>
            </footer>
          </>
        )}
      </dialog>
    </>
  );
}
export function PatternObservations({
  hits,
  selection,
  onSelect,
  params,
  asset,
  basis,
  loading,
}: {
  hits: PatternHit[];
  selection: string | null;
  onSelect: (id: string | null) => void;
  params: URLSearchParams;
  asset: Asset;
  basis: PriceBasis;
  loading: boolean;
}) {
  const [limit, setLimit] = useState(15);
  const selected = hits.find((h) => h.id === selection);
  useEffect(
    () => setLimit(15),
    [asset, basis, params.get('patterns'), params.get('pattern_trend'), params.get('interval')],
  );
  return (
    <section className="pattern-observations" aria-label="캔들 패턴 관찰">
      {selected && (
        <div className="pattern-detail" role="status">
          <strong>
            {selected.label} ·{' '}
            {new Date(selected.time * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC
          </strong>
          <p>
            {asset} · {basisName(basis)} · 종가 {numeric(selected.close, 8)}
            <br />
            몸통 {numeric(selected.body, 8)} / 고저 범위 {numeric(selected.range, 8)} · 위꼬리{' '}
            {numeric(selected.upper, 8)} / 아래꼬리 {numeric(selected.lower, 8)}
          </p>
          <p>
            {selected.trend === 'none' || selected.direction === 'neutral'
              ? '추세 필터 없음'
              : `직전 종가 ${numeric(selected.previousClose, 8)} · SMA50 ${numeric(selected.sma50, 8)}${selected.trend === 'sma50-200' ? ' · SMA200 ' + numeric(selected.sma200, 8) : ''}`}
          </p>
          <Link className="chart-guide-link" to={guideHref('pattern-' + selected.pattern, params)}>
            <BookOpen size={15} />
            판정 조건 보기
          </Link>
          <button onClick={() => onSelect(null)}>선택 해제</button>
        </div>
      )}
      <details open>
        <summary>
          패턴 관찰 · {loading ? '불러오는 중' : hits.length + '건'}{' '}
          <small>확정 봉 · 조건 충족 기록</small>
        </summary>
        {!hits.length ? (
          <p className="source-line" role="status">
            {loading
              ? '가격 이력에서 조건을 확인하고 있습니다…'
              : '현재 원천·봉·추세 조건에서 관찰된 패턴이 없습니다.'}
          </p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>UTC 날짜</th>
                  <th>형태</th>
                  <th>방향</th>
                </tr>
              </thead>
              <tbody>
                {hits
                  .slice(-limit)
                  .reverse()
                  .map((h) => (
                    <tr key={h.id}>
                      <td>
                        <button
                          onClick={() => onSelect(h.id)}
                          aria-label={
                            new Date(h.time * 1000).toISOString().slice(0, 16) +
                            ' ' +
                            h.label +
                            ' 차트에서 보기'
                          }
                        >
                          {new Date(h.time * 1000).toISOString().slice(0, 16).replace('T', ' ')}
                        </button>
                      </td>
                      <td>
                        <Link to={guideHref('pattern-' + h.pattern, params)}>{h.label}</Link>
                      </td>
                      <td>
                        {h.direction === 'up'
                          ? '↑ 상승형'
                          : h.direction === 'down'
                            ? '↓ 하락형'
                            : '◇ 중립형'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {hits.length > limit && (
              <button onClick={() => setLimit((n) => n + 30)}>관찰 더 보기</button>
            )}
          </>
        )}
      </details>
    </section>
  );
}

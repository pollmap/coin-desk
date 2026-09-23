import { useState } from 'react';
import { Link } from 'react-router-dom';
import { networkMetric } from '../shared/network-catalog';
import type { Asset, SeriesResponse } from '../shared/types';
import { dateLabel } from './lib';

export function NetworkInfoTabs({
  asset,
  metric,
  series,
}: {
  asset: Asset;
  metric: NonNullable<ReturnType<typeof networkMetric>>;
  series?: SeriesResponse;
}) {
  const [tab, setTab] = useState('read');
  return (
    <section className="panel metric-info-tabs">
      <div className="info-tab-buttons" aria-label="온체인 설명 선택">
        {[
          ['read', '읽는 방법'],
          ['pair', '함께 볼 지표'],
          ['source', '산식 · 출처'],
        ].map(([id, title]) => (
          <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {title}
          </button>
        ))}
      </div>
      <div className="info-tab-content">
        {tab === 'read' ? (
          <>
            <h2>{metric.title}, 어떻게 읽나요?</h2>
            <p>{metric.description}</p>
            {metric.id === 'mvrv' ? (
              <p className="metric-caveat">
                1 미만은 시장 평가가 실현 평가보다 작은 구간, 1 초과는 그 반대입니다. 1은 손익
                기준이며 과매수·과매도 경계가 아닙니다. BTC의 3.7 과열 참고값을 다른 코인이나 다른
                원천에 적용하지 않습니다.
              </p>
            ) : null}
            {metric.id === 'nupl' ? (
              <p className="metric-caveat">
                0% 아래는 순미실현 손실, 위는 순미실현 이익입니다. MVRV에서 역산했으므로 두 지표는
                독립적인 확인 신호가 아닙니다.
              </p>
            ) : null}
            {metric.derived ? (
              <p className="muted">동일 원천의 값으로 역산한 파생 지표입니다.</p>
            ) : null}
          </>
        ) : null}
        {tab === 'pair' ? (
          <>
            <h2>가격과 네트워크 활동을 함께 확인하세요</h2>
            <p>
              가격 비교선은 Coin Metrics USD 일별 참조가격입니다. 거래소 캔들과 구분하며, 두 자료가
              모두 존재하는 날짜에서 비교하세요.
            </p>
            <div className="related-links">
              <Link to={`/?asset=${asset}&period=all`}>전체 가격 이력 ↗</Link>
              <Link to={`/onchain/${asset}?metric=active_addresses&period=all`}>활성 주소 ↗</Link>
              <Link to={`/onchain/${asset}?metric=transactions&period=all`}>거래 수 ↗</Link>
            </div>
            <p className="metric-caveat">
              주소 수는 실제 사람 수와 같지 않고, 거래 증가만으로 매수 수요나 가격 상승을 확정할 수
              없습니다.
            </p>
          </>
        ) : null}
        {tab === 'source' ? (
          <>
            <h2>Coin Metrics Community</h2>
            <p className="formula">{metric.formula}</p>
            <dl className="provenance-grid">
              <div>
                <dt>원천 지표</dt>
                <dd>{metric.sourceMetric ?? '동일 원천에서 역산'}</dd>
              </div>
              <div>
                <dt>실제 관측 기간</dt>
                <dd>
                  {dateLabel(series?.data[0]?.time)} ~ {dateLabel(series?.data.at(-1)?.time)}
                </dd>
              </div>
              <div>
                <dt>수집 확인</dt>
                <dd>{dateLabel(series?.meta.fetchedAt, true)}</dd>
              </div>
              <div>
                <dt>관측 수</dt>
                <dd>{series?.data.length.toLocaleString() ?? '—'}개</dd>
              </div>
              <div>
                <dt>계산 버전</dt>
                <dd>{series?.meta.calculationVersion ?? '—'}</dd>
              </div>
            </dl>
            <div className="related-links">
              <a href={metric.source} target="_blank" rel="noreferrer">
                정의·체인별 집계 규칙 ↗
              </a>
              <a
                href="https://github.com/coinmetrics/data/blob/master/LICENSE"
                target="_blank"
                rel="noreferrer"
              >
                CC BY-NC 4.0 · 비상업 이용 ↗
              </a>
            </div>
            {asset === 'BTC' ? (
              <p>
                <Link to="/metrics/mvrv?period=all">Bitview BTC 지표와 별도로 보기 ↗</Link>
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

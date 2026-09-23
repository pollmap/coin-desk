import { useState } from 'react';
import { Link } from 'react-router-dom';
import { METRIC_GUIDES } from '../shared/metric-guides';
import { METRICS } from '../shared/catalog';
import type { Metric, SeriesResponse } from '../shared/types';
import { dateLabel } from './lib';

export function MetricInfoTabs({ metric, series }: { metric: Metric; series?: SeriesResponse }) {
  const [tab, setTab] = useState('read');
  const guide = METRIC_GUIDES[metric.id];
  return (
    <section className="panel metric-info-tabs">
      <div className="info-tab-buttons" aria-label="지표 설명 선택">
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
            <h2>{guide?.question || metric.title}</h2>
            <p>{guide?.read || metric.description}</p>
            {guide?.example && <p className="muted">{guide.example}</p>}
            <p className="metric-caveat">{guide?.caveat}</p>
          </>
        ) : null}
        {tab === 'pair' ? (
          <>
            <h2>해석을 함께 확인하세요</h2>
            <p>{guide?.pair}</p>
            <div className="related-links">
              {guide?.related.map((id) => (
                <Link key={id} to={'/metrics/' + id}>
                  {METRICS.find((m) => m.id === id)?.title} ↗
                </Link>
              ))}
            </div>
          </>
        ) : null}
        {tab === 'source' ? (
          <>
            <h2>{metric.description}</h2>
            <p className="formula">{metric.formula}</p>
            <dl className="provenance-grid">
              <div>
                <dt>관측 자료</dt>
                <dd>BTC · UTC 일별</dd>
              </div>
              <div>
                <dt>가격 비교선</dt>
                <dd>Bitview 추정 USD 가격</dd>
              </div>
              <div>
                <dt>실제 제공 기간</dt>
                <dd>
                  {dateLabel(series?.data[0]?.time)} ~ {dateLabel(series?.data.at(-1)?.time)}
                </dd>
              </div>
              <div>
                <dt>확보 관측</dt>
                <dd>{series?.data.length.toLocaleString() ?? '—'}개</dd>
              </div>
              <div>
                <dt>수집 확인</dt>
                <dd>{dateLabel(series?.meta.fetchedAt, true)}</dd>
              </div>
              <div>
                <dt>계산 버전</dt>
                <dd>{series?.meta.calculationVersion ?? '—'}</dd>
              </div>
            </dl>
            <a href={metric.source} target="_blank" rel="noreferrer">
              원천·산식 원문 ↗
            </a>
            <p className="muted">
              거래소 시세와 온체인 추정 가격은 서로 다릅니다. 출처별 가격·집단 정의 차이로 다른
              서비스의 값과 일치하지 않을 수 있습니다.
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}

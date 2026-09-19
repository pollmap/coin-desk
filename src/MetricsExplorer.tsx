import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { METRICS } from '../shared/catalog';
import { usePersonalDesk } from './PersonalDesk';

const category = (id: string) =>
  id.startsWith('sth_') || id.startsWith('lth_')
    ? '보유자'
    : id === 'nupl' || id === 'sopr_24h'
      ? '손익'
      : '밸류에이션';
const technical = [
  {
    id: 'sma200,sma200w',
    title: '장기 이동평균',
    description:
      '확정 일·주 종가의 평균과 가격 위치를 비교합니다. 설정에서 SMA 또는 EMA 기간을 직접 바꿀 수 있습니다.',
    formula: 'SMA = 최근 n개 종가 합 / n; EMA = 현재값 × 2/(n+1) + 이전 EMA × (1−2/(n+1))',
  },
  {
    id: 'rsi',
    title: 'RSI',
    description:
      '선택한 봉 간격의 상승·하락 폭을 Wilder 방식으로 평활합니다. 기본 기간 14, 0~100 범위입니다.',
    formula: '100 − 100 / (1 + 평균 상승폭 / 평균 하락폭)',
  },
  {
    id: 'bb',
    title: '볼린저밴드',
    description:
      '최근 가격의 평균과 변동 범위를 함께 봅니다. 기간과 표준편차 배수를 직접 바꿀 수 있습니다.',
    formula: 'SMA(n) ± k × 모집단 표준편차(n), 기본 n=20 / k=2',
  },
  {
    id: 'macd',
    title: 'MACD',
    description: '12·26 EMA의 차이, 그 차이의 9 EMA와 히스토그램을 함께 표시합니다.',
    formula: 'MACD = EMA12 − EMA26; 신호선 = MACD의 EMA9; 히스토그램 = MACD − 신호선',
  },
];
export function MetricsExplorer() {
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('전체'),
    [message, setMessage] = useState('');
  const { desk, update } = usePersonalDesk();
  const needle = search.trim().toLowerCase();
  const onchain = METRICS.filter(
    (m) =>
      (filter === '전체' || filter === category(m.id)) &&
      (m.title + ' ' + m.english + ' ' + m.description).toLowerCase().includes(needle),
  );
  const tech = technical.filter(
    (m) =>
      (filter === '전체' || filter === '기술지표') &&
      (m.title + ' ' + m.description).toLowerCase().includes(needle),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">METRIC LIBRARY</div>
          <h1>지표 찾아보기</h1>
          <p>궁금한 지표를 찾고 산식을 확인한 뒤 차트나 대시보드에 담으세요.</p>
        </div>
      </div>
      <div className="explorer-toolbar">
        <label>
          <span>
            <Search size={15} />
            지표 검색
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="MVRV, 손익, 이동평균…"
          />
        </label>
        <label>
          분류
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {['전체', '밸류에이션', '보유자', '손익', '기술지표'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <Link className="desk-button" to="/">
          내 대시보드 ↗
        </Link>
      </div>
      {message ? (
        <p className="desk-message" role="status">
          {message}
        </p>
      ) : null}
      <div className="metric-library">
        {onchain.map((m) => (
          <article className="panel library-card" key={m.id}>
            <span className="micro-label">BTC ON-CHAIN · {category(m.id)}</span>
            <h2>
              <i style={{ background: m.color }} />
              {m.title}
            </h2>
            <p>{m.description}</p>
            <div className="formula">
              <span>산식 · {m.unit}</span>
              {m.formula}
            </div>
            <div className="workspace-actions">
              <Link className="desk-button" to={'/metrics/' + m.id}>
                실제 차트 열기 ↗
              </Link>
              <button
                className="desk-button"
                aria-pressed={desk.cards.includes(m.id)}
                onClick={() => {
                  try {
                    update((d) => ({
                      ...d,
                      cards: d.cards.includes(m.id)
                        ? d.cards.filter((id) => id !== m.id)
                        : [...d.cards, m.id],
                    }));
                    setMessage(
                      desk.cards.includes(m.id)
                        ? '대시보드에서 뺐습니다.'
                        : '대시보드에 추가했습니다.',
                    );
                  } catch (e) {
                    setMessage(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                {desk.cards.includes(m.id) ? '담은 지표 ✓' : '대시보드에 담기 +'}
              </button>
            </div>
            <a className="library-source" href={m.source} target="_blank" rel="noreferrer">
              원천·정의 보기 ↗
            </a>
          </article>
        ))}
        {tech.map((m) => (
          <article className="panel library-card" key={m.id}>
            <span className="micro-label">8개 코인 · 기술지표</span>
            <h2>{m.title}</h2>
            <p>{m.description}</p>
            <div className="formula">{m.formula}</div>
            <Link
              className="desk-button"
              to={
                '/chart/DOGE?asset=DOGE&market=binance&interval=1d&period=1y&log=1&indicators=' +
                encodeURIComponent(m.id)
              }
            >
              DOGE 차트에 적용 ↗
            </Link>
          </article>
        ))}
      </div>
      {!onchain.length && !tech.length ? (
        <div className="empty-state">검색된 지표가 없습니다. 검색어와 분류를 바꿔 보세요.</div>
      ) : null}
      <p className="watch-note">
        온체인은 Bitview 기준 BTC 데이터입니다. 지표의 기준선은 관측을 비교하기 위한 값이며 단독
        매매 신호로 해석하지 않습니다. 가격·지표 차트에서 출처와 실제 기준일을 함께 확인하세요.
      </p>
    </>
  );
}

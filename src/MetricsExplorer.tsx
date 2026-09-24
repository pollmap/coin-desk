import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { ASSETS, METRICS } from '../shared/catalog';
import { METRIC_GUIDES } from '../shared/metric-guides';
import type { Asset } from '../shared/types';
import { MetricGuide } from './MetricGuide';
import { usePersonalDesk } from './PersonalDesk';
import { saved, save } from './lib';
import './explorer-ux.css';

const category = (id: string) =>
  id.startsWith('sth_') || id.startsWith('lth_')
    ? '보유자'
    : id === 'nupl' || id === 'sopr_24h'
      ? '손익'
      : '밸류에이션';
const questions = [
  {
    category: '사이클',
    question: '과거 장기 추세선에서 가격은 어디에 있나요?',
    hint: '200주선 · 2년선 · Pi Cycle · 고점 대비 낙폭',
  },
  {
    category: '밸류에이션',
    question: '현재 평가와 마지막 이동 가치는 얼마나 다른가요?',
    hint: 'MVRV · 실현가격 · MVRV-Z',
  },
  {
    category: '손익',
    question: '보유 중인 코인과 최근 이동한 코인의 손익은 어떤가요?',
    hint: 'NUPL · SOPR',
  },
  {
    category: '보유자',
    question: '단기·장기 보유자 집단은 어떻게 다른가요?',
    hint: '보유자 MVRV · 단기 실현가격',
  },
  {
    category: '기술지표',
    question: '추세·상대 강도·변동 폭은 어떻게 달라졌나요?',
    hint: '이동평균 · RSI · 볼린저밴드 · MACD',
  },
  {
    category: '네트워크',
    question: '코인이 실제로 얼마나 이동하고 발행되나요?',
    hint: '거래소 유입·유출 · 블록 · 신규 발행',
  },
  {
    category: '선물',
    question: '선물 포지션과 펀딩비는 어떻게 변하나요?',
    hint: 'Bybit 펀딩비 · 미결제약정',
  },
];
const guideText = (id: string) => {
  const guide = METRIC_GUIDES[id];
  return guide
    ? [guide.question, guide.read, guide.example, guide.caveat, guide.pair].join(' ')
    : '';
};
const technical = [
  {
    id: 'sma200,sma200w',
    guide: 'sma',
    title: '장기 이동평균',
    description:
      '확정 일·주 종가의 평균과 가격 위치를 비교합니다. 설정에서 SMA 또는 EMA 기간을 직접 바꿀 수 있습니다.',
    formula: 'SMA = 최근 n개 종가 합 / n; EMA = 현재값 × 2/(n+1) + 이전 EMA × (1−2/(n+1))',
  },
  {
    id: 'rsi',
    guide: 'rsi',
    title: 'RSI',
    description:
      '선택한 봉 간격의 상승·하락 폭을 Wilder 방식으로 평활합니다. 기본 기간 14, 0~100 범위입니다.',
    formula: '100 − 100 / (1 + 평균 상승폭 / 평균 하락폭)',
  },
  {
    id: 'bb',
    guide: 'bb',
    title: '볼린저밴드',
    description:
      '최근 가격의 평균과 변동 범위를 함께 봅니다. 기간과 표준편차 배수를 직접 바꿀 수 있습니다.',
    formula: 'SMA(n) ± k × 모집단 표준편차(n), 기본 n=20 / k=2',
  },
  {
    id: 'macd',
    guide: 'macd',
    title: 'MACD',
    description: '12·26 EMA의 차이, 그 차이의 9 EMA와 히스토그램을 함께 표시합니다.',
    formula: 'MACD = EMA12 − EMA26; 신호선 = MACD의 EMA9; 히스토그램 = MACD − 신호선',
  },
];
const expanded = [
  {
    category: '사이클',
    title: 'BTC 사이클 기준선',
    description: '200주선, 2년선·5배선, Pi Cycle과 고점 대비 낙폭을 전체 가격 이력에 표시합니다.',
    formula: '확정 USD 일별 종가의 111·350·730일 단순평균 및 완료된 200주의 종가 평균',
    to: '/?asset=BTC&period=all#btc-cycle',
    source: 'https://www.lookintobitcoin.com/charts/market-cycle-charts/',
  },
  ...(['BTC', 'DOGE', 'ETH'] as const).map((coin) => ({
    category: '네트워크',
    title: coin + ' 온체인 활동',
    description:
      coin === 'DOGE'
        ? '블록 수·신규 발행량, MVRV와 주소·거래 활동을 출시 초기부터 확인합니다.'
        : '거래소 유입·유출·보유량, MVRV와 주소·거래 활동을 실제 제공 구간에서 확인합니다.',
    formula: 'Coin Metrics Community 일별 원천값 · 순유입은 유입−유출 계산값',
    to: '/onchain/' + coin + '?period=all',
    source: 'https://docs.coinmetrics.io/network-data/network-data-overview/',
  })),
  ...(['BTC', 'DOGE', 'ETH'] as const).map((coin) => ({
    category: '선물',
    title: coin + ' 펀딩비·미결제약정',
    description: 'Bybit USDT 무기한 선물 한 거래소의 실제 확보 이력을 가격과 비교합니다.',
    formula: '펀딩비 = 정산 비율(%) · 미결제약정 = 코인 수량',
    to: '/futures/' + coin,
    source: 'https://bybit-exchange.github.io/docs/v5/market/history-fund-rate',
  })),
];
export function MetricsExplorer() {
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('전체'),
    [message, setMessage] = useState('');
  const [asset, setAsset] = useState<Asset>(() => {
    const value = saved('explorerAsset', saved('lastAsset', 'BTC'));
    return ASSETS.find((item) => item.id === value)?.id ?? 'BTC';
  });
  const { desk, update } = usePersonalDesk();
  const needle = search.trim().toLowerCase();
  const onchain = METRICS.filter(
    (m) =>
      (filter === '전체' || filter === category(m.id)) &&
      [m.title, m.english, m.description, m.formula, category(m.id), guideText(m.id)]
        .join(' ')
        .toLowerCase()
        .includes(needle),
  );
  const tech = technical.filter(
    (m) =>
      (filter === '전체' || filter === '기술지표') &&
      [m.id, m.title, m.description, m.formula, guideText(m.guide)]
        .join(' ')
        .toLowerCase()
        .includes(needle),
  );
  const additional = expanded.filter(
    (item) =>
      (filter === '전체' || filter === item.category) &&
      [item.category, item.title, item.description, item.formula]
        .join(' ')
        .toLowerCase()
        .includes(needle),
  );
  return (
    <div className="explorer-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">METRIC LIBRARY</div>
          <h1>지표 찾아보기</h1>
          <p>지표를 검색하거나 궁금한 질문으로 찾아보세요.</p>
        </div>
      </div>
      <details className="explorer-question-picker">
        <summary>무엇을 봐야 할지 모르겠다면 · 질문으로 찾기</summary>
        <section className="explorer-questions" aria-label="질문으로 지표 찾기">
          {questions.map((item) => (
            <button
              key={item.category}
              aria-pressed={filter === item.category}
              onClick={(event) => {
                setFilter(item.category);
                setSearch('');
                const picker = event.currentTarget.closest('details');
                if (picker) {
                  picker.open = false;
                  picker.querySelector('summary')?.focus();
                }
              }}
            >
              <span>{item.category}</span>
              <strong>{item.question}</strong>
              <small>{item.hint}</small>
            </button>
          ))}
        </section>
      </details>
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
            placeholder="MVRV, 평균 매수가, 상승 폭…"
            aria-describedby="explorer-search-hint"
          />
        </label>
        <label>
          기술지표 적용 코인
          <select
            value={asset}
            onChange={(event) => {
              const next = ASSETS.find((item) => item.id === event.target.value)?.id;
              if (next) {
                setAsset(next);
                save('explorerAsset', next);
              }
            }}
          >
            {ASSETS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} · {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          분류
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {['전체', '사이클', '밸류에이션', '보유자', '손익', '네트워크', '선물', '기술지표'].map(
              (x) => (
                <option key={x}>{x}</option>
              ),
            )}
          </select>
        </label>
        <Link className="desk-button" to="/">
          내 대시보드 ↗
        </Link>
      </div>
      <div className="explorer-results-heading">
        <p id="explorer-search-hint">
          질문·활용 설명·산식도 검색합니다. 온체인 활동은 해당 코인의 실제 제공 이력을, 기술지표는
          선택한 코인의 Binance USDT 전체 이력을 엽니다.
        </p>
        <div>
          <span role="status" aria-live="polite">
            {onchain.length + tech.length + additional.length}개 분석 항목 · {filter}
          </span>
          {needle || filter !== '전체' ? (
            <button
              onClick={() => {
                setSearch('');
                setFilter('전체');
              }}
            >
              전체 지표 보기
            </button>
          ) : null}
        </div>
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
            <details className="library-formula">
              <summary>계산 방법</summary>
              <div className="formula">
                <span>산식 · {m.unit}</span>
                {m.formula}
              </div>
            </details>
            <MetricGuide id={m.id} />
            <div className="workspace-actions">
              <Link className="desk-button" to={'/metrics/' + m.id + '?period=all'}>
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
            <details className="library-formula">
              <summary>계산 방법</summary>
              <div className="formula">{m.formula}</div>
            </details>
            <MetricGuide id={m.guide} />
            <Link
              className="desk-button"
              to={
                `/chart/${asset}?asset=${asset}&market=binance&interval=1d&period=all&log=1&indicators=` +
                encodeURIComponent(m.id)
              }
            >
              {asset} 전체 차트에 적용 ↗
            </Link>
          </article>
        ))}
        {additional.map((item) => (
          <article className="panel library-card" key={item.title}>
            <span className="micro-label">{item.category}</span>
            <h2>{item.title}</h2>
            <p>{item.description}</p>
            <details className="library-formula">
              <summary>계산 방법</summary>
              <div className="formula">{item.formula}</div>
            </details>
            <div className="workspace-actions">
              <Link className="desk-button" to={item.to}>
                실제 차트 열기 ↗
              </Link>
              <a className="library-source" href={item.source} target="_blank" rel="noreferrer">
                원천·정의 보기 ↗
              </a>
            </div>
          </article>
        ))}
      </div>
      {!onchain.length && !tech.length && !additional.length ? (
        <div className="empty-state">검색된 지표가 없습니다. 검색어와 분류를 바꿔 보세요.</div>
      ) : null}
      <p className="watch-note">
        BTC 전용 지표는 Bitview, 코인별 네트워크는 Coin Metrics Community, 선물은 Bybit이
        원천입니다. 기준선은 관측을 비교하기 위한 값이며 단독 매매 신호로 해석하지 않습니다.
      </p>
    </div>
  );
}

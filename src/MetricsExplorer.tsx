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
  return (
    <div className="explorer-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">METRIC LIBRARY</div>
          <h1>지표 찾아보기</h1>
          <p>보고 싶은 질문을 고르고, 지표를 읽는 방법과 실제 차트를 함께 확인하세요.</p>
        </div>
      </div>
      <section className="explorer-questions" aria-label="질문으로 지표 찾기">
        {questions.map((item) => (
          <button
            key={item.category}
            aria-pressed={filter === item.category}
            onClick={() => {
              setFilter(item.category);
              setSearch('');
            }}
          >
            <span>{item.category}</span>
            <strong>{item.question}</strong>
            <small>{item.hint}</small>
          </button>
        ))}
      </section>
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
            {['전체', '밸류에이션', '보유자', '손익', '기술지표'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <Link className="desk-button" to="/">
          내 대시보드 ↗
        </Link>
      </div>
      <div className="explorer-results-heading">
        <p id="explorer-search-hint">
          질문·활용 설명·산식도 검색합니다. 온체인은 BTC, 기술지표는 선택한 코인의 Binance USDT 전체
          이력을 엽니다.
        </p>
        <div>
          <span role="status" aria-live="polite">
            {onchain.length + tech.length}개 지표 · {filter}
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
            <div className="formula">
              <span>산식 · {m.unit}</span>
              {m.formula}
            </div>
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
            <div className="formula">{m.formula}</div>
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
      </div>
      {!onchain.length && !tech.length ? (
        <div className="empty-state">검색된 지표가 없습니다. 검색어와 분류를 바꿔 보세요.</div>
      ) : null}
      <p className="watch-note">
        온체인은 Bitview 기준 BTC 데이터입니다. 지표의 기준선은 관측을 비교하기 위한 값이며 단독
        매매 신호로 해석하지 않습니다. 가격·지표 차트에서 출처와 실제 기준일을 함께 확인하세요.
      </p>
    </div>
  );
}

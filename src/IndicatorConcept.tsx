import './indicator-concept.css';

/** Fixed teaching examples; these shapes never represent live observations or signals. */
export function IndicatorConcept({ metric }: { metric: string }) {
  const id = metric.replace(/^(net|btc|view):/, '');
  const kind = /(^|-)mvrv$/.test(id)
    ? 'mvrv'
    : id === 'supertrend'
      ? 'supertrend'
      : ['rainbow', 'btc_rainbow', 'btc-rainbow', 'asset_rainbow'].includes(id)
        ? 'bands'
        : id === 'ribbon'
          ? 'ribbon'
          : null;
  if (!kind) return null;
  const label = {
    mvrv: '시가총액 150을 실현시가총액 100으로 나누면 MVRV 1.5배입니다.',
    supertrend: '추세 기준선은 방향에 따라 가격 아래 또는 위에 놓입니다. 설명용 두 예시입니다.',
    bands: '현재 가격이 과거 가격으로 계산한 아래·중앙·위 경계의 어디에 놓이는지 봅니다.',
    ribbon: '7·25·50·100개 종가의 이동평균을 같은 가격축에서 비교합니다.',
  }[kind];
  return (
    <figure className="indicator-concept" data-concept={kind}>
      <svg viewBox="0 0 360 164" role="img" aria-label={label}>
        {kind === 'mvrv' && (
          <>
            <line x1="28" x2="216" y1="118" y2="118" className="concept-axis" />
            <rect x="48" y="38" width="54" height="80" rx="3" className="concept-fill" />
            <rect x="144" y="65" width="54" height="53" rx="3" className="concept-muted-fill" />
            <text x="75" y="29" textAnchor="middle">
              150
            </text>
            <text x="171" y="56" textAnchor="middle">
              100
            </text>
            <text x="75" y="139" textAnchor="middle">
              시가총액
            </text>
            <text x="171" y="135" textAnchor="middle">
              <tspan x="171">실현</tspan>
              <tspan x="171" dy="17">
                시가총액
              </tspan>
            </text>
            <text x="269" y="66" textAnchor="middle" className="concept-caption">
              150 ÷ 100
            </text>
            <text x="269" y="95" textAnchor="middle" className="concept-value">
              1.5배
            </text>
          </>
        )}
        {kind === 'supertrend' && (
          <>
            <line x1="180" x2="180" y1="20" y2="140" className="concept-axis" />
            <path d="M22 88 L47 77 L72 83 L97 63 L122 57 L150 44" className="concept-price" />
            <path d="M22 117 H73 V107 H122 V96 H150" className="concept-line" />
            <text x="86" y="149" textAnchor="middle">
              가격 아래 기준선
            </text>
            <path d="M207 53 L231 61 L256 52 L280 78 L305 84 L335 100" className="concept-price" />
            <path d="M207 28 H255 V36 H305 V48 H335" className="concept-line concept-upper" />
            <text x="272" y="149" textAnchor="middle">
              가격 위 기준선
            </text>
          </>
        )}
        {kind === 'bands' && (
          <>
            <path d="M24 91 Q165 11 332 30 L332 121 Q165 92 24 140 Z" className="concept-range" />
            <path d="M24 115 Q165 50 332 75" className="concept-line concept-dashed" />
            <path
              d="M24 91 Q165 11 332 30 M24 140 Q165 92 332 121"
              className="concept-boundaries"
            />
            <path
              d="M30 131 L73 107 L106 103 L151 74 L194 78 L238 62 L283 54 L320 62"
              className="concept-price"
            />
            <circle cx="320" cy="62" r="4" className="concept-point" />
            <text x="332" y="20" textAnchor="end">
              위 경계
            </text>
            <text x="332" y="94" textAnchor="end">
              중앙선
            </text>
            <text x="332" y="145" textAnchor="end">
              아래 경계
            </text>
            <text x="30" y="157" className="concept-caption">
              과거 가격으로 계산한 범위
            </text>
          </>
        )}
        {kind === 'ribbon' && (
          <>
            <path d="M24 126 Q137 54 268 24" className="concept-line" />
            <path d="M24 130 Q140 77 268 50" className="concept-line concept-ribbon-25" />
            <path d="M24 136 Q145 102 268 80" className="concept-line concept-ribbon-50" />
            <path d="M24 143 Q151 129 268 113" className="concept-line concept-ribbon-100" />
            <text x="282" y="28">
              SMA 7
            </text>
            <text x="282" y="54">
              SMA 25
            </text>
            <text x="282" y="84">
              SMA 50
            </text>
            <text x="282" y="117">
              SMA 100
            </text>
            <text x="24" y="159" className="concept-caption">
              짧은 평균과 긴 평균의 순서·간격
            </text>
          </>
        )}
      </svg>
      <figcaption>설명용 예시 · 현재 데이터가 아닙니다</figcaption>
    </figure>
  );
}

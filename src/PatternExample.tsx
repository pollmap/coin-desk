import { PATTERNS } from '../shared/candle-patterns';

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

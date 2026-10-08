import type { IndicatorDefinition } from './indicator-catalog';
export const INDICATOR_QUESTIONS = [
  { label: '시장가격과 온체인 평가', query: '가치평가' },
  { label: '과거 가격에서의 위치', query: '위치' },
  { label: '가격 추세와 변동', query: '추세' },
  { label: '선물 시장의 포지션', query: '선물' },
  { label: '네트워크 활동', query: '활동' },
  { label: '다른 코인과 비교', query: '비교' },
];
export function indicatorPurpose(d: Pick<IndicatorDefinition, 'id' | 'group'>) {
  if (/mvrv|realized/.test(d.id)) return '가치평가 시장가격과 온체인 평가 실현가치';
  if (/rainbow|powerlaw/.test(d.id)) return '위치 과거 가격 범위 레인보우 밴드';
  if (d.group === '선물') return '선물 포지션';
  if (/relative|correlation|comparison/.test(d.id)) return '비교 다른 코인 상대강도 상관';
  if (d.group === '온체인') return '활동 네트워크 주소 거래 전송 수수료';
  return '추세 변동 가격 성과 기술';
}
export function matchesIndicator(d: IndicatorDefinition, query: string) {
  const terms = query.trim().toLowerCase().split(/\s+/);
  const text = [d.title, d.id, d.shortMeaning, d.group, indicatorPurpose(d)]
    .join(' ')
    .toLowerCase();
  return terms.every((t) => text.includes(t));
}

import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThresholdSummary } from '../src/ThresholdSummary';

const point = Object.freeze({ time: 1704067200, value: 0.25 });

it('shows the dated state and numeric boundaries above the chart without altering readonly observations', () => {
  const before = { ...point };
  const html = renderToStaticMarkup(
    <ThresholdSummary id="mvrv" unit="배" point={point} selected stale />,
  );
  expect(html).toContain('선택 관측');
  expect(html).toContain('2024');
  expect(html).toContain('지연');
  expect(html).toContain('저평가 참고');
  expect(html).toContain('0.25×');
  expect(html).toContain('경계 1.00× / 3.70×');
  expect(point).toEqual(before);
});

it('formats Coin Metrics NUPL as percent exactly once and only shows its zero break-even boundary', () => {
  const html = renderToStaticMarkup(
    <ThresholdSummary id="network_nupl" unit="비율" point={point} />,
  );
  expect(html).toContain('25.00%');
  expect(html).toContain('순미실현 이익');
  expect(html).toContain('경계 0.00%');
  expect(html).not.toContain('3.70');
  expect(html).not.toContain('75.00');
});

it('requires the same observed date before summarizing a realized-price comparison', () => {
  const reference = Object.freeze({ time: 1704067200, value: 100 });
  const mismatched = renderToStaticMarkup(
    <ThresholdSummary
      id="realized_price"
      unit="USD"
      point={reference}
      comparison={{ time: 1704153600, value: 150 }}
    />,
  );
  expect(mismatched).toContain('같은 날짜 가격 대기');
  expect(mismatched).not.toContain('1.50×');
  const matched = renderToStaticMarkup(
    <ThresholdSummary
      id="realized_price"
      unit="USD"
      point={reference}
      comparison={{ time: reference.time, value: 150 }}
    />,
  );
  expect(matched).toContain('1.50×');
  expect(matched).toContain('추정 가격이 실현가격 위');
});

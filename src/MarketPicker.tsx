import type { Market } from '../shared/types';
export function MarketPicker({
  market,
  onChange,
  label = '가격 기준',
}: {
  market: Market;
  label?: string;
  onChange: (value: Market) => void;
}) {
  return (
    <div className="market-picker" role="group" aria-label="가격 기준 통화와 거래소">
      <span>{label}</span>
      <button aria-pressed={market === 'binance'} onClick={() => onChange('binance')}>
        USDT <small>Binance</small>
      </button>
      <button aria-pressed={market === 'upbit'} onClick={() => onChange('upbit')}>
        원화 KRW <small>Upbit</small>
      </button>
    </div>
  );
}

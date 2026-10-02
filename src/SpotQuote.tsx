import type { Asset, Market } from '../shared/types';
import { useQuoteFeed } from './useQuoteFeed';
import { money, dateLabel } from './lib';
/** Isolate one-second updates from expensive historical chart calculations. */
export function SpotQuote({ asset, market }: { asset: Asset; market: Market }) {
  const feed = useQuoteFeed(market),
    quote = feed.rows.find((r) => r.asset === asset);
  return (
    <div
      className="detail-quote"
      title={
        quote?.displayTime ? `실제 체결 ${dateLabel(quote.displayTime, true)}` : '시세 수집 대기'
      }
    >
      <strong>{money(quote?.displayPrice, market === 'upbit' ? 'KRW' : 'USDT')}</strong>
      <span>
        {market === 'upbit' ? 'Upbit · KRW' : 'Binance · USDT'}
        {!quote?.displayPrice
          ? ' · 시세 대기'
          : quote.stale
            ? ' · 갱신 지연'
            : quote.live
              ? ' · 실시간 가격'
              : ' · 분 단위 저장값'}
      </span>
    </div>
  );
}

import type { Asset, Market } from '../shared/types';
import { useQuoteFeed } from './useQuoteFeed';
import { money } from './lib';
import { useEffect, useId, useRef, useState } from 'react';
import type { LiveChartPrice } from '../shared/live-chart-price';
import { useSearchParams } from 'react-router-dom';
import { supportsMarket } from '../shared/asset-registry';
import { DeskDialog } from './DeskDialog';
/** Isolate one-second updates from expensive historical chart calculations. */
export function SpotQuote({
  asset,
  market,
  syncPriceSource = false,
  onQuote,
}: {
  asset: Asset;
  market: Market;
  syncPriceSource?: boolean;
  onQuote?: (quote: LiveChartPrice | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const priceDescription = useId();
  const sourceDescription = useId();
  const [, setParams] = useSearchParams();
  const feed = useQuoteFeed(market, { assets: [asset], snapshotAssets: [asset], sparkLimit: 0 }),
    quote = feed.rows.find((r) => r.asset === asset);
  useEffect(() => {
    onQuote?.(
      quote?.displayPrice && quote.displayTime && quote.displayTimestampKind === 'trade'
        ? {
            asset,
            market,
            price: quote.displayPrice,
            time: quote.displayTime,
            stale: quote.stale,
          }
        : null,
    );
  }, [
    asset,
    market,
    onQuote,
    quote?.displayPrice,
    quote?.displayTime,
    quote?.stale,
    quote?.displayTimestampKind,
  ]);
  useEffect(() => () => onQuote?.(null), [asset, market, onQuote]);
  return (
    <div className="detail-quote">
      <button
        className="quote-source-button"
        ref={button}
        onClick={() => setOpen(true)}
        aria-label="가격 거래소 선택"
        aria-describedby={`${priceDescription} ${sourceDescription}`}
      >
        <strong id={priceDescription}>
          {money(quote?.displayPrice, market === 'upbit' ? 'KRW' : 'USDT')}
        </strong>
        <span className="quote-source-label" id={sourceDescription}>
          {market === 'upbit' ? 'Upbit · KRW' : 'Binance · USDT'}
          {!quote?.displayPrice
            ? feed.loading && !feed.error
              ? ' · 불러오는 중'
              : ' · 가격 확인 불가'
            : quote.stale
              ? ' · 가격 확인 지연'
              : ''}{' '}
          ▾
        </span>
      </button>
      <DeskDialog open={open} onOpenChange={setOpen} title="가격 선택" returnFocus={button} sheet>
        <label>
          거래소·통화{' '}
          <select
            aria-label="현재 가격 거래소"
            value={market}
            onChange={(event) => {
              const value = event.target.value;
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                next.set('market', value);
                if (syncPriceSource) {
                  next.set('price_source', value);
                  for (const key of ['reading_date', 'chart_from', 'chart_to']) next.delete(key);
                }
                return next;
              });
            }}
          >
            <option value="upbit" disabled={!supportsMarket(asset, 'upbit')}>
              Upbit · KRW
            </option>
            <option value="binance" disabled={!supportsMarket(asset, 'binance')}>
              Binance · USDT
            </option>
          </select>
        </label>
      </DeskDialog>
    </div>
  );
}

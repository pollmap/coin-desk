import type { Asset, Market } from '../shared/types';
import { useQuoteFeed } from './useQuoteFeed';
import { money, dateLabel } from './lib';
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supportsMarket } from '../shared/asset-registry';
import { DeskDialog } from './DeskDialog';
/** Isolate one-second updates from expensive historical chart calculations. */
export function SpotQuote({ asset, market }: { asset: Asset; market: Market }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const [, setParams] = useSearchParams();
  const feed = useQuoteFeed(market, { assets: [asset], snapshotAssets: [asset], sparkLimit: 0 }),
    quote = feed.rows.find((r) => r.asset === asset);
  return (
    <div
      className="detail-quote"
      title={
        quote?.displayTime ? `실제 체결 ${dateLabel(quote.displayTime, true)}` : '시세 수집 대기'
      }
    >
      <strong>{money(quote?.displayPrice, market === 'upbit' ? 'KRW' : 'USDT')}</strong>
      <button
        className="quote-source-button"
        ref={button}
        onClick={() => setOpen(true)}
        aria-label="가격 거래소와 체결 시각"
      >
        {market === 'upbit' ? 'Upbit · KRW' : 'Binance · USDT'}
        {!quote?.displayPrice ? ' · 시세 대기' : quote.stale ? ' · 갱신 지연' : ''} ▾
      </button>
      <DeskDialog open={open} onOpenChange={setOpen} title="현재 가격" returnFocus={button} sheet>
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
        <p>
          {quote?.displayTime
            ? `실제 체결 ${dateLabel(quote.displayTime, true)}`
            : '시세 수집 대기'}
        </p>
        <p>
          {quote?.stale
            ? '갱신이 지연되고 있습니다.'
            : quote?.live
              ? '거래소 스트림으로 받은 가격입니다.'
              : '분 단위로 확인한 가격입니다.'}
        </p>
      </DeskDialog>
    </div>
  );
}

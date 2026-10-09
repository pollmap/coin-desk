import type { RefObject } from 'react';
import type { Market } from '../shared/types';
import type { MarketRow } from '../shared/market-snapshot';
import { DeskDialog } from './DeskDialog';
import { dateLabel, money } from './lib';

export interface QuoteInfo extends MarketRow {
  displayPrice?: number;
  displayTime?: number;
  stale: boolean;
}
export default function MarketQuoteInfo({
  row,
  market,
  onClose,
  returnFocus,
}: {
  row: QuoteInfo;
  market: Market;
  onClose: () => void;
  returnFocus: RefObject<HTMLElement | null>;
}) {
  return (
    <DeskDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={row.asset + ' 시세 정보'}
      returnFocus={returnFocus}
      sheet
    >
      <p>
        <strong>{money(row.displayPrice, market === 'upbit' ? 'KRW' : 'USDT')}</strong> ·{' '}
        {market === 'upbit' ? 'Upbit KRW' : 'Binance USDT'}
      </p>
      <dl className="quote-info-list">
        <dt>
          {market === 'upbit' || row.displayTime !== row.quote?.time ? '마지막 체결' : '가격 기준'}
        </dt>
        <dd>{dateLabel(row.displayTime, true)}</dd>
        <dt>변동률 기준</dt>
        <dd>{row.quote ? dateLabel(row.quote.time, true) : '확인 대기'}</dd>
        <dt>시세 확인</dt>
        <dd>{dateLabel(row.fetchedAt, true)}</dd>
      </dl>
      {row.stale && (
        <p>
          최근 체결을 확인하지 못해 마지막 가격을 표시합니다. 새 체결 시각은 실제 거래가 있어야
          바뀝니다.
        </p>
      )}
      {row.status === 'error' && (
        <p>
          분 단위 시세 확인에 실패했습니다. 스트림 가격과 마지막으로 확인한 변동률의 기준 시각이
          다를 수 있습니다.
        </p>
      )}
      {row.quote?.changeUnavailableReason && <p>{row.quote.changeUnavailableReason}</p>}
      {market === 'upbit' && (
        <p>24시간 변동률은 전일 같은 시각의 확정 분봉과 비교한 근사값입니다.</p>
      )}
      {market === 'binance' && (
        <p>
          분 단위 가격의 기준 시각은 24시간 통계 종료 시각입니다. 스트림은 실제 체결 시각을
          사용합니다.
        </p>
      )}
    </DeskDialog>
  );
}

import { useEffect, useState } from 'react';
import type { Market } from '../shared/types';
import type { MarketSnapshot, QuoteStream } from '../shared/market-snapshot';
import { useData } from './hooks';
import { mergeQuoteStream } from '../shared/quote-stream';

export function useQuoteFeed(market: Market) {
  const snapshot = useData<MarketSnapshot>(`/api/v1/market?market=${market}`, false, 60000);
  const [stream, setStream] = useState<QuoteStream | null>(null);
  const [transport, setTransport] = useState('connecting');
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    let active = true;
    let current: QuoteStream | null = null;
    let lastEvent = 0;
    setStream(null);
    setTransport('connecting');
    const source = new EventSource(`/api/v1/quotes/stream?market=${market}`);
    source.addEventListener('quotes', (event) => {
      try {
        if (!active) return;
        const next = mergeQuoteStream(
          current,
          JSON.parse((event as MessageEvent).data),
          market,
          Date.now() / 1000,
        );
        if (!next || next === current) return;
        current = next;
        lastEvent = Date.now();
        setStream(next);
        setTransport(next.connected ? 'live' : 'polling');
      } catch {
        /* Keep the independent minute snapshot on malformed events. */
      }
    });
    source.onerror = () => {
      if (active) setTransport('polling');
    };
    const timer = setInterval(() => {
      setNow(Date.now() / 1000);
      if (lastEvent && Date.now() - lastEvent > 10000) setTransport('polling');
    }, 1000);
    return () => {
      active = false;
      source.close();
      clearInterval(timer);
    };
  }, [market]);
  const rows =
    snapshot.data?.market === market
      ? snapshot.data.rows.map((row) => {
          const tick =
            stream?.market === market && transport === 'live'
              ? stream.quotes.find((q) => q.asset === row.asset && q.market === market)
              : undefined;
          const live =
            !!tick &&
            Number.isFinite(tick.price) &&
            tick.price > 0 &&
            now - tick.tradedAt <= 300 &&
            tick.tradedAt <= now + 60 &&
            tick.tradedAt >= (row.quote?.time ?? 0);
          return {
            ...row,
            live,
            displayPrice: live ? tick.price : row.quote?.price,
            displayTime: live ? tick.tradedAt : row.quote?.time,
            stale:
              !live &&
              (!row.quote || now - row.quote.time > 300 || now - (row.fetchedAt ?? 0) > 300),
          };
        })
      : [];
  return { ...snapshot, rows, transport };
}

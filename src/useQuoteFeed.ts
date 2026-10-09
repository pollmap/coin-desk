import { useEffect, useState } from 'react';
import type { Market } from '../shared/types';
import type { MarketSnapshot, QuoteStream } from '../shared/market-snapshot';
import { useData } from './hooks';
import { mergeQuoteStream, quoteRowView } from '../shared/quote-stream';

export function useQuoteFeed(
  market: Market,
  options: { assets?: string[]; snapshotAssets?: string[]; sparkLimit?: number } = {},
) {
  const subscription = options.assets?.join(',');
  const snapshot = useData<MarketSnapshot>(
    `/api/v1/market?market=${market}${options.snapshotAssets ? '&assets=' + encodeURIComponent(options.snapshotAssets.join(',')) : ''}${options.sparkLimit === undefined ? '' : '&spark_limit=' + options.sparkLimit}`,
    false,
    60000,
  );
  const [stream, setStream] = useState<QuoteStream | null>(null);
  const [transport, setTransport] = useState('connecting');
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    if (subscription === '') return;
    let active = true;
    let current: QuoteStream | null = null;
    let lastEvent = Date.now();
    let source: EventSource | undefined;
    setStream(null);
    setTransport('connecting');
    const connect = () => {
      source?.close();
      lastEvent = Date.now();
      const connection = new EventSource(
        `/api/v1/quotes/stream?market=${market}${subscription === undefined ? '' : '&assets=' + encodeURIComponent(subscription)}`,
      );
      source = connection;
      connection.addEventListener('quotes', (event) => {
        try {
          if (!active || source !== connection) return;
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
      connection.onerror = () => {
        if (active && source === connection) setTransport('polling');
      };
    };
    connect();
    const recover = () => {
      // An intermediary can leave an OPEN socket silent without an error event.
      // Also recover a connection which never delivered its first heartbeat.
      if (!document.hidden && Date.now() - lastEvent > 10000) {
        setTransport('polling');
        connect();
      }
    };
    const timer = setInterval(() => {
      setNow(Date.now() / 1000);
      recover();
    }, 1000);
    document.addEventListener('visibilitychange', recover);
    return () => {
      active = false;
      source?.close();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', recover);
    };
  }, [market, subscription]);
  const rows =
    snapshot.data?.market === market
      ? snapshot.data.rows.map((row) => quoteRowView(row, stream, market, transport, now))
      : [];
  return { ...snapshot, rows, transport };
}

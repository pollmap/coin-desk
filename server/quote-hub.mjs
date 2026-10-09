import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ASSET_REGISTRY } from '../server-dist/assets.mjs';

export const assets = ASSET_REGISTRY.map((a) => a.id);
const symbols = Object.fromEntries(
  ['upbit', 'binance'].map((m) => [
    m,
    new Map(ASSET_REGISTRY.filter((a) => a.markets[m]).map((a) => [a.markets[m], a.id])),
  ]),
);
export function parseTick(market, message, now = Date.now() / 1000) {
  if (!['upbit', 'binance'].includes(market) || !message || typeof message !== 'object')
    return null;
  const data = message.data ?? message;
  if (!data || typeof data !== 'object') return null;
  const asset = symbols[market].get(market === 'upbit' ? data.code : data.s);
  if (!assets.includes(asset)) return null;
  if (market === 'upbit' && data.type !== 'ticker') return null;
  if (market === 'binance' && data.e !== 'aggTrade') return null;
  const price = Number(market === 'upbit' ? data.trade_price : data.p);
  const tradedAt = Number(market === 'upbit' ? data.trade_timestamp : data.T) / 1000;
  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(tradedAt) ||
    tradedAt <= 0 ||
    tradedAt > now + 60
  )
    return null;
  return { asset, market, price, tradedAt, receivedAt: now };
}

export function createQuoteHub({ clock = () => Date.now() / 1000, maxClients = 200 } = {}) {
  const epoch = randomUUID();
  const markets = Object.fromEntries(
    ['upbit', 'binance'].map((m) => [m, { connected: false, quotes: new Map(), sequence: 0 }]),
  );
  const clients = new Map();
  function ingest(market, message) {
    const tick = parseTick(market, message, clock());
    if (!tick) return false;
    const previous = markets[market].quotes.get(tick.asset);
    if (previous && tick.tradedAt <= previous.tradedAt) return false;
    markets[market].quotes.set(tick.asset, tick);
    return true;
  }
  function snapshot(market) {
    const state = markets[market];
    return {
      epoch,
      sequence: ++state.sequence,
      market,
      connected: state.connected,
      quotes: [...state.quotes.values()],
    };
  }
  function send(res, client, payload) {
    if (res.destroyed || res.writableLength > 65536) {
      res.destroy();
      clients.delete(res);
      return;
    }
    const quotes = payload.quotes.filter(
      (q) => client.assets === null || client.assets.has(q.asset),
    );
    const delta = client.assets !== null;
    const changed = delta
      ? quotes.filter((q) => q.tradedAt > (client.sent.get(q.asset) ?? 0))
      : quotes;
    for (const q of changed) client.sent.set(q.asset, q.tradedAt);
    res.write(`event: quotes\ndata: ${JSON.stringify({ ...payload, delta, quotes: changed })}\n\n`);
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://quote-hub.internal');
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          ok: true,
          markets: Object.fromEntries(
            Object.entries(markets).map(([m, s]) => [
              m,
              { connected: s.connected, assets: s.quotes.size },
            ]),
          ),
        }),
      );
      return;
    }
    const market = url.searchParams.get('market');
    if (
      url.pathname !== '/stream' ||
      !['upbit', 'binance'].includes(market) ||
      [...url.searchParams.keys()].some((k) => !['market', 'assets'].includes(k)) ||
      url.searchParams.getAll('market').length !== 1 ||
      url.searchParams.getAll('assets').length > 1
    ) {
      res.writeHead(400).end();
      return;
    }
    const requested = url.searchParams.has('assets')
      ? url.searchParams.get('assets').split(',').filter(Boolean)
      : null;
    if (
      requested &&
      (requested.length > assets.length ||
        new Set(requested).size !== requested.length ||
        requested.some((a) => !assets.includes(a)))
    ) {
      res.writeHead(400).end();
      return;
    }
    if (clients.size >= maxClients) {
      res.writeHead(503, { 'retry-after': '5' }).end();
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    const client = {
      market,
      assets: requested === null ? null : new Set(requested),
      sent: new Map(),
    };
    clients.set(res, client);
    send(res, client, snapshot(market));
    res.on('close', () => clients.delete(res));
  });
  const timer = setInterval(() => {
    const payloads = new Map();
    for (const [res, client] of clients) {
      if (!payloads.has(client.market)) payloads.set(client.market, snapshot(client.market));
      send(res, client, payloads.get(client.market));
    }
  }, 1000);
  timer.unref();
  return {
    server,
    ingest,
    snapshot,
    markets,
    async close() {
      clearInterval(timer);
      for (const res of clients.keys()) res.end();
      await new Promise((r) => server.close(r));
    },
  };
}

export function connectExchange(hub, market, WebSocketClass = WebSocket) {
  let socket,
    retry,
    watchdog,
    stopped = false,
    attempts = 0;
  function connect() {
    if (stopped) return;
    const streams = [...symbols.binance.keys()].map((s) => `${s.toLowerCase()}@aggTrade`).join('/');
    socket = new WebSocketClass(
      market === 'upbit'
        ? 'wss://api.upbit.com/websocket/v1'
        : `wss://stream.binance.com:9443/stream?streams=${streams}`,
    );
    let lastReceived = Date.now(),
      openedAt = Date.now();
    socket.addEventListener('open', () => {
      hub.markets[market].connected = true;
      attempts = 0;
      if (market === 'upbit')
        socket.send(
          JSON.stringify([
            { ticket: randomUUID() },
            { type: 'ticker', codes: [...symbols.upbit.keys()], is_only_realtime: true },
            { format: 'DEFAULT' },
          ]),
        );
    });
    socket.addEventListener('message', async (event) => {
      try {
        const raw = typeof event.data === 'string' ? event.data : await event.data.text();
        if (raw.length > 65536) return;
        const message = JSON.parse(raw);
        if (hub.ingest(market, message)) lastReceived = Date.now();
      } catch {
        /* Invalid individual ticks never replace a valid price. */
      }
    });
    socket.addEventListener('error', () => socket.close());
    socket.addEventListener('close', () => {
      clearInterval(watchdog);
      hub.markets[market].connected = false;
      if (!stopped)
        retry = setTimeout(
          connect,
          Math.min(60000, 1000 * 2 ** Math.min(attempts++, 6)) + Math.random() * 1000,
        );
    });
    watchdog = setInterval(() => {
      if (Date.now() - lastReceived > 90000 || Date.now() - openedAt > 23 * 3600000) socket.close();
    }, 15000);
  }
  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    clearInterval(watchdog);
    socket?.close();
    hub.markets[market].connected = false;
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const hub = createQuoteHub();
  const stop = ['upbit', 'binance'].map((m) => connectExchange(hub, m));
  hub.server.listen(Number(process.env.PORT || 8091), process.env.HOST || '127.0.0.1');
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, async () => {
      stop.forEach((fn) => fn());
      await hub.close();
      process.exit(0);
    });
}

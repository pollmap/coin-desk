import { validSpotRequest } from '../server-dist/feed.mjs';

/** Reuse one public connection per process instead of exceeding the 300/5m IP connection cap. */
export function createPublicBinanceSession({
  WebSocketClass = WebSocket,
  clock = Date.now,
  idleMs = 5000,
  maxPending = 32,
} = {}) {
  let socket,
    idle,
    serial = 0,
    retryAt = 0;
  const pending = new Map();
  function finish(id, error, value) {
    const task = pending.get(id);
    if (!task) return;
    pending.delete(id);
    clearTimeout(task.timer);
    if (error) task.reject(error);
    else task.resolve(value);
    if (!pending.size) {
      clearTimeout(idle);
      idle = setTimeout(close, idleMs);
      idle.unref?.();
    }
  }
  function close() {
    clearTimeout(idle);
    const previous = socket;
    socket = undefined;
    previous?.close();
    for (const id of [...pending.keys()]) finish(id, new Error('Binance public session closed'));
  }
  function fail(current, message) {
    if (current !== socket) return;
    socket = undefined;
    for (const id of [...pending.keys()]) finish(id, new Error(message));
    current.close();
  }
  function send(task) {
    if (!socket || socket.readyState !== 1 || task.sent) return;
    task.sent = true;
    try {
      socket.send(JSON.stringify({ id: task.id, method: task.method, params: task.params }));
    } catch {
      finish(task.id, new Error('Binance WebSocket connection failed'));
    }
  }
  function connect() {
    if (socket) return;
    const current = (socket = new WebSocketClass('wss://ws-api.binance.com:443/ws-api/v3'));
    current.addEventListener('open', () => {
      if (current === socket) for (const task of pending.values()) send(task);
    });
    current.addEventListener('message', (event) => {
      if (current !== socket) return;
      try {
        const text = String(event.data);
        if (text.length > 262144) return fail(current, 'Binance response exceeds limit');
        const data = JSON.parse(text);
        if (data.event === 'serverShutdown')
          return fail(current, 'Binance public session restarting');
        if (!pending.has(data.id)) return;
        if (data.status !== 200) {
          if ([418, 429].includes(data.status)) {
            const provided = Number(data.error?.data?.retryAfter ?? data.retryAfter);
            retryAt =
              Number.isSafeInteger(provided) && provided > clock()
                ? Math.min(provided, clock() + 86400000)
                : clock() + 60000;
          }
          finish(data.id, new Error('Binance API ' + data.status));
        } else finish(data.id, undefined, data.result);
      } catch {
        fail(current, 'Invalid Binance response');
      }
    });
    current.addEventListener('error', () => fail(current, 'Binance WebSocket connection failed'));
    current.addEventListener('close', () => fail(current, 'Binance closed before response'));
  }
  return {
    request(method, params, timeoutMs = 12000) {
      if (
        !params ||
        Array.isArray(params) ||
        typeof params !== 'object' ||
        !validSpotRequest(method, params) ||
        !Number.isInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 12000
      )
        return Promise.reject(new Error('Invalid public Binance request'));
      if (clock() < retryAt) return Promise.reject(new Error('Binance API 429: retry wait'));
      if (pending.size >= maxPending)
        return Promise.reject(new Error('Binance public request queue full'));
      clearTimeout(idle);
      return new Promise((resolve, reject) => {
        const id = `public-${++serial}`;
        const task = {
          id,
          method,
          params,
          resolve,
          reject,
          sent: false,
          timer: setTimeout(() => finish(id, new Error('Binance WebSocket timeout')), timeoutMs),
        };
        pending.set(id, task);
        try {
          connect();
          send(task);
        } catch {
          finish(id, new Error('Binance WebSocket connection failed'));
        }
      });
    },
    close,
  };
}
export const publicBinanceSession = createPublicBinanceSession();

import { DAY } from '../shared/math';
import { observationSignals, type ObservationSignal, type DailyBriefing } from '../shared/signals';
import type { Asset, Point } from '../shared/types';
import { claimRefresh, epoch, failure, putState, readState, success, type Env } from './storage';
import { readNetworkSeries } from './network-data';

const CORE: Asset[] = ['BTC', 'DOGE', 'ETH'];
/** Atomically preserve every revision. A historical import never emits a fresh notification. */
export async function reconcileSignals(
  env: Env,
  asset: Asset,
  source: string,
  type: 'price' | 'mvrv' | 'funding',
  points: Point[],
  now = epoch(),
) {
  if (!points.length) return;
  const key = `signals:watermark:${asset}:${source}:${type}`;
  const watermark = await readState<number | null>(env.DB, key, null);
  const closed = points.filter((p) => p.time + (type === 'funding' ? 0 : DAY) <= now);
  const latest = closed.at(-1)?.time;
  if (latest === undefined) return;
  const after = now - 8 * DAY;
  const computed = observationSignals(
    asset,
    source,
    closed,
    type,
    now,
    source === 'upbit' ? 'KRW' : source === 'binance' ? 'USDT' : 'USD',
  ).filter((s) => s.time >= after);
  const rules =
    type === 'price' ? ['sma200', 'rsi30', 'rsi70'] : [type === 'mvrv' ? 'mvrv1' : 'funding0'];
  const existing = (
    await env.DB.prepare(
      'SELECT id,payload,revision,status FROM observation_signals WHERE asset=? AND source=? AND time>=?',
    )
      .bind(asset, source, after)
      .all<{ id: string; payload: string; revision: number; status: string }>()
  ).results.filter((r) => rules.includes((JSON.parse(r.payload) as ObservationSignal).rule));
  const dates = new Set(closed.map((p) => p.time));
  const canReconcile = (s: ObservationSignal) => {
    if (
      !dates.has(s.time) ||
      !dates.has(s.previousTime ?? s.time - (type === 'funding' ? 8 * 3600 : DAY))
    )
      return false;
    const needed = s.rule === 'sma200' ? 201 : s.rule === 'rsi30' || s.rule === 'rsi70' ? 16 : 1;
    return Array.from({ length: needed }, (_, i) => s.time - i * DAY).every((t) => dates.has(t));
  };
  const writes: D1PreparedStatement[] = [];
  for (const item of computed) {
    const payload = JSON.stringify(item),
      prior = existing.find((s) => s.id === item.id);
    if (prior && !canReconcile(JSON.parse(prior.payload))) continue;
    if (prior?.payload === payload && prior.status !== 'withdrawn') continue;
    if (prior) {
      writes.push(
        env.DB.prepare('INSERT OR IGNORE INTO signal_revisions VALUES(?,?,?,?)').bind(
          prior.id,
          prior.revision,
          prior.payload,
          now,
        ),
      );
      writes.push(
        env.DB.prepare(
          "UPDATE observation_signals SET payload=?,revision=revision+1,status='corrected',notify=0 WHERE id=?",
        ).bind(payload, item.id),
      );
    } else {
      const notify = watermark !== null && item.time > watermark && item.time >= now - 2 * DAY;
      writes.push(
        env.DB.prepare(
          'INSERT OR IGNORE INTO observation_signals(id,asset,source,rule,time,payload,created_at,notify) VALUES(?,?,?,?,?,?,?,?)',
        ).bind(item.id, asset, source, item.rule, item.time, payload, now, notify ? 1 : 0),
      );
    }
  }
  // Only withdraw when both observations remain available; a source outage is not a correction.
  for (const prior of existing) {
    const old = JSON.parse(prior.payload) as ObservationSignal;
    if (
      prior.status === 'withdrawn' ||
      computed.some((s) => s.id === prior.id) ||
      !canReconcile(old)
    )
      continue;
    writes.push(
      env.DB.prepare('INSERT OR IGNORE INTO signal_revisions VALUES(?,?,?,?)').bind(
        prior.id,
        prior.revision,
        prior.payload,
        now,
      ),
    );
    writes.push(
      env.DB.prepare(
        "UPDATE observation_signals SET revision=revision+1,status='withdrawn',notify=0 WHERE id=?",
      ).bind(prior.id),
    );
  }
  if (writes.length) await env.DB.batch(writes);
  if (watermark !== latest) await putState(env.DB, key, Math.max(watermark ?? 0, latest));
}
export async function signalsFeed(
  env: Env,
  asset: Asset,
  before = epoch() + 1,
  limit = 100,
  cursor?: string | null,
) {
  const boundary = cursor?.indexOf('|') ?? -1;
  const cursorTime = boundary > 0 ? Number(cursor!.slice(0, boundary)) : before;
  const cursorId = boundary > 0 ? cursor!.slice(boundary + 1) : '';
  if (
    !Number.isSafeInteger(cursorTime) ||
    cursorTime < 0 ||
    (cursor && (boundary < 1 || !cursorId || cursor.length > 512))
  )
    throw new Error('Invalid signal cursor');
  const rows = (
    await env.DB.prepare(
      'SELECT * FROM observation_signals WHERE asset=? AND (time<? OR (time=? AND id>?)) ORDER BY time DESC,id LIMIT ?',
    )
      .bind(asset, cursorTime, cursorId ? cursorTime : -1, cursorId, limit + 1)
      .all<{
        payload: string;
        created_at: number;
        revision: number;
        status: ObservationSignal['status'];
        notify: number;
        time: number;
        id: string;
      }>()
  ).results;
  const page = rows.slice(0, limit);
  return {
    data: page.map((r) => ({
      ...JSON.parse(r.payload),
      createdAt: r.created_at,
      revision: r.revision,
      status: r.status,
      notify: !!r.notify,
    })),
    nextCursor: rows.length > limit ? `${page.at(-1)!.time}|${page.at(-1)!.id}` : null,
    source: 'Coin Desk · 확정 관측 규칙',
    automatic: true,
  };
}
export async function buildDailyBriefing(env: Env, now = epoch()) {
  const kst = new Date((now + 9 * 3600) * 1000),
    date = kst.toISOString().slice(0, 10);
  if (kst.getUTCHours() * 60 + kst.getUTCMinutes() < 9 * 60 + 10) return;
  if (await env.DB.prepare('SELECT id FROM daily_briefings WHERE id=?').bind(date).first()) return;
  const prices: DailyBriefing['prices'] = [],
    missing: string[] = [];
  for (const asset of CORE) {
    const points = (
      await env.DB.prepare(
        'SELECT time,value FROM reference_prices WHERE asset=? AND time+86400<=? ORDER BY time DESC LIMIT 2',
      )
        .bind(asset, now)
        .all<Point>()
    ).results;
    const [last, prev] = points;
    prices.push({
      asset,
      price: last?.value ?? null,
      change:
        last && prev && last.time - prev.time === DAY ? (last.value / prev.value - 1) * 100 : null,
      asOf: last?.time ?? null,
      source: 'Coin Metrics PriceUSD',
      unit: 'USD',
    });
    if (!last || now - last.time > 3 * DAY) missing.push(asset + ' USD 참조가격');
  }
  const count = await env.DB.prepare(
    "SELECT COUNT(*) n FROM observation_signals WHERE created_at>? AND created_at<=? AND notify=1 AND status!='withdrawn'",
  )
    .bind(now - DAY, now)
    .first<{ n: number }>();
  const briefing: DailyBriefing = {
    id: date,
    date,
    createdAt: now,
    prices,
    signals: count?.n ?? 0,
    events: [],
    missing,
  };
  await env.DB.prepare('INSERT OR IGNORE INTO daily_briefings VALUES(?,?,?)')
    .bind(date, now, JSON.stringify(briefing))
    .run();
}
/** Separate bounded lane. No visitor, browser tab or paid API is required. */
export async function refreshObservations(env: Env) {
  const now = epoch();
  if (!(await claimRefresh(env.DB, 'observations', 300))) return;
  try {
    // One core asset per tick; each revisited every 15 minutes, independent of backfills.
    const asset = CORE[Math.floor(now / 300) % CORE.length];
    const prices = (
      await env.DB.prepare('SELECT time,value FROM reference_prices WHERE asset=? ORDER BY time')
        .bind(asset)
        .all<Point>()
    ).results;
    await reconcileSignals(env, asset, 'reference', 'price', prices, now);
    for (const market of ['upbit', 'binance']) {
      const rows = (
        await env.DB.prepare(
          "SELECT time,close AS value FROM candles WHERE asset=? AND market=? AND interval='1d' AND close_time<=? ORDER BY time",
        )
          .bind(asset, market, now)
          .all<Point>()
      ).results;
      await reconcileSignals(env, asset, market, 'price', rows, now);
    }
    const mvrv = await readNetworkSeries(env.DB, asset, 'mvrv', now - 12 * DAY, now, 100);
    await reconcileSignals(env, asset, 'coinmetrics', 'mvrv', mvrv.data, now);
    const funding = (
      await env.DB.prepare(
        "SELECT time,value FROM derivative_series WHERE asset=? AND metric='funding' AND time>=? AND time<=? ORDER BY time",
      )
        .bind(asset, now - 12 * DAY, now)
        .all<Point>()
    ).results;
    await reconcileSignals(env, asset, 'bybit', 'funding', funding, now);
    await success(env.DB, 'observations', now);
  } catch (e) {
    await failure(env.DB, 'observations', e);
  }
}
export async function refreshBriefing(env: Env) {
  const kst = new Date((epoch() + 9 * 3600) * 1000);
  if (kst.getUTCHours() * 60 + kst.getUTCMinutes() < 550) return;
  const date = kst.toISOString().slice(0, 10);
  if (await env.DB.prepare('SELECT id FROM daily_briefings WHERE id=?').bind(date).first()) return;
  if (!(await claimRefresh(env.DB, 'briefing:' + date, 55))) return;
  try {
    await buildDailyBriefing(env);
  } catch (e) {
    await failure(env.DB, 'briefing', e);
  }
}

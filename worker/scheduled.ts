import { ASSETS } from '../shared/catalog';
import { DAY, zStep, type ZState } from '../shared/math';
import type { Asset, Market } from '../shared/types';
import { bitviewPage, getQuote, getRecentCandles } from './providers';
import {
  claimRefresh,
  epoch,
  failure,
  putState,
  readState,
  success,
  QUOTE_REFRESH_SECONDS,
  type Env,
} from './storage';
import { updateDominance, updateStable } from './dominance';
interface Build {
  generation: string;
  cursor: number;
  versions: Record<string, number> | null;
  n: number;
  mean: number;
  m2: number;
  start: number | null;
}
async function rawSample(env: Env, key: string, data: unknown) {
  await env.DB.prepare(
    'INSERT OR REPLACE INTO raw_samples(id,source,fetched_at,body) VALUES(?,?,?,?)',
  )
    .bind(key, key, epoch(), JSON.stringify(data))
    .run();
}

async function writeOnchain(
  env: Env,
  generation: string,
  rows: { time: number; data: Record<string, number | null> }[],
  state: ZState,
) {
  const statements: D1PreparedStatement[] = [];
  let s = state;
  for (const row of rows) {
    const next = zStep(s, row.data.market_cap, row.data.realized_cap);
    s = next.state;
    row.data.mvrv_z = next.value;
    row.data.mvrv_source = row.data.mvrv;
    row.data.nupl_source = row.data.nupl;
    const mc = row.data.market_cap,
      rc = row.data.realized_cap;
    row.data.mvrv = mc && rc && mc > 0 && rc > 0 ? mc / rc : null;
    row.data.nupl = mc && rc && mc > 0 && rc > 0 ? (mc - rc) / mc : null;
    statements.push(
      env.DB.prepare(
        'INSERT INTO onchain(generation,time,data,n,mean,m2,fetched_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(generation,time) DO UPDATE SET data=excluded.data,n=excluded.n,mean=excluded.mean,m2=excluded.m2,fetched_at=excluded.fetched_at WHERE onchain.data!=excluded.data OR onchain.n!=excluded.n OR onchain.mean!=excluded.mean OR onchain.m2!=excluded.m2',
      ).bind(generation, row.time, JSON.stringify(row.data), s.n, s.mean, s.m2, epoch()),
    );
  }
  for (let i = 0; i < statements.length; i += 20) await env.DB.batch(statements.slice(i, i + 20));
  return s;
}
export async function updateOnchain(env: Env) {
  let build = await readState<Build | null>(env.DB, 'onchain_build', null);
  const generation = await readState<string | null>(env.DB, 'onchain_generation', null);
  if (!generation && !build) {
    build = {
      generation: 'auto-' + epoch(),
      cursor: 0,
      versions: null,
      n: 0,
      mean: 0,
      m2: 0,
      start: null,
    };
  }
  if (build) {
    const page = await bitviewPage(env.BITVIEW_BASE_URL, build.cursor, 32);
    await rawSample(env, 'bitview', page.raw);
    if (build.versions && JSON.stringify(build.versions) !== JSON.stringify(page.versions)) {
      await putState(env.DB, 'onchain_build', {
        generation: 'auto-' + epoch(),
        cursor: 0,
        versions: null,
        n: 0,
        mean: 0,
        m2: 0,
        start: null,
      });
      return;
    }
    const s = await writeOnchain(env, build.generation, page.rows, build);
    const start = build.start ?? page.rows[0]?.time ?? null;
    if (page.finished) {
      const latest = await env.DB.prepare(
        'SELECT time FROM onchain WHERE generation=? ORDER BY time DESC LIMIT 1',
      )
        .bind(build.generation)
        .first<{ time: number }>();
      if (!latest) throw new Error('Rebuilt history is empty');
      const firstValid = await env.DB.prepare(
        'SELECT time FROM onchain WHERE generation=? AND n=1 ORDER BY time LIMIT 1',
      )
        .bind(build.generation)
        .first<{ time: number }>();
      await env.DB.batch([
        env.DB.prepare('INSERT OR REPLACE INTO state(key,value) VALUES (?,?)').bind(
          'onchain_generation',
          JSON.stringify(build.generation),
        ),
        env.DB.prepare('INSERT OR REPLACE INTO state(key,value) VALUES (?,?)').bind(
          'onchain_versions',
          JSON.stringify(page.versions),
        ),
        env.DB.prepare('INSERT OR REPLACE INTO state(key,value) VALUES (?,?)').bind(
          'onchain_history_start',
          JSON.stringify(start),
        ),
        env.DB.prepare('INSERT OR REPLACE INTO state(key,value) VALUES (?,?)').bind(
          'onchain_calculation_start',
          JSON.stringify(firstValid?.time ?? null),
        ),
        env.DB.prepare('DELETE FROM state WHERE key=?').bind('onchain_build'),
      ]);
      await success(env.DB, 'bitview', latest.time);
    } else
      await putState(env.DB, 'onchain_build', {
        generation: build.generation,
        cursor: page.next,
        versions: page.versions,
        ...s,
        start,
      });
    return;
  }
  const last = await env.DB.prepare(
    'SELECT time FROM onchain WHERE generation=? ORDER BY time DESC LIMIT 1',
  )
    .bind(generation)
    .first<{ time: number }>();
  const start = Math.min(epoch() - 8 * DAY, (last?.time ?? epoch()) - 2 * DAY);
  const date = new Date(start * 1000).toISOString().slice(0, 10);
  const page = await bitviewPage(env.BITVIEW_BASE_URL, date, 16);
  await rawSample(env, 'bitview', page.raw);
  const versions = await readState(env.DB, 'onchain_versions', {});
  if (JSON.stringify(versions) !== JSON.stringify(page.versions)) {
    await putState(env.DB, 'onchain_build', {
      generation: 'auto-' + epoch(),
      cursor: 0,
      versions: null,
      n: 0,
      mean: 0,
      m2: 0,
      start: null,
    });
    return;
  }
  if (!page.rows.length) throw new Error('No closed onchain observations');
  const previous = await env.DB.prepare(
    'SELECT n,mean,m2 FROM onchain WHERE generation=? AND time<? ORDER BY time DESC LIMIT 1',
  )
    .bind(generation, page.rows[0].time)
    .first<ZState>();
  await writeOnchain(env, generation!, page.rows, previous ?? { n: 0, mean: 0, m2: 0 });
  await success(env.DB, 'bitview', page.rows.at(-1)!.time);
}
export async function updatePrice(env: Env, asset: Asset, market: Market, interval: '1h' | '1d') {
  const step = interval === '1h' ? 3600 : DAY;
  const latest = await env.DB.prepare(
    'SELECT time FROM candles WHERE asset=? AND market=? AND interval=? ORDER BY time DESC LIMIT 1',
  )
    .bind(asset, market, interval)
    .first<{ time: number }>();
  const rows = await getRecentCandles(
    asset,
    market,
    interval,
    latest
      ? Math.max(latest.time - 2 * step, interval === '1h' ? epoch() - 90 * DAY : 0)
      : undefined,
  );
  const now = epoch();
  const priorHistory = await readState<{
    first: number;
    last: number;
    rows: number | null;
    archived?: boolean;
  } | null>(env.DB, 'history:' + asset + ':' + market + ':' + interval, null);
  const key = asset + ':' + market + ':' + interval;
  const historyKey = 'history:' + key;
  const historyStatement = priorHistory?.archived
    ? env.DB.prepare(
        "INSERT OR REPLACE INTO state(key,value) SELECT ?,json_object('first',?,'last',MAX(time),'rows',?,'archived',json('true'),'asset',?,'market',?,'interval',?,'fetched',?) FROM candles WHERE asset=? AND market=? AND interval=?",
      ).bind(
        historyKey,
        interval === '1h'
          ? Math.max(priorHistory.first, Math.ceil((now - 90 * DAY) / 3600) * 3600)
          : priorHistory.first,
        // Rolling archives expire in chunks; do not publish an uncounted total.
        interval === '1h' || priorHistory.rows === null
          ? null
          : priorHistory.rows + rows.filter((c) => c.time > priorHistory.last).length,
        asset,
        market,
        interval,
        now,
        asset,
        market,
        interval,
      )
    : env.DB.prepare(
        "INSERT OR REPLACE INTO state(key,value) SELECT ?,json_object('first',MIN(time),'last',MAX(time),'rows',COUNT(*),'asset',?,'market',?,'interval',?,'fetched',?) FROM candles WHERE asset=? AND market=? AND interval=?",
      ).bind(historyKey, asset, market, interval, now, asset, market, interval);
  // D1 executes a batch as one ordered transaction. Metadata observes the preceding
  // upserts and a failure keeps the previous raw sample, history, and success state.
  await env.DB.batch([
    env.DB.prepare(
      'INSERT OR REPLACE INTO raw_samples(id,source,fetched_at,body) VALUES(?,?,?,?)',
    ).bind(key, key, now, JSON.stringify({ normalizedSourceSample: rows })),
    ...rows.map((c) =>
      env.DB.prepare(
        'INSERT INTO candles(asset,market,interval,time,open,high,low,close,volume,close_time,fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(asset,market,interval,time) DO UPDATE SET open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,volume=excluded.volume,close_time=excluded.close_time,fetched_at=excluded.fetched_at WHERE candles.open!=excluded.open OR candles.high!=excluded.high OR candles.low!=excluded.low OR candles.close!=excluded.close OR candles.volume!=excluded.volume OR candles.close_time!=excluded.close_time',
      ).bind(
        asset,
        market,
        interval,
        c.time,
        c.open,
        c.high,
        c.low,
        c.close,
        c.volume,
        c.closeTime,
        now,
      ),
    ),
    historyStatement,
    env.DB.prepare(
      'INSERT INTO ingestion(key,last_attempt,last_success,data_as_of,failures,error,next_attempt) VALUES (?,?,?,?,0,NULL,0) ON CONFLICT(key) DO UPDATE SET last_attempt=excluded.last_attempt,last_success=excluded.last_success,data_as_of=excluded.data_as_of,failures=0,error=NULL,next_attempt=0',
    ).bind(key, now, now, rows.at(-1)?.time ?? 0),
  ]);
}
export async function scheduled(env: Env) {
  const now = epoch();
  const enabled = ASSETS.filter((a) => env.ENABLED_ASSETS.split(',').includes(a.id));
  const build = await readState<Build | null>(env.DB, 'onchain_build', null);
  const jobs: { key: string; every: number; maxLag?: number; run: () => Promise<unknown> }[] = [
    { key: 'bitview', every: build ? 60 : 3600, maxLag: 3 * DAY, run: () => updateOnchain(env) },
    { key: 'defillama', every: 21600, maxLag: 3 * DAY, run: () => updateStable(env) },
    {
      key: 'coinlore',
      every: 3600,
      maxLag: 7200,
      run: async () =>
        (await claimRefresh(env.DB, 'dominance', 300)) ? updateDominance(env) : undefined,
    },
  ];
  for (const { id } of enabled)
    for (const market of ['binance', 'upbit'] as Market[]) {
      jobs.push(
        {
          key: id + ':' + market + ':1h',
          every: 3600,
          maxLag: 7200,
          run: () => updatePrice(env, id, market, '1h'),
        },
        {
          key: id + ':' + market + ':1d',
          every: 3600,
          maxLag: 2 * DAY,
          run: () => updatePrice(env, id, market, '1d'),
        },
      );
    }
  jobs.push({
    key: 'maintenance',
    every: 3600,
    run: async () => {
      await env.DB.prepare(
        'DELETE FROM candles WHERE rowid IN (SELECT rowid FROM candles WHERE interval=? AND time<? LIMIT 200)',
      )
        .bind('1h', now - 90 * DAY)
        .run();
      const active = await readState(env.DB, 'onchain_generation', '');
      await env.DB.prepare(
        'DELETE FROM price_archive WHERE rowid IN (SELECT rowid FROM price_archive WHERE interval=? AND end<? LIMIT 20)',
      )
        .bind('1h', now - 90 * DAY)
        .run();
      await env.DB.prepare(
        'DELETE FROM onchain WHERE rowid IN (SELECT rowid FROM onchain WHERE generation!=? AND generation!=? LIMIT 200)',
      )
        .bind(active, build?.generation || '')
        .run();
      await success(env.DB, 'maintenance', now);
    },
  });
  const states = (
    await env.DB.prepare('SELECT * FROM ingestion').all<{
      key: string;
      last_attempt: number;
      last_success: number;
      data_as_of: number;
      next_attempt: number;
    }>()
  ).results;
  const eligible = jobs.filter((j) => {
    const s = states.find((s) => s.key === j.key);
    if (s?.next_attempt) return s.next_attempt <= now;
    const every = s && j.maxLag && now - s.data_as_of > j.maxLag ? 60 : j.every;
    return !s || ((s.next_attempt || 0) <= now && now - (s.last_attempt || 0) >= every);
  });
  if (eligible.length) {
    const job = eligible.sort(
      (a, b) =>
        (states.find((s) => s.key === a.key)?.last_attempt || 0) -
        (states.find((s) => s.key === b.key)?.last_attempt || 0),
    )[0];
    try {
      await env.DB.prepare(
        'INSERT INTO ingestion(key,last_attempt) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET last_attempt=excluded.last_attempt',
      )
        .bind(job.key, now)
        .run();
      await job.run();
    } catch (e) {
      await failure(env.DB, job.key, e);
    }
    return;
  }
  // One small quote refresh per invocation; page requests use the same persistent snapshot.
  const market: Market = Math.floor(now / 60) % 2 ? 'upbit' : 'binance';
  const asset = enabled[Math.floor(now / 120) % enabled.length]?.id;
  if (!asset) return;
  const quoteState = states.find((s) => s.key === 'quote:' + asset + ':' + market);
  if (quoteState && quoteState.next_attempt > now) return;
  if (quoteState?.last_success && now - quoteState.last_success < QUOTE_REFRESH_SECONDS) return;
  if (!(await claimRefresh(env.DB, 'quote:' + asset + ':' + market, QUOTE_REFRESH_SECONDS))) return;
  try {
    const q = await getQuote(asset, market);
    await env.DB.prepare('INSERT OR REPLACE INTO snapshots(key,data,fetched_at) VALUES(?,?,?)')
      .bind('quote:' + asset + ':' + market, JSON.stringify(q), now)
      .run();
    await success(env.DB, 'quote:' + asset + ':' + market, q.time);
  } catch (e) {
    await failure(env.DB, 'quote:' + asset + ':' + market, e);
  }
}

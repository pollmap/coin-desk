import type { ResearchMarket } from '../../shared/report-types';
import { errorCode, ProviderHttpError, seconds, type Observation } from './core';

export async function saveObservations(db: D1Database, rows: Observation[]) {
  for (let offset = 0; offset < rows.length; offset += 100)
    await db.batch(
      rows.slice(offset, offset + 100).map((r) =>
        db
          .prepare(
            `INSERT INTO onchain_observations(id,scope,entity_id,metric,unit,provider,observed_at,fetched_at,period_start,period_end,status,value,payload,content_hash)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at,status=excluded.status,value=excluded.value,payload=excluded.payload,content_hash=excluded.content_hash
      WHERE onchain_observations.content_hash<>excluded.content_hash`,
          )
          .bind(
            r.id,
            r.reportScope,
            r.entityId,
            r.metric,
            r.unit,
            r.provider,
            r.observedAt,
            seconds(r.fetchedAt),
            r.periodStart ? seconds(r.periodStart) : null,
            r.periodEnd ? seconds(r.periodEnd) : null,
            r.status,
            r.value,
            JSON.stringify(r),
            r.contentHash,
          ),
      ),
    );
}
export async function saveMarkets(db: D1Database, rows: ResearchMarket[], at: number) {
  for (let offset = 0; offset < rows.length; offset += 100)
    await db.batch(
      rows.slice(offset, offset + 100).map((r) =>
        db
          .prepare(
            `INSERT INTO onchain_markets(id,chain,network,kind,ticker,payload,verified_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,ticker=excluded.ticker,payload=excluded.payload,verified_at=excluded.verified_at`,
          )
          .bind(r.id, r.chain, r.network, r.kind, r.ticker, JSON.stringify(r), at),
      ),
    );
}
export interface ProviderState {
  provider: string;
  scope: string;
  last_attempt: number;
  last_success: number | null;
  data_as_of: number | null;
  error_code: string | null;
  next_attempt: number;
  checkpoint: string | null;
}
export async function providerState(db: D1Database, provider: string, scope: string) {
  return db
    .prepare('SELECT * FROM onchain_provider_state WHERE provider=? AND scope=?')
    .bind(provider, scope)
    .first<ProviderState>();
}
export async function providerSuccess(
  db: D1Database,
  provider: string,
  scope: string,
  at: number,
  asOf: number | null,
  checkpoint: unknown = null,
) {
  await db
    .prepare(
      `INSERT INTO onchain_provider_state(provider,scope,last_attempt,last_success,data_as_of,error_code,next_attempt,checkpoint) VALUES(?,?,?,?,?,NULL,0,?)
    ON CONFLICT(provider,scope) DO UPDATE SET last_attempt=excluded.last_attempt,last_success=excluded.last_success,data_as_of=excluded.data_as_of,error_code=NULL,next_attempt=0,checkpoint=excluded.checkpoint`,
    )
    .bind(provider, scope, at, at, asOf, checkpoint === null ? null : JSON.stringify(checkpoint))
    .run();
}
export async function providerFailure(
  db: D1Database,
  provider: string,
  scope: string,
  at: number,
  error: unknown,
  random = Math.random,
) {
  const previous = await providerState(db, provider, scope);
  const checkpoint = previous?.checkpoint ? JSON.parse(previous.checkpoint) : {};
  const failures = Math.min(8, Math.max(0, Number(checkpoint._retryFailures) || 0) + 1);
  const retry = error instanceof ProviderHttpError ? error.retryAfterSeconds : null;
  const wait =
    retry ??
    (/401|403/.test(String(error))
      ? 21600
      : Math.min(
          21600,
          Math.ceil(300 * 2 ** (failures - 1) * (0.8 + Math.max(0, Math.min(1, random())) * 0.4)),
        ));
  await db
    .prepare(
      `INSERT INTO onchain_provider_state(provider,scope,last_attempt,error_code,next_attempt,checkpoint) VALUES(?,?,?,?,?,?)
    ON CONFLICT(provider,scope) DO UPDATE SET last_attempt=excluded.last_attempt,error_code=excluded.error_code,next_attempt=excluded.next_attempt,checkpoint=excluded.checkpoint`,
    )
    .bind(
      provider,
      scope,
      at,
      errorCode(error),
      at + Math.max(wait, 60),
      JSON.stringify({ ...checkpoint, _retryFailures: failures }),
    )
    .run();
}
export async function collectorLease(db: D1Database, owner: string, at: number, seconds = 600) {
  const result = await db
    .prepare(
      `INSERT INTO onchain_provider_state(provider,scope,last_attempt,next_attempt,checkpoint) VALUES('collector','research',?,?,?)
    ON CONFLICT(provider,scope) DO UPDATE SET last_attempt=excluded.last_attempt,next_attempt=excluded.next_attempt,checkpoint=excluded.checkpoint
    WHERE onchain_provider_state.next_attempt<=?`,
    )
    .bind(at, at + seconds, JSON.stringify({ owner }), at)
    .run();
  return result.meta.changes > 0;
}
export async function releaseCollectorLease(db: D1Database, owner: string, at: number) {
  await db
    .prepare(
      "UPDATE onchain_provider_state SET next_attempt=? WHERE provider='collector' AND scope='research' AND json_extract(checkpoint,'$.owner')=?",
    )
    .bind(at, owner)
    .run();
}

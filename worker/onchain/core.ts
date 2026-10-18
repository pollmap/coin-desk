import Decimal from 'decimal.js';
import type { ReportEvidence, ReportScope } from '../../shared/report-types';

export const D = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_EVEN });
export const RESEARCH_VERSION = 'research-v1';
export const TEMPLATE_VERSION = 'ko-observations-v1';
export const DAY = 86400;
export const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
export const seconds = (value: string) => Math.floor(Date.parse(value) / 1000);
export const nowSeconds = () => Math.floor(Date.now() / 1000);
export function decimal(value: unknown, { positive = false }: { positive?: boolean } = {}): string {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    String(value).length > 160 ||
    !/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(String(value))
  )
    throw new Error('INVALID_DECIMAL');
  const number = new D(value);
  if (
    !number.isFinite() ||
    number.abs().gte('1e100') ||
    (!number.isZero() && number.e < -100) ||
    (positive && !number.gt(0))
  )
    throw new Error('INVALID_DECIMAL');
  return number.toFixed();
}
export const percentageChange = (current: string, previous: string): string | null =>
  new D(previous).eq(0) ? null : new D(current).div(previous).minus(1).mul(100).toFixed(12);
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b, 'en'))
        .map(([k, v]) => JSON.stringify(k) + ':' + stableJson(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export async function hash(value: unknown) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(value))),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export interface Observation extends ReportEvidence {
  provider: string;
  reportScope: ReportScope;
  observedAt: number;
}
export type ObservationInput = Omit<Observation, 'id' | 'contentHash' | 'calculationVersion'>;
export async function observation(input: ObservationInput): Promise<Observation> {
  const source = new URL(input.sourceUrl);
  if (
    source.protocol !== 'https:' ||
    source.username ||
    source.password ||
    source.search ||
    source.hash
  )
    throw new Error('INVALID_SOURCE_URL');
  if (
    !Number.isSafeInteger(input.observedAt) ||
    input.observedAt < 0 ||
    input.observedAt > seconds(input.fetchedAt) + 300
  )
    throw new Error('INVALID_OBSERVATION_TIME');
  if (input.value !== null) input = { ...input, value: decimal(input.value) };
  const identity = [
    input.reportScope,
    input.entityId,
    input.metric,
    input.unit,
    input.provider,
    input.observedAt,
  ];
  const id = 'obs-' + (await hash(identity)).slice(0, 32);
  const data = { ...input, id, calculationVersion: RESEARCH_VERSION };
  return { ...data, contentHash: await hash(data) };
}
export function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/429|RATE_LIMIT/.test(message)) return 'PROVIDER_RATE_LIMIT';
  if (/401|403/.test(message)) return 'PROVIDER_ACCESS';
  if (/timeout|aborted|TIMEOUT/i.test(message)) return 'PROVIDER_TIMEOUT';
  if (/SQLITE_FULL|space/i.test(message)) return 'STORAGE_FULL';
  if (/INVALID_|MISMATCH|INCOMPLETE/.test(message)) return 'SOURCE_VALIDATION';
  return 'PROVIDER_UNAVAILABLE';
}
export class ProviderHttpError extends Error {
  constructor(
    public status: number,
    public retryAfterSeconds: number | null,
  ) {
    super('PROVIDER_HTTP_' + status);
  }
}
/** No request URL or credentials are propagated into error messages. */
export async function boundedJson(
  url: string,
  options: { fetcher?: typeof fetch; headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<unknown> {
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    ![
      'api.coinlore.net',
      'api.coingecko.com',
      'api.llama.fi',
      'sentry.exchange.grpc-web.injective.network',
    ].includes(parsed.hostname)
  )
    throw new Error('INVALID_PROVIDER');
  const timeout = AbortSignal.timeout(20000);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  const response = await (options.fetcher ?? fetch)(url, {
    signal,
    redirect: 'error',
    headers: { Accept: 'application/json', ...options.headers },
  });
  if (!response.ok) {
    const retry = response.headers.get('Retry-After');
    const wait =
      retry === null
        ? NaN
        : /^\d+$/.test(retry)
          ? Number(retry)
          : Math.ceil((Date.parse(retry) - Date.now()) / 1000);
    throw new ProviderHttpError(
      response.status,
      Number.isFinite(wait) && wait >= 0 ? Math.min(wait, 604800) : null,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('INVALID_EMPTY_RESPONSE');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > 4 * 1024 * 1024) throw new Error('INVALID_RESPONSE_SIZE');
      chunks.push(item.value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const c of chunks) {
    joined.set(c, offset);
    offset += c.length;
  }
  // Node 24 exposes the original numeric token. Keep provider decimals exact,
  // rather than first rounding them through a JavaScript binary float.
  return parseProviderJson(new TextDecoder().decode(joined));
}
export function parseProviderJson(text: string): unknown {
  const parse = JSON.parse as (
    text: string,
    reviver: (key: string, value: unknown, context?: { source?: string }) => unknown,
  ) => unknown;
  return parse(text, (_key, value, context) => {
    if (typeof value !== 'number') return value;
    if (!context?.source) throw new Error('INVALID_JSON_DECIMAL_RUNTIME');
    return context.source;
  });
}
export const object = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_OBJECT');
  return value as Record<string, any>;
};

import {
  ORIGINAL_RAINBOW_BASELINE,
  ORIGINAL_RAINBOW_FORMULA,
  ORIGINAL_RAINBOW_FORMULA_HASH,
  ORIGINAL_RAINBOW_SOURCE,
  ORIGINAL_RAINBOW_SCRIPT,
  ORIGINAL_RAINBOW_SCRIPT_HASH,
  originalRainbowReferenceValid,
  type OriginalRainbowReference,
} from '../shared/btc-rainbow-original';

export const ORIGINAL_REFERENCE_MAX_HTML_BYTES = 1_048_576;
const MAX_SCRIPT_BYTES = 262_144;
export async function originalReferenceHash(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

/** Parse data passed specifically to the verified Original component. No script is executed. */
export function originalDatesFromPage(html: string): string[] {
  if (new TextEncoder().encode(html).length > ORIGINAL_REFERENCE_MAX_HTML_BYTES)
    throw new Error('original_reference_body_limit');
  const pieces: string[] = [];
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const push = /^self\.__next_f\.push\(([\s\S]*)\)\s*;?$/.exec(match[1].trim());
    if (!push) continue;
    const value: unknown = JSON.parse(push[1]);
    if (Array.isArray(value) && value[0] === 1 && typeof value[1] === 'string')
      pieces.push(value[1]);
  }
  const records = new Map<string, string>();
  for (const line of pieces.join('').split('\n')) {
    const match = /^([a-f0-9]+):([\s\S]*)$/.exec(line);
    if (!match) continue;
    if (records.has(match[1])) throw new Error('original_reference_duplicate_record');
    records.set(match[1], match[2]);
  }
  const parsed = new Map<string, unknown>();
  for (const [key, value] of records) {
    if (/^[\[{]/.test(value)) {
      try {
        parsed.set(key, JSON.parse(value));
      } catch {
        /* non-JSON stream record */
      }
    }
  }
  let visits = 0;
  function find(value: unknown, predicate: (v: unknown[]) => boolean): unknown[] | undefined {
    if (++visits > 100000) throw new Error('original_reference_structure_limit');
    if (Array.isArray(value)) {
      if (predicate(value)) return value;
      for (const item of value) {
        const result = find(item, predicate);
        if (result) return result;
      }
    } else if (value && typeof value === 'object') {
      for (const item of Object.values(value)) {
        const result = find(item, predicate);
        if (result) return result;
      }
    }
    return undefined;
  }
  let original: unknown[] | undefined;
  for (const value of parsed.values()) {
    original = find(
      value,
      (v) => v[0] === '$' && (v[3] as { id?: string })?.id === 'rainbow-chart-original',
    );
    if (original) break;
  }
  if (!original) throw new Error('original_reference_component_missing');
  const component = find(
    original,
    (v) =>
      v[0] === '$' &&
      typeof v[1] === 'string' &&
      /^\$L[a-f0-9]+$/.test(v[1]) &&
      typeof (v[3] as { data?: unknown })?.data === 'string',
  );
  if (!component) throw new Error('original_reference_data_missing');
  const moduleRecord = records.get((component[1] as string).slice(2));
  if (!moduleRecord?.startsWith('I')) throw new Error('original_reference_module_missing');
  const module = JSON.parse(moduleRecord.slice(1));
  if (
    module[0] !== 79555 ||
    !Array.isArray(module[1]) ||
    !module[1].includes(new URL(ORIGINAL_RAINBOW_SCRIPT).pathname)
  )
    throw new Error('original_reference_module_changed');
  const path = (component[3] as { data: string }).data;
  if (!/^\$[a-f0-9]+(?::[a-zA-Z0-9_-]+){1,16}$/.test(path))
    throw new Error('original_reference_data_path');
  const [key, ...parts] = path.slice(1).split(':');
  let data: unknown = parsed.get(key);
  for (const part of parts) {
    // RSC references use React element property names; the wire element is ["$", type, key, props].
    if (part === 'props' && Array.isArray(data) && data[0] === '$') {
      data = data[3];
      continue;
    }
    if (
      ['__proto__', 'constructor', 'prototype'].includes(part) ||
      !data ||
      typeof data !== 'object' ||
      !Object.hasOwn(data, part)
    )
      throw new Error('original_reference_data_path');
    data = (data as Record<string, unknown>)[part];
  }
  if (!Array.isArray(data) || data.length > 15000)
    throw new Error('original_reference_rows_invalid');
  const dates: string[] = [];
  let previous = '';
  for (const value of data) {
    const date = (value as { time?: unknown })?.time;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= previous)
      throw new Error('original_reference_dates_invalid');
    previous = date;
    if (date >= '2012-01-01') dates.push(date);
  }
  return dates;
}

export async function verifyOriginalReference(
  reference: unknown,
): Promise<OriginalRainbowReference> {
  if (
    !originalRainbowReferenceValid(reference) ||
    (await originalReferenceHash(ORIGINAL_RAINBOW_FORMULA)) !== ORIGINAL_RAINBOW_FORMULA_HASH ||
    (await originalReferenceHash(reference.dates.join('\n'))) !== reference.snapshotId
  )
    throw new Error('original_reference_invalid');
  return reference;
}

export async function createOriginalReference(
  dates: string[],
  previous = ORIGINAL_RAINBOW_BASELINE,
  now = Math.floor(Date.now() / 1000),
): Promise<OriginalRainbowReference> {
  await verifyOriginalReference(previous);
  const snapshotId = await originalReferenceHash(dates.join('\n'));
  const appendOnly =
    dates.length >= previous.dates.length && previous.dates.every((d, i) => dates[i] === d);
  // Backdated additions/removals change row ordinals. Preserve the prior version instead of reinterpreting it.
  const modelVersion = appendOnly
    ? previous.modelVersion
    : `bc-original-${ORIGINAL_RAINBOW_FORMULA_HASH.slice(0, 12)}-${snapshotId.slice(0, 12)}`;
  return verifyOriginalReference({
    schemaVersion: 1,
    modelVersion,
    snapshotId,
    formulaHash: ORIGINAL_RAINBOW_FORMULA_HASH,
    sourceScriptHash: ORIGINAL_RAINBOW_SCRIPT_HASH,
    verifiedAt: now,
    dates: [...dates],
  });
}

async function boundedPublicGet(
  url: string,
  maxBytes: number,
  request: typeof fetch,
): Promise<Uint8Array> {
  const response = await request(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: {
      'User-Agent': 'BoriChart/0.38 public-reference-verification',
      Accept: 'text/html,application/javascript',
    },
  });
  if (!response.ok || !response.body) throw new Error('original_reference_upstream_unavailable');
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body.cancel();
    throw new Error('original_reference_body_limit');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error('original_reference_body_limit');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Background only. Unknown source code fails closed; never fetch from a public read request. */
export async function fetchOriginalReference(
  previous = ORIGINAL_RAINBOW_BASELINE,
  request: typeof fetch = fetch,
  now = Math.floor(Date.now() / 1000),
): Promise<OriginalRainbowReference> {
  const html = new TextDecoder().decode(
    await boundedPublicGet(ORIGINAL_RAINBOW_SOURCE, ORIGINAL_REFERENCE_MAX_HTML_BYTES, request),
  );
  const dates = originalDatesFromPage(html);
  const script = await boundedPublicGet(ORIGINAL_RAINBOW_SCRIPT, MAX_SCRIPT_BYTES, request);
  if ((await originalReferenceHash(script)) !== ORIGINAL_RAINBOW_SCRIPT_HASH)
    throw new Error('original_reference_source_changed');
  return createOriginalReference(dates, previous, now);
}

export {
  ORIGINAL_RAINBOW_BASELINE,
  originalRainbowVersionValid,
} from '../shared/btc-rainbow-original';

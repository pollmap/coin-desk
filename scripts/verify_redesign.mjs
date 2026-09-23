/** Read-only production audit. No upstream collection or DB writes are triggered. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = process.argv[2] || 'https://coin-desk.pages.dev';
const phase = process.argv[3] || 'after';
const histories = [
  ['BTC-price', 'reference?asset=BTC'],
  ['DOGE-price', 'reference?asset=DOGE'],
  ['ETH-price', 'reference?asset=ETH'],
  ['BTC-mvrv', 'series?metric=mvrv'],
  ['DOGE-mvrv', 'network?asset=DOGE&metric=mvrv'],
  ['ETH-mvrv', 'network?asset=ETH&metric=mvrv'],
];
const read = async (path) => {
  const res = await fetch(base + '/api/v1/' + path, { signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw Error(`${path}: ${res.status} ${(await res.text()).slice(0, 180)}`);
  return res.json();
};
const reports = [];
for (const [label, endpoint] of histories) {
  const rows = [];
  let cursor = null,
    range = null,
    meta = null;
  for (let i = 0; i < 40; i++) {
    const page = await read(
      endpoint +
        '&limit=1000' +
        (cursor === null ? '' : '&from=' + cursor) +
        (range ? '&to=' + range.to : ''),
    );
    range ??= page.range ?? null;
    meta ??= page.meta;
    rows.push(...page.data);
    if (page.nextCursor === null) break;
    if (page.nextCursor <= (cursor ?? -1)) throw Error('Non-advancing cursor');
    cursor = page.nextCursor;
    if (i === 39) throw Error('History incomplete');
  }
  if (
    !rows.length ||
    rows.some((r, i) => !Number.isFinite(r.value) || (i && r.time <= rows[i - 1].time))
  )
    throw Error('Invalid/duplicate/unsorted ' + label);
  if (phase === 'after' && !range) throw Error('Missing server-resolved range ' + label);
  reports.push({
    label,
    count: rows.length,
    first: rows[0],
    last: rows.at(-1),
    samples: [rows[0], rows[Math.floor(rows.length / 2)], rows.at(-1)],
    sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    range,
    source: meta.source,
    asOf: meta.dataAsOf,
  });
  console.log(
    label,
    rows.length,
    new Date(rows[0].time * 1000).toISOString().slice(0, 10),
    '→',
    new Date(rows.at(-1).time * 1000).toISOString().slice(0, 10),
  );
}
const status = await read('status');
const result = {
  checkedAt: new Date().toISOString(),
  base,
  histories: reports,
  automation: status.automation,
  health: status.health,
};
await mkdir('docs/evidence', { recursive: true });
if (phase === 'after') {
  const before = JSON.parse(await readFile('docs/evidence/redesign-before.json', 'utf8'));
  result.comparison = reports.map((r) => {
    const old = before.histories.find((o) => o.label === r.label);
    if (old.sha256 !== r.sha256)
      throw Error('Source history changed; inspect before accepting ' + r.label);
    return { label: r.label, identical: true };
  });
}
await writeFile(`docs/evidence/redesign-${phase}.json`, JSON.stringify(result, null, 2) + '\n');
console.log('Read-only audit recorded:', phase);

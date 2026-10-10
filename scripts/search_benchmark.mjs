import { mkdirSync, writeFileSync } from 'node:fs';
import { searchResponse } from '../server/search.mjs';
import { ASSET_REGISTRY } from '../server-dist/assets.mjs';
import { supportedSearchIndicators } from '../server-dist/search.mjs';
import { searchDocuments, chunkDocument, SEARCH_CATALOG_VERSION } from '../server-dist/search.mjs';
const tasks = ASSET_REGISTRY.slice(0, 50).flatMap((a) => [
  { q: `${a.name} 추세`, asset: a.id, metric: 'rsi' },
  {
    q: `${a.name} ${a.network?.metrics.CapMVRVCur ? '고평가' : 'RSI'}`,
    asset: a.id,
    metric: a.network?.metrics.CapMVRVCur ? 'net:mvrv' : 'rsi',
  },
]);
const results = [],
  durations = [];
for (const task of tasks) {
  const start = performance.now(),
    response = await searchResponse(new URLSearchParams({ q: task.q, limit: '5' }));
  durations.push(performance.now() - start);
  results.push({
    ...task,
    success: response.hits.some((h) => h.asset === task.asset && h.metric === task.metric),
    wrongAsset: response.hits.some((h) => h.asset !== task.asset),
    ids: response.hits.map((h) => h.id),
  });
}
const documents = searchDocuments();
mkdirSync('work/search-evaluation', { recursive: true });
writeFileSync(
  'work/search-evaluation/corpus.json',
  JSON.stringify({
    indexVersion: SEARCH_CATALOG_VERSION,
    documents,
    chunks: documents.flatMap(chunkDocument),
    tasks,
    baseline: results,
    allowedIndicators: Object.fromEntries(
      ASSET_REGISTRY.map((a) => [a.id, supportedSearchIndicators(a.id)]),
    ),
  }),
);
const coldMs = durations[0];
const report = {
  observedAt: new Date().toISOString(),
  taskDesign:
    'fixed first-50 roster assets × Korean purpose / metric; separate 150 exact-ID regression',
  tasks: tasks.length,
  top5Success: results.filter((r) => r.success).length,
  wrongAssetResults: results.filter((r) => r.wrongAsset).length,
  p95Ms: durations.sort((a, b) => a - b)[Math.ceil(durations.length * 0.95) - 1],
  coldMs,
  indexVersion: SEARCH_CATALOG_VERSION,
  failures: results.filter((r) => !r.success),
};
writeFileSync('work/search-evaluation/baseline.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (report.top5Success < 90 || report.wrongAssetResults) process.exitCode = 1;

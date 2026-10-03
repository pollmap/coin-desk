import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
const vite = await createServer({
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
});
try {
  const { INDICATORS_CATALOG } = await vite.ssrLoadModule('/shared/indicator-catalog.ts');
  const { guideArticle } = await vite.ssrLoadModule('/shared/learning-catalog.ts');
  const { guideLesson } = await vite.ssrLoadModule('/shared/guide-lessons.ts');
  const rows = INDICATORS_CATALOG.map((d) => {
    const article = guideArticle(d.guide);
    if (!article) throw Error(d.id + ' missing explanation');
    const lesson = guideLesson(article);
    const implementation = d.id.startsWith('net:')
      ? 'shared/network-catalog.ts; worker/network-data.ts'
      : d.id.startsWith('btc:')
        ? 'shared/catalog.ts; worker/providers.ts'
        : d.id.startsWith('futures:')
          ? 'shared/derivative-contracts.ts; worker/derivatives.ts'
          : d.id.startsWith('chain:')
            ? 'worker/ethereum-context.ts'
            : d.id === 'view:rainbow'
              ? 'shared/history-bands.ts; src/IndicatorWorkspace.tsx'
              : d.id === 'view:btc_rainbow'
                ? 'shared/btc-rainbow.ts; src/IndicatorWorkspace.tsx'
                : ['view:ribbon', 'view:bb'].includes(d.id)
                  ? 'shared/indicators.ts; src/IndicatorWorkspace.tsx'
                  : d.id.startsWith('view:')
                    ? 'shared/advanced-analysis.ts; src/IndicatorWorkspace.tsx; src/AnalysisLab.tsx'
                    : 'shared/indicators.ts; src/IndicatorWorkspace.tsx';
    return {
      ...d,
      guideExample: lesson.example,
      guideMethod: lesson.method,
      implementation,
      verification: d.id.startsWith('btc:')
        ? '원천 제공값: 내부 재계산 불가, 원천 정의·표시 대조'
        : '카탈로그·설명 연결 대조; 계산별 독립 검사는 감사 README 참조',
    };
  });
  await mkdir('docs/audit-22', { recursive: true });
  await writeFile(
    'docs/audit-22/indicator-definitions.json',
    JSON.stringify({ version: '0.22.0', count: rows.length, indicators: rows }, null, 2) + '\n',
  );
  const clean = (s) => String(s).replaceAll('|', '/').replaceAll('\n', ' ');
  await writeFile(
    'docs/audit-22/indicator-definitions.md',
    '# 지표 정의 대조표\n\n지원 범위는 카탈로그이며 실시간 원천 정상 여부와 구분합니다. 원천 제공값을 독립 재계산했다고 표현하지 않습니다. 숫자 예시는 현재 시세가 아닙니다.\n\n| 지표 | 코인 | 원천·단위 | 공식 | 계산 위치 |\n|---|---|---|---|---|\n' +
      rows
        .map(
          (d) =>
            `| ${clean(d.id + ' ' + d.title)} | ${d.assets.join(', ')} | ${clean(d.source + ' · ' + d.unit)} | ${clean(d.formula)} | ${clean(d.implementation)} |`,
        )
        .join('\n') +
      '\n',
  );
  console.log(
    JSON.stringify({
      count: rows.length,
      completeExplanations: rows.every((d) => d.guideExample.length && d.guideMethod.length),
    }),
  );
} finally {
  await vite.close();
}

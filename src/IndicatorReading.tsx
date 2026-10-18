import { Link } from 'react-router-dom';
import type { Asset } from '../shared/types';
import {
  guideArticle,
  guideForMetric,
  guideHref,
  type GuideArticle,
} from '../shared/learning-catalog';
import { guideReading, readingLesson } from '../shared/guide-reading';
import { IndicatorConcept } from './IndicatorConcept';
import { PatternExample } from './PatternExample';
import './indicator-reading.css';

/** Same reading order in a chart panel and dictionary; no observation/API requests. */
export function GuideReadingBody({
  article,
  asset,
  anchors = false,
}: {
  article: GuideArticle;
  asset: Asset;
  anchors?: boolean;
}) {
  const reading = guideReading(article.id);
  const lesson = readingLesson(article, asset);
  const anchor = (id: string) => (anchors ? { id, tabIndex: -1 } : {});
  return (
    <div className="indicator-reading">
      <section {...anchor('meaning')}>
        <h2>무엇을 보나요</h2>
        <p className="reading-meaning">{reading.meaning}</p>
        <IndicatorConcept metric={article.id} />
        {article.action.kind === 'pattern' && <PatternExample id={article.action.id} />}
        <h3>이렇게 읽으세요</h3>
        <p>{reading.lookFor}</p>
        {lesson.reading.length > 0 && article.id !== 'rainbow' && (
          <ReadingTable rows={lesson.reading} />
        )}
      </section>
      <section {...anchor('example')} className="guide-example">
        <h2>{lesson.procedural ? '사용 예시' : '숫자로 읽어보기'}</h2>
        {!lesson.procedural && (
          <p className="guide-example-label">이해를 위한 가상 예시 · 현재 시세 아님</p>
        )}
        <ol>
          {lesson.example.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
        <p className="guide-conclusion">{lesson.conclusion}</p>
      </section>
      <section {...anchor('method')} className="guide-method">
        <details>
          <summary>
            {lesson.procedural ? '사용 방법 자세히 보기' : '계산식·용어 자세히 보기'}
          </summary>
          <ol className={lesson.procedural ? 'guide-steps' : 'guide-formula'}>
            {lesson.method.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          {lesson.terms.length > 0 && (
            <dl className="guide-terms">
              {lesson.terms.map(([term, meaning]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{meaning}</dd>
                </div>
              ))}
            </dl>
          )}
          {article.id === 'rainbow' && (
            <ReadingTable rows={lesson.reading} caption="위치 점수 z에 따른 색 구간" />
          )}
        </details>
      </section>
      <section {...anchor('limits')} className="guide-caution">
        <details>
          <summary>주의할 점</summary>
          <p className="reading-distinction">{reading.distinction}</p>
          <p>{article.caution}</p>
        </details>
      </section>
      {article.source && (
        <section className="reading-source">
          <details>
            <summary>출처 읽기</summary>
            <a href={article.source} target="_blank" rel="noopener noreferrer">
              {sourceLabel(article.source)} 원문 ↗
            </a>
          </details>
        </section>
      )}
    </div>
  );
}

function ReadingTable({
  rows,
  caption = '값과 화면을 읽는 기준',
}: {
  rows: [string, string][];
  caption?: string;
}) {
  return (
    <table className="guide-reading">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">관찰한 값·모양</th>
          <th scope="col">뜻</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([value, meaning]) => (
          <tr key={value}>
            <th scope="row">{value}</th>
            <td>{meaning}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function sourceLabel(source: string) {
  const host = new URL(source).hostname;
  if (host.includes('coinmetrics')) return 'Coin Metrics';
  if (host.includes('tradingview')) return 'TradingView';
  if (host.includes('blockchaincenter')) return 'BlockchainCenter';
  if (host.includes('capriole')) return 'Capriole';
  if (host.includes('bybit')) return 'Bybit';
  if (host.includes('llama')) return 'DefiLlama';
  return host.replace(/^www\./, '');
}
export function IndicatorReading({
  metric,
  asset,
  params = new URLSearchParams(),
}: {
  metric: string;
  asset: Asset;
  params?: URLSearchParams;
}) {
  const article =
    guideForMetric(metric) ??
    guideArticle(metric) ??
    (['price', 'view:price'].includes(metric) ? guideArticle('candles') : undefined);
  if (!article) return null;
  const context = new URLSearchParams(params);
  context.set('asset', asset);
  context.set('metric', metric);
  return (
    <div className="indicator-reading-panel">
      <p className="reading-chart-name">{article.title}</p>
      <GuideReadingBody article={article} asset={asset} />
      <Link
        className="reading-dictionary-link"
        aria-label="현재 분석 설명"
        to={guideHref(article.id, context)}
      >
        사전에서 자세히 읽기 →
      </Link>
    </div>
  );
}
export default IndicatorReading;

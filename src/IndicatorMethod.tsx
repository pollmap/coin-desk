import type { GuideArticle } from '../shared/learning-catalog';
import { guideLesson } from '../shared/guide-lessons';

/** Load the same verified lesson as the dictionary only when help is expanded. */
export default function IndicatorMethod({
  article,
  part = 'all',
}: {
  article: GuideArticle;
  part?: 'all' | 'example' | 'method';
}) {
  const lesson = guideLesson(article);
  return (
    <div className="indicator-method">
      {part !== 'example' &&
        [...new Set(lesson.method.length ? lesson.method : [article.formula])].map((line) => (
          <p key={line}>{line}</p>
        ))}
      {part !== 'example' && lesson.terms.length > 0 && (
        <dl>
          {lesson.terms.map(([term, meaning]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>
      )}
      {part !== 'method' && <p className="muted">숫자 예시 · 현재 시세가 아닙니다</p>}
      {part !== 'method' && lesson.example.map((line) => <p key={line}>{line}</p>)}
      {part !== 'method' && <p>{lesson.conclusion}</p>}
    </div>
  );
}

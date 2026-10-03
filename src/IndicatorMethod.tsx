import type { GuideArticle } from '../shared/learning-catalog';
import { guideLesson } from '../shared/guide-lessons';

/** Load the same verified lesson as the dictionary only when help is expanded. */
export default function IndicatorMethod({ article }: { article: GuideArticle }) {
  const lesson = guideLesson(article);
  return (
    <div className="indicator-method">
      {[...new Set(lesson.method.length ? lesson.method : [article.formula])].map((line) => (
        <p key={line}>{line}</p>
      ))}
      {lesson.terms.length > 0 && (
        <dl>
          {lesson.terms.map(([term, meaning]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="muted">숫자 예시 · 현재 시세가 아닙니다</p>
      {lesson.example.map((line) => (
        <p key={line}>{line}</p>
      ))}
      <p>{lesson.conclusion}</p>
    </div>
  );
}

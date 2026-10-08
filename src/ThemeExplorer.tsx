import { Link } from 'react-router-dom';
import { useData } from './hooks';
import type { themesResponse } from '../shared/knowledge';
import type { Asset } from '../shared/types';
import { ASSETS } from '../shared/catalog';
import { AssetLogo } from './AssetLogo';

export default function ThemeExplorer({
  selected,
  onSelect,
  href,
}: {
  selected: string | null;
  onSelect: (id: string | null) => void;
  href: (asset: Asset) => string;
}) {
  const data = useData<ReturnType<typeof themesResponse>>('/api/v1/themes', false, 3600000);
  return (
    <section className="theme-explorer" aria-label="테마 탐색">
      <p className="muted">보리차트 추적 종목 기준 · 복수 분류</p>
      {data.error ? (
        <p role="alert">
          테마를 불러오지 못했습니다. <button onClick={data.reload}>다시 시도</button>
        </p>
      ) : !data.data ? (
        <p role="status">테마를 불러오는 중…</p>
      ) : (
        <>
          <div className="theme-tabs" role="group" aria-label="테마 선택">
            <button aria-pressed={!selected} onClick={() => onSelect(null)}>
              모든 테마
            </button>
            {data.data.themes.map((t) => (
              <button key={t.id} aria-pressed={selected === t.id} onClick={() => onSelect(t.id)}>
                {t.title} <small>{t.members.length}</small>
              </button>
            ))}
          </div>
          {selected && !data.data.themes.some((t) => t.id === selected) && (
            <p role="status">등록되지 않은 테마입니다. 모든 테마를 선택해 주세요.</p>
          )}
          {data.data.themes
            .filter((t) => !selected || t.id === selected)
            .map((t) => (
              <section key={t.id} className="theme-row">
                <div>
                  <h2>
                    {t.title} <small>{t.members.length}코인</small>
                  </h2>
                  <p>{t.description}</p>
                </div>
                <ul>
                  {t.members.map((m) => (
                    <li key={m.asset}>
                      <Link to={href(m.asset)}>
                        <AssetLogo asset={m.asset} size={24} />
                        {ASSETS.find((a) => a.id === m.asset)?.name} <small>{m.asset}</small>
                      </Link>
                      <details>
                        <summary>{m.asset} 분류 근거</summary>
                        <p>{m.evidence.note}</p>
                        <a href={m.evidence.url} target="_blank" rel="noreferrer">
                          {m.evidence.provider} 원문 ↗
                        </a>
                        <small> · 확인 {m.evidence.checkedAt}</small>
                      </details>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </>
      )}
    </section>
  );
}

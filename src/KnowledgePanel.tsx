import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Asset } from '../shared/types';
import type { KnowledgeResponse } from '../shared/knowledge';
import { indicatorUrl } from '../shared/indicator-catalog';
import { useData } from './hooks';
import './knowledge.css';
const Graph = lazy(() => import('./KnowledgeGraph'));
const kinds = {
  asset: '코인·토큰',
  project: '프로젝트',
  network: '네트워크',
  theme: '테마',
  indicator: '지표',
  provider: '데이터 제공자',
};
export default function KnowledgePanel({
  asset,
  params,
  onNavigate,
}: {
  asset: Asset;
  params: URLSearchParams;
  onNavigate: () => void;
}) {
  const result = useData<KnowledgeResponse>('/api/v1/knowledge?asset=' + asset, false, 3600000);
  const [selected, setSelected] = useState<string | null>(null);
  const [map, setMap] = useState(false);
  const data = result.data?.asset === asset ? result.data : null;
  const node = data?.nodes.find((n) => n.id === selected) ?? data?.nodes[0];
  const relation = data?.edges.find((edge) => edge.target === node?.id);
  const proof = relation?.evidence ?? node?.evidence;
  return (
    <div className="knowledge-panel">
      {result.error ? (
        <p role="alert">
          관계 정보를 불러오지 못했습니다. <button onClick={result.reload}>다시 시도</button>
        </p>
      ) : !data ? (
        <p role="status">관계 정보를 불러오는 중…</p>
      ) : (
        <>
          <div className="knowledge-mode" role="group" aria-label="관계 표시 방식">
            <button aria-pressed={!map} onClick={() => setMap(false)}>
              목록
            </button>
            <button aria-pressed={map} onClick={() => setMap(true)}>
              관계 지도
            </button>
          </div>
          <div className="knowledge-layout">
            <div>
              {map && (
                <div className="knowledge-map">
                  <Suspense fallback={<p role="status">지도를 여는 중…</p>}>
                    <Graph data={data} selected={node?.id} onSelect={setSelected} />
                  </Suspense>
                </div>
              )}
              <ul className="knowledge-list" aria-label="관계 목록">
                {data.edges.map((edge) => {
                  const target = data.nodes.find((n) => n.id === edge.target)!;
                  const source = data.nodes.find((n) => n.id === edge.source)!;
                  return (
                    <li key={edge.id}>
                      <button
                        aria-pressed={node?.id === target.id}
                        onClick={() => setSelected(target.id)}
                      >
                        <span>
                          {source.label} <small>→ {edge.label}</small>
                        </span>
                        <strong>{target.label}</strong>
                        <small>{kinds[target.kind]}</small>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            {node && proof && (
              <aside className="knowledge-evidence" aria-label="선택한 관계 근거">
                <small>{kinds[node.kind]}</small>
                <h3>{node.label}</h3>
                <p>{node.description}</p>
                {relation && (
                  <p>
                    {relation.label} · {proof.note}
                  </p>
                )}
                <p>
                  {proof.basis === 'editorial'
                    ? '보리차트 편집 분류'
                    : proof.basis === 'implementation'
                      ? '계산·지원 정의'
                      : '프로젝트 공식 설명'}
                </p>
                <a href={proof.url} target="_blank" rel="noreferrer">
                  {proof.provider} 근거 ↗
                </a>
                <small>확인 {proof.checkedAt}</small>
                {node.metric && (
                  <Link
                    className="knowledge-analysis"
                    onClick={onNavigate}
                    to={indicatorUrl(asset, node.metric, params)}
                  >
                    {asset} {node.label} 차트 열기
                  </Link>
                )}
                {node.kind === 'theme' && (
                  <Link onClick={onNavigate} to={'/?view=themes&theme=' + node.id.slice(6)}>
                    테마의 코인 보기
                  </Link>
                )}
              </aside>
            )}
          </div>
        </>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookmarkPlus, ChevronDown, ChevronUp, Download, Star, Trash2 } from 'lucide-react';
import { METRICS } from '../shared/catalog';
import { DEFAULT_DESK, importDesk, normalizeDesk, workspaceUrl } from '../shared/workspace';
import type { PersonalDesk, Workspace } from '../shared/workspace';
import './desk.css';

const KEY = 'coin-desk.personal.v1';
function readDesk(): PersonalDesk {
  try {
    return normalizeDesk(JSON.parse(localStorage.getItem(KEY) || 'null'));
  } catch {
    return structuredClone(DEFAULT_DESK);
  }
}
export function usePersonalDesk() {
  const [desk, setDesk] = useState(readDesk);
  useEffect(() => {
    const update = () => setDesk(readDesk());
    const stored = (event: StorageEvent) => {
      if (!event.key || event.key === KEY) update();
    };
    window.addEventListener('coin-desk-personal', update);
    window.addEventListener('storage', stored);
    return () => {
      window.removeEventListener('coin-desk-personal', update);
      window.removeEventListener('storage', stored);
    };
  }, []);
  const update = (recipe: (current: PersonalDesk) => PersonalDesk) => {
    const next = normalizeDesk(recipe(readDesk()));
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      throw new Error('브라우저 저장 공간을 사용할 수 없습니다. 설정을 내보내 보관해 주세요.');
    }
    window.dispatchEvent(new Event('coin-desk-personal'));
  };
  return { desk, update };
}
export function CardPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card-picker">
      <button className="desk-button" aria-expanded={open} onClick={() => setOpen(!open)}>
        대시보드 구성 {open ? '−' : '+'}
      </button>
      {open ? (
        <div className="desk-editor">
          <p>보고 싶은 BTC 온체인 지표를 선택하세요. 선택한 순서대로 표시합니다.</p>
          <div className="card-options">
            {METRICS.map((m) => (
              <label key={m.id}>
                <input
                  type="checkbox"
                  checked={value.includes(m.id)}
                  onChange={() =>
                    onChange(
                      value.includes(m.id) ? value.filter((id) => id !== m.id) : [...value, m.id],
                    )
                  }
                />
                {m.title}
              </label>
            ))}
          </div>
          <ol className="card-order">
            {value.map((id, index) => (
              <li key={id}>
                <span>{METRICS.find((m) => m.id === id)?.title}</span>
                <button
                  disabled={index === 0}
                  aria-label={METRICS.find((m) => m.id === id)?.title + ' 위로'}
                  onClick={() => {
                    const next = [...value];
                    [next[index - 1], next[index]] = [next[index], next[index - 1]];
                    onChange(next);
                  }}
                >
                  <ChevronUp size={16} />
                </button>
                <button
                  disabled={index === value.length - 1}
                  aria-label={METRICS.find((m) => m.id === id)?.title + ' 아래로'}
                  onClick={() => {
                    const next = [...value];
                    [next[index + 1], next[index]] = [next[index], next[index + 1]];
                    onChange(next);
                  }}
                >
                  <ChevronDown size={16} />
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
export function WorkspaceBar({
  current,
  embedded = false,
}: {
  current: Omit<Workspace, 'name'>;
  embedded?: boolean;
}) {
  const { desk, update } = usePersonalDesk();
  const [open, setOpen] = useState(embedded);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [transfer, setTransfer] = useState(false);
  const [text, setText] = useState('');
  const [removed, setRemoved] = useState<Workspace | null>(null);
  const act = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  const persist = () =>
    act(() => {
      const title = name.trim();
      if (!title) throw new Error('작업공간 이름을 입력해 주세요.');
      update((d) => {
        const found = d.workspaces.some((w) => w.name === title);
        if (!found && d.workspaces.length >= 12)
          throw new Error('최대 12개까지 저장할 수 있습니다.');
        const item: Workspace = { ...current, name: title };
        return {
          ...d,
          workspaces: found
            ? d.workspaces.map((w) => (w.name === title ? item : w))
            : [...d.workspaces, item],
        };
      });
      setMessage(title + ' 작업공간을 저장했습니다.');
    });
  return (
    <section className="workspace-bar" aria-label="나의 작업공간">
      {!embedded && (
        <div className="workspace-actions">
          <button className="desk-button" aria-expanded={open} onClick={() => setOpen(!open)}>
            <BookmarkPlus size={16} />
            작업공간 {open ? '닫기' : '저장·불러오기'}
          </button>
          <Link to="/compare" className="desk-button">
            코인 성과 비교 ↗
          </Link>
          <Link to="/explore" className="desk-button">
            지표 찾아보기 ↗
          </Link>
        </div>
      )}
      {open ? (
        <div className="desk-editor">
          <form
            className="workspace-save"
            onSubmit={(e) => {
              e.preventDefault();
              persist();
            }}
          >
            <label>
              작업공간 이름
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                placeholder="예: DOGE 장기 추세"
              />
            </label>
            <button className="desk-button primary" type="submit">
              {desk.workspaces.some((w) => w.name === name.trim())
                ? '같은 이름 덮어쓰기'
                : '현재 구성 저장'}
            </button>
            <button
              className="desk-button"
              type="button"
              aria-expanded={transfer}
              onClick={() => setTransfer(!transfer)}
            >
              설정 백업·이동
            </button>
          </form>
          <p>
            코인·시장·봉·기간·지표·로그축·온체인 카드 구성을 저장합니다. 그린 선은 각 차트에 따로
            보관됩니다.
          </p>
          <div className="saved-workspaces">
            {desk.workspaces.length ? (
              desk.workspaces.map((w) => (
                <div key={w.name}>
                  <Link
                    to={workspaceUrl(w)}
                    onClick={() => {
                      setOpen(false);
                      setMessage('');
                    }}
                  >
                    <Star size={14} />
                    <b>{w.name}</b>
                    <small>
                      {w.asset} ·{' '}
                      {w.priceSource === 'reference'
                        ? 'USD 참조'
                        : w.market === 'upbit'
                          ? 'KRW'
                          : 'USDT'}
                    </small>
                  </Link>
                  <button
                    aria-label={w.name + ' 삭제'}
                    onClick={() =>
                      act(() => {
                        update((d) => ({
                          ...d,
                          workspaces: d.workspaces.filter((x) => x.name !== w.name),
                        }));
                        setRemoved(w);
                        setMessage('작업공간을 삭제했습니다.');
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            ) : (
              <p>저장한 작업공간이 없습니다. 지금 보고 있는 구성을 이름과 함께 저장해 보세요.</p>
            )}
          </div>
          {removed ? (
            <button
              className="desk-button"
              onClick={() =>
                act(() => {
                  update((d) => {
                    if (
                      d.workspaces.length >= 12 ||
                      d.workspaces.some((w) => w.name === removed.name)
                    )
                      throw new Error('같은 이름 또는 최대 개수 때문에 복원할 수 없습니다.');
                    return { ...d, workspaces: [...d.workspaces, removed] };
                  });
                  setRemoved(null);
                  setMessage('삭제한 작업공간을 복원했습니다.');
                })
              }
            >
              삭제 취소
            </button>
          ) : null}
          {transfer ? (
            <div className="settings-transfer">
              <button
                className="desk-button"
                onClick={() => {
                  const data = JSON.stringify(desk, null, 2);
                  setText(data);
                  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'coin-desk-settings.json';
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                <Download size={15} />
                저장한 설정 내보내기
              </button>
              <label>
                설정 JSON
                <textarea
                  value={text}
                  maxLength={64001}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="내보낸 JSON을 붙여넣으면 다른 브라우저에서도 복원할 수 있습니다."
                />
              </label>
              <p>
                가져오기는 현재 즐겨찾기·카드 구성을 바꾸고 작업공간을 추가합니다. 같은 이름은 기존
                항목을 유지합니다. 개인 설정은 서버로 보내지 않습니다.
              </p>
              <button
                className="desk-button"
                onClick={() =>
                  act(() => {
                    const imported = importDesk(text);
                    update((d) => {
                      const merged = [
                        ...d.workspaces,
                        ...imported.workspaces.filter(
                          (w) => !d.workspaces.some((x) => x.name === w.name),
                        ),
                      ];
                      if (merged.length > 12) throw new Error('합친 작업공간이 12개를 넘습니다.');
                      return { ...imported, workspaces: merged };
                    });
                    setMessage('설정을 가져왔습니다. 저장된 작업공간을 눌러 적용하세요.');
                  })
                }
              >
                검증 후 설정 가져오기
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p role="status" className="desk-message">
          {message}
        </p>
      ) : null}
    </section>
  );
}

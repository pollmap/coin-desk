import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  normalizeResearch,
  recipeMetrics,
  recipeUrl,
  type CoreAsset,
  type ResearchItem,
  type ImportBatch,
  type AnalysisRecipe,
} from '../shared/research-library';
import { ANALYSIS_LABELS, ANALYSIS_VIEWS, type AnalysisView } from '../shared/advanced-analysis';
import {
  libraryItems,
  libraryBatches,
  importItems,
  saveBatch,
  loadMedia,
  storeMedia,
  thumbnail,
  updateItem,
  backupLibrary,
  restoreLibrary,
} from './library-db';
import './analysis-library.css';

function LocalImage({
  media,
  large = false,
}: {
  media: ResearchItem['media'][number];
  large?: boolean;
}) {
  const [url, setUrl] = useState('');
  const [original, setOriginal] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const update = () => setRevision((v) => v + 1);
    window.addEventListener('coin-desk-media-updated', update);
    return () => window.removeEventListener('coin-desk-media-updated', update);
  }, []);
  useEffect(() => {
    let live = true,
      object = '';
    loadMedia(media.key)
      .then((m) => {
        if (!live || !m) return;
        object = URL.createObjectURL(large ? (m.original ?? m.thumbnail) : m.thumbnail);
        setOriginal(!!m.original);
        setUrl(object);
      })
      .catch(() => {});
    return () => {
      live = false;
      if (object) URL.revokeObjectURL(object);
    };
  }, [media.key, large, revision]);
  return url ? (
    <>
      <img
        src={url}
        alt={
          large
            ? original
              ? '보관한 원본 차트 · 작성자 해석'
              : '차트 미리보기 · 원본 미보관'
            : '차트 썸네일'
        }
        loading="lazy"
      />
      {large && !original && (
        <figcaption>미리보기 · 원본은 이미지 폴더를 가져오거나 원문에서 확인하세요.</figcaption>
      )}
    </>
  ) : (
    <span className="media-missing">이미지 미보관</span>
  );
}
function Detail({ item, onUpdate }: { item: ResearchItem; onUpdate: (i: ResearchItem) => void }) {
  const [recipe, setRecipe] = useState<AnalysisRecipe>(
    item.recipe ?? {
      asset: item.assets[0] ?? 'BTC',
      view: 'price',
      source: 'reference',
      verified: false,
    },
  );
  const [error, setError] = useState('');
  async function write(next: ResearchItem) {
    try {
      await updateItem(next);
      onUpdate(next);
    } catch (e) {
      setError(String(e));
    }
  }
  function link(after: boolean) {
    const url = recipeUrl(item.recipe!, item.publishedAt, after);
    return url + '&related=1';
  }
  return (
    <section className="library-detail" aria-label="선택 자료">
      <header>
        <strong>@{item.author}</strong>
        <span>{item.publishedAt.slice(0, 10) || '게시일 미확인'}</span>
      </header>
      <span className="interpretation-label">작성자 해석 · 개인 자료</span>
      {item.media.map((m) => (
        <figure key={m.key}>
          <LocalImage media={m} large />
          {m.url && (
            <a href={m.url} target="_blank" rel="noreferrer">
              원본 이미지 ↗
            </a>
          )}
        </figure>
      ))}
      <p className="original-text">{item.text || '첨부 이미지 · 본문 없음'}</p>
      {item.captureNote && <p className="amber">{item.captureNote}</p>}
      {item.url && (
        <a href={item.url} target="_blank" rel="noreferrer">
          게시물 원문 ↗
        </a>
      )}
      <fieldset>
        <legend>검토 상태</legend>
        {(
          [
            ['text', '본문 확인'],
            ['images', '이미지 검토'],
            ['method', '방법론 검증'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={item.review[key]}
              onChange={(e) =>
                write({ ...item, review: { ...item.review, [key]: e.target.checked } })
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>내 차트 연결</legend>
        <label>
          코인
          <select
            aria-label="코인"
            value={recipe.asset}
            onChange={(e) =>
              setRecipe({
                ...recipe,
                asset: e.target.value as CoreAsset,
                metric: undefined,
                verified: false,
              })
            }
          >
            {['BTC', 'DOGE', 'ETH'].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label>
          분석 영역
          <select
            aria-label="연결 분석 영역"
            value={recipe.section ?? 'price'}
            onChange={(e) =>
              setRecipe({
                ...recipe,
                section: e.target.value as AnalysisRecipe['section'],
                view: 'price',
                metric: undefined,
                verified: false,
              })
            }
          >
            <option value="price">가격·기술</option>
            <option value="onchain">온체인</option>
            <option value="futures">선물</option>
          </select>
        </label>
        {recipe.section && recipe.section !== 'price' && (
          <label>
            주 지표
            <select
              aria-label="연결 주 지표"
              value={recipe.metric ?? recipeMetrics(recipe.asset, recipe.section)[0]?.id}
              onChange={(e) => setRecipe({ ...recipe, metric: e.target.value, verified: false })}
            >
              {recipeMetrics(recipe.asset, recipe.section).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label hidden={!!recipe.section && recipe.section !== 'price'}>
          분석
          <select
            aria-label="분석"
            value={recipe.view}
            onChange={(e) =>
              setRecipe({ ...recipe, view: e.target.value as AnalysisView, verified: false })
            }
          >
            {ANALYSIS_VIEWS.map((v) => (
              <option
                key={v}
                value={v}
                disabled={
                  (v === 'cycles' && recipe.asset !== 'BTC') ||
                  (v === 'powerlaw' && (recipe.asset !== 'BTC' || recipe.source !== 'reference')) ||
                  (v === 'vwap' && recipe.source === 'reference')
                }
              >
                {ANALYSIS_LABELS[v]}
              </option>
            ))}
          </select>
        </label>
        <label>
          가격 원천
          <select
            aria-label="가격 원천"
            value={recipe.source}
            onChange={(e) =>
              setRecipe({
                ...recipe,
                source: e.target.value as AnalysisRecipe['source'],
                verified: false,
              })
            }
          >
            <option value="reference">USD 참조</option>
            <option value="upbit">Upbit KRW</option>
            <option value="binance">Binance USDT</option>
          </select>
        </label>
        <label hidden={!!recipe.section && recipe.section !== 'price'}>
          추가 가격 지표
          <select
            aria-label="연결 지표"
            value={recipe.indicators?.[0] ?? ''}
            onChange={(e) =>
              setRecipe({
                ...recipe,
                indicators: e.target.value ? [e.target.value] : [],
                verified: false,
              })
            }
          >
            <option value="">기본 구성</option>
            <option value="rsi">RSI 14</option>
            <option value="sma200">200일 이동평균</option>
            <option value="sma200w">200주 이동평균</option>
            <option value="bb">볼린저밴드 20</option>
          </select>
        </label>
        <button
          onClick={() => {
            if (
              (recipe.view === 'powerlaw' &&
                (recipe.asset !== 'BTC' || recipe.source !== 'reference')) ||
              (recipe.view === 'cycles' && recipe.asset !== 'BTC') ||
              (recipe.view === 'vwap' && recipe.source === 'reference')
            ) {
              setError('이 분석의 지원 코인·가격 원천을 확인해 주세요.');
              return;
            }
            setError('');
            const verified = {
              ...recipe,
              metric: recipe.metric ?? recipeMetrics(recipe.asset, recipe.section)[0]?.id,
              verified: true,
            };
            setRecipe(verified);
            void write({ ...item, recipe: verified });
          }}
        >
          연결 확인·저장
        </button>
        {item.recipe?.verified && (
          <div className="library-open">
            <Link
              to={link(false)}
              onClick={() => sessionStorage.setItem('coin-desk.related-item', item.id)}
            >
              내 차트로 열기
            </Link>
            <Link
              to={link(true)}
              onClick={() => sessionStorage.setItem('coin-desk.related-item', item.id)}
            >
              게시 후 흐름까지 보기
            </Link>
          </div>
        )}
        <small>
          선택 원천으로 재계산합니다. 원문의 거래소·통화·산식과 다를 수 있습니다. 게시일 전 구간은
          현재 확보한 이력으로 봅니다.
        </small>
      </fieldset>
      <details>
        <summary>수집 경로·변경 이력</summary>
        <p>{item.origins.join(' · ')}</p>
        <p>변경 보관 {item.revisions.length}건 · 검색 분류는 자동 후보입니다.</p>
      </details>
      <label>
        개인 메모
        <textarea
          defaultValue={item.note ?? ''}
          key={item.id}
          onBlur={(e) => {
            if (e.target.value !== (item.note ?? ''))
              void write({ ...item, note: e.target.value.slice(0, 10000) });
          }}
        />
      </label>
      <p role="status">{error}</p>
    </section>
  );
}
export function RelatedLibrary({ asset }: { asset: string }) {
  const [items, setItems] = useState<ResearchItem[]>([]),
    [selected, setSelected] = useState<string | null>(() =>
      sessionStorage.getItem('coin-desk.related-item'),
    );
  useEffect(() => {
    libraryItems()
      .then(setItems)
      .catch(() => {});
  }, []);
  const relevant = items.filter(
    (i) => i.assets.includes(asset as CoreAsset) || i.recipe?.asset === asset,
  );
  const item = relevant.find((i) => i.id === selected);
  return (
    <>
      <h2>관련 개인 자료</h2>
      <Link to="/workspace/library">자료함 전체 열기 ↗</Link>
      {item ? (
        <>
          <button onClick={() => setSelected(null)}>목록으로</button>
          <Detail
            key={item.id}
            item={item}
            onUpdate={(next) => setItems((all) => all.map((i) => (i.id === next.id ? next : i)))}
          />
        </>
      ) : (
        <>
          {relevant.slice(0, 20).map((i) => (
            <button className="related-row" key={i.id} onClick={() => setSelected(i.id)}>
              <b>@{i.author}</b>
              <span>{i.text.slice(0, 100) || '첨부 차트'}</span>
            </button>
          ))}
          {!relevant.length && (
            <p>
              이 기기에 연결된 자료가 없습니다. 자료함에서 기존 수집본이나 Chrome 자료를 가져오세요.
            </p>
          )}
        </>
      )}
    </>
  );
}
export function ResearchLibrary() {
  const [params] = useSearchParams();
  const [items, setItems] = useState<ResearchItem[]>([]),
    [ids, setIds] = useState<string[]>([]),
    [batches, setBatches] = useState<ImportBatch[]>([]),
    [query, setQuery] = useState(''),
    [asset, setAsset] = useState(params.get('asset') ?? ''),
    [method, setMethod] = useState(''),
    [selected, setSelected] = useState<string | null>(null),
    [scroll, setScroll] = useState(0),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false),
    [originals, setOriginals] = useState(false),
    [connection, setConnection] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null),
    stop = useRef(false),
    sequence = useRef(0),
    searchRequest = useRef(''),
    pending = useRef(
      new Map<
        string,
        {
          resolve: (v: { items: ResearchItem[]; errors: string[] }) => void;
          reject: (e: Error) => void;
        }
      >(),
    ),
    bridge = useRef<{
      nonce: string;
      until: number;
      batch: ImportBatch;
      tail: Promise<void>;
      sequences: Set<number>;
      keys: Set<string>;
      media?: {
        key: string;
        total: number;
        offset: number;
        mime: string;
        parts: Uint8Array<ArrayBuffer>[];
      };
    } | null>(null);
  const list = useRef<HTMLDivElement>(null),
    files = useRef<HTMLInputElement>(null),
    folder = useRef<HTMLInputElement>(null),
    backup = useRef<HTMLInputElement>(null);
  const refresh = async () => {
    setItems(await libraryItems());
    setBatches(await libraryBatches());
  };
  useEffect(() => {
    void refresh().catch((e) => setStatus(String(e)));
    const w = new Worker(new URL('./library-worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'search') {
        if (m.request === searchRequest.current) setIds(m.ids);
      } else {
        const p = pending.current.get(m.request);
        if (p) {
          pending.current.delete(m.request);
          m.type === 'error' ? p.reject(new Error(m.error)) : p.resolve(m);
        }
      }
    };
    w.onerror = (event) => {
      const error = new Error(
        event.message || '자료 처리 작업을 시작하지 못했습니다. 새로고침 후 다시 시도해 주세요.',
      );
      for (const task of pending.current.values()) task.reject(error);
      pending.current.clear();
      setStatus(error.message);
    };
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, []);
  useEffect(() => {
    worker.current?.postMessage({ type: 'index', items });
  }, [items]);
  useEffect(() => {
    const id = String(++sequence.current);
    searchRequest.current = id;
    worker.current?.postMessage({ type: 'search', request: id, query, asset, method });
    setScroll(0);
    if (list.current) list.current.scrollTop = 0;
  }, [query, asset, method, items]);
  function batch(source: string): ImportBatch {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      startedAt: now,
      updatedAt: now,
      read: 0,
      added: 0,
      changed: 0,
      duplicate: 0,
      rejected: 0,
      checkpoint: { source, offset: 0, status: 'running' },
    };
  }
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const session = bridge.current,
        m = event.data;
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        !session ||
        Date.now() > session.until ||
        !['CD_LIBRARY_CHUNK', 'CD_LIBRARY_MEDIA', 'CD_LIBRARY_DONE'].includes(m?.type) ||
        m.nonce !== session.nonce ||
        !Number.isSafeInteger(m.sequence) ||
        m.sequence < 0
      )
        return;
      session.tail = session.tail.then(async () => {
        try {
          if (!session.sequences.has(m.sequence)) {
            if (m.type === 'CD_LIBRARY_CHUNK') {
              if (!Array.isArray(m.rows) || m.rows.length > 100) throw new Error('묶음 크기 초과');
              const rows: ResearchItem[] = m.rows.map((r: unknown) =>
                normalizeResearch(r, 'Chrome X 화면'),
              );
              await importItems(rows, session.batch);
              rows.forEach((row) => row.media.forEach((media) => session.keys.add(media.key)));
              await refresh();
            } else if (m.type === 'CD_LIBRARY_DONE') {
              if (session.media)
                throw new Error('완료되지 않은 이미지가 있습니다. 다시 전송해 주세요.');
              session.batch.checkpoint.status = 'complete';
              session.batch.checkpoint.reason =
                Number.isSafeInteger(m.failed) && m.failed > 0
                  ? '이미지 접근 실패 ' + m.failed + '개'
                  : undefined;
              await saveBatch(session.batch);
              await refresh();
              window.dispatchEvent(new Event('coin-desk-media-updated'));
            } else {
              if (
                !session.keys.has(m.key) ||
                !/^image\/(jpeg|png|webp|gif)$/.test(m.mime) ||
                !Number.isSafeInteger(m.total) ||
                m.total <= 0 ||
                m.total > 25 * 1024 * 1024 ||
                typeof m.data !== 'string' ||
                m.data.length > 300000
              )
                throw new Error('이미지 전송 형식 오류');
              if (m.offset === 0)
                session.media = { key: m.key, total: m.total, offset: 0, mime: m.mime, parts: [] };
              const media = session.media;
              if (
                !media ||
                media.key !== m.key ||
                media.offset !== m.offset ||
                media.total !== m.total
              )
                throw new Error('이미지 조각 누락');
              const part = Uint8Array.from(atob(m.data), (c: string) => c.charCodeAt(0));
              media.parts.push(part);
              media.offset += part.length;
              if (media.offset > media.total) throw new Error('이미지 크기 초과');
              if (media.offset === media.total) {
                const blob = new Blob(media.parts, { type: media.mime });
                await storeMedia({
                  key: media.key,
                  thumbnail: await thumbnail(blob),
                  original: blob,
                });
                session.media = undefined;
              }
            }
            session.sequences.add(m.sequence);
          }
          window.postMessage(
            { type: 'CD_LIBRARY_ACK', nonce: session.nonce, sequence: m.sequence },
            location.origin,
          );
          setStatus('Chrome 자료 ' + session.batch.read + '건 저장');
        } catch (e) {
          session.batch.checkpoint.status = 'failed';
          session.batch.checkpoint.reason = String(e);
          await saveBatch(session.batch).catch(() => {});
          window.postMessage(
            {
              type: 'CD_LIBRARY_ACK',
              nonce: session.nonce,
              sequence: m.sequence,
              error: String(e),
            },
            location.origin,
          );
          setStatus('Chrome 가져오기 실패: ' + String(e));
        }
      });
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  async function parse(file: File) {
    // Read the selected File in its owning document. Some WebKit versions cannot
    // read an input-backed File after structured cloning it into a module worker.
    const text = await file.text();
    return new Promise<{ items: ResearchItem[]; errors: string[] }>((resolve, reject) => {
      const request = crypto.randomUUID();
      pending.current.set(request, { resolve, reject });
      if (!worker.current) {
        pending.current.delete(request);
        reject(new Error('자료 처리기가 준비되지 않았습니다. 다시 시도해 주세요.'));
        return;
      }
      worker.current.postMessage({
        type: 'parse',
        text,
        name: file.name,
        origin: file.webkitRelativePath || file.name,
        request,
      });
    });
  }
  async function ingest(input: FileList | null) {
    if (!input || busy) return;
    setBusy(true);
    stop.current = false;
    const job = batch('로컬 파일');
    try {
      const all = [...input],
        metadata = all.filter((f) => /\.(jsonl|csv)$/i.test(f.name));
      const images = all.filter((f) => /^image\/(png|jpeg|webp|gif)$/.test(f.type));
      const imageMap = new Map<string, File>();
      for (const image of images) {
        imageMap.set(image.webkitRelativePath.replaceAll('\\', '/'), image);
        imageMap.set(image.name, image);
      }
      let imageSaved = 0,
        missing = 0;
      const attach = async (item: ResearchItem) => {
        for (const media of item.media) {
          if (stop.current) return;
          const path = media.file;
          const image = path
            ? imageMap.get(item.author + '/' + path) ||
              images.find((f) => f.webkitRelativePath.endsWith('/' + item.author + '/' + path)) ||
              imageMap.get(path.split('/').at(-1)!)
            : undefined;
          if (!image) {
            missing++;
            continue;
          }
          try {
            const old = await loadMedia(media.key);
            if (old && (!originals || old.original)) continue;
            await storeMedia({
              key: media.key,
              thumbnail: await thumbnail(image),
              original: originals ? image : old?.original,
            });
            imageSaved++;
          } catch (e) {
            job.rejected++;
            job.checkpoint.reason = '이미지 보관 실패: ' + String(e);
            setStatus('이미지 보관 실패: ' + String(e));
          }
        }
      };
      if (metadata.length)
        for (const file of metadata) {
          if (stop.current) break;
          setStatus(file.name + ' 읽는 중');
          const parsed = await parse(file);
          job.rejected += parsed.errors.length;
          for (let i = 0; i < parsed.items.length && !stop.current; i += 100) {
            const chunk = parsed.items.slice(i, i + 100);
            await importItems(chunk, job);
            for (const item of chunk) await attach(item);
            job.checkpoint.lastId = chunk.at(-1)?.id;
            setStatus(job.read + '건 처리 · 이미지 ' + imageSaved + '개');
            await new Promise((r) => setTimeout(r, 0));
          }
        }
      else if (images.length)
        for (const image of images) {
          if (stop.current) break;
          const hash = [
            ...new Uint8Array(await crypto.subtle.digest('SHA-256', await image.arrayBuffer())),
          ]
            .map((v) => v.toString(16).padStart(2, '0'))
            .join('');
          const item = normalizeResearch(
            {
              id: 'attachment:' + hash,
              author: '첨부 자료',
              text: image.name,
              images: [{ file: image.name }],
            },
            '첨부 이미지',
          );
          await importItems([item], job);
          await attach(item);
        }
      else throw new Error('JSONL·CSV 또는 이미지 파일을 선택해 주세요.');
      job.checkpoint.status = stop.current ? 'paused' : 'complete';
      setStatus(
        job.read +
          '건 처리 · 신규 ' +
          job.added +
          ' · 중복 ' +
          job.duplicate +
          ' · 변경 ' +
          job.changed +
          ' · 오류 ' +
          job.rejected +
          ' · 이미지 보관 ' +
          imageSaved +
          ' · 미연결 ' +
          missing +
          (job.checkpoint.reason ? ' · ' + job.checkpoint.reason : '') +
          (stop.current ? ' · 중지됨. 같은 폴더로 재개할 수 있습니다.' : ''),
      );
    } catch (e) {
      job.checkpoint.status = 'failed';
      job.checkpoint.reason = String(e);
      setStatus(String(e));
    } finally {
      await saveBatch(job);
      await refresh();
      window.dispatchEvent(new Event('coin-desk-media-updated'));
      setBusy(false);
    }
  }
  const map = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const chosen = selected ? map.get(selected) : undefined;
  const visible = ids.slice(Math.max(0, Math.floor(scroll / 92) - 3), Math.floor(scroll / 92) + 12);
  const start = Math.max(0, Math.floor(scroll / 92) - 3);
  return (
    <div className="research-library">
      <header className="library-heading">
        <div>
          <Link to="/workspace">내 작업공간</Link>
          <h1>개인 자료함</h1>
          <span>{items.length.toLocaleString()}건 · 현재 기기에만 보관</span>
        </div>
        <div className="library-actions">
          <button disabled={busy} onClick={() => files.current?.click()}>
            파일 가져오기
          </button>
          <button disabled={busy} onClick={() => folder.current?.click()}>
            폴더 가져오기
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const previous = bridge.current?.tail;
                bridge.current = null;
                setConnection(null);
                await previous;
                // A resumed transfer may have already persisted its rows in an
                // earlier session. Only those known media references can resume.
                const saved = await libraryItems();
                const job = batch('Chrome X 화면'),
                  nonce = crypto.randomUUID();
                bridge.current = {
                  nonce,
                  until: Date.now() + 30 * 60 * 1000,
                  batch: job,
                  tail: Promise.resolve(),
                  sequences: new Set(),
                  keys: new Set(saved.flatMap((row) => row.media.map((media) => media.key))),
                };
                setConnection(nonce);
                window.postMessage({ type: 'CD_LIBRARY_HELLO', nonce }, location.origin);
                setStatus(
                  'Chrome 확장을 열고 이 자료함에 전송해 주세요. 연결은 30분 동안 이 탭에서만 유효합니다.',
                );
              } catch (e) {
                setStatus('Chrome 연결 실패: ' + String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Chrome 연결
          </button>
        </div>
      </header>
      <input
        ref={files}
        type="file"
        multiple
        accept=".jsonl,.csv,image/png,image/jpeg,image/webp"
        hidden
        onChange={async (e) => {
          const input = e.currentTarget;
          await ingest(input.files);
          input.value = '';
        }}
      />
      <input
        ref={folder}
        type="file"
        multiple
        {...{ webkitdirectory: '' }}
        hidden
        onChange={async (e) => {
          const input = e.currentTarget;
          await ingest(input.files);
          input.value = '';
        }}
      />
      <div className="library-controls">
        <label>
          <input
            type="checkbox"
            checked={originals}
            onChange={(e) => setOriginals(e.target.checked)}
          />
          원본 이미지도 보관
        </label>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await backupLibrary();
              setStatus('개인 백업을 저장했습니다.');
            } catch (e) {
              setStatus(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          백업 저장
        </button>
        <button disabled={busy} onClick={() => backup.current?.click()}>
          백업 복원
        </button>
        <a href="/downloads/coin-desk-importer.zip" download>
          Chrome 확장 다운로드
        </a>
        <a href="/extension-guide.html" target="_blank" rel="noreferrer">
          설치 안내
        </a>
        {busy && (
          <button
            onClick={() => {
              stop.current = true;
            }}
          >
            중지
          </button>
        )}
      </div>
      <input
        ref={backup}
        type="file"
        accept=".jsonl"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          stop.current = false;
          try {
            const n = await restoreLibrary(
              file,
              (n) => setStatus(n + '건 복원 중'),
              () => stop.current,
            );
            setStatus(n + '건 복원했습니다.');
          } catch (error) {
            setStatus(String(error));
          } finally {
            setBusy(false);
            await refresh();
            e.target.value = '';
          }
        }}
      />
      <p className="library-status" role="status">
        {status || '글·이미지를 가져온 뒤 원문과 내 차트를 함께 확인하세요.'}
      </p>
      {connection && (
        <button
          onClick={() => {
            bridge.current = null;
            setConnection(null);
            setStatus('Chrome 전송 연결을 닫았습니다.');
          }}
        >
          Chrome 연결 종료
        </button>
      )}
      <div className="library-search">
        <input
          type="search"
          aria-label="개인 자료 검색"
          placeholder="작성자, 본문, 날짜, 지표 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select aria-label="자료 코인" value={asset} onChange={(e) => setAsset(e.target.value)}>
          <option value="">모든 코인·미분류</option>
          {['BTC', 'DOGE', 'ETH'].map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select
          aria-label="자료 분석 방법"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        >
          <option value="">모든 방법</option>
          {[...new Set(items.flatMap((i) => i.methods))].sort().map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <span>{ids.length}건</span>
      </div>
      <div className={'library-layout ' + (chosen ? 'has-detail' : '')}>
        <div
          ref={list}
          className="library-virtual"
          tabIndex={0}
          aria-label="개인 자료 목록"
          onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
        >
          <div style={{ height: ids.length * 92, position: 'relative' }}>
            {visible.map((id, i) => {
              const item = map.get(id)!;
              return (
                <button
                  key={id}
                  className="library-row"
                  aria-pressed={selected === id}
                  style={{ top: (start + i) * 92 }}
                  onClick={() => setSelected(id)}
                >
                  {item.media[0] ? (
                    <LocalImage media={item.media[0]} />
                  ) : (
                    <span className="media-missing">글</span>
                  )}
                  <span>
                    <strong>
                      @{item.author} <small>{item.publishedAt.slice(0, 10)}</small>
                    </strong>
                    <span>{item.text.slice(0, 180) || '첨부 이미지'}</span>
                    <small>
                      {item.assets.join(' · ') || '미분류'} · {item.methods.slice(0, 3).join(' · ')}{' '}
                      · 검토{' '}
                      {
                        [item.review.text, item.review.images, item.review.method].filter(Boolean)
                          .length
                      }
                      /3
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
          {!ids.length && <p className="library-empty">표시할 자료가 없습니다.</p>}
        </div>
        {chosen && (
          <div>
            <button onClick={() => setSelected(null)}>자료 닫기</button>
            <Detail
              key={chosen.id}
              item={chosen}
              onUpdate={(next) => setItems((all) => all.map((i) => (i.id === next.id ? next : i)))}
            />
          </div>
        )}
      </div>
      <details className="import-audit">
        <summary>확보·검토 현황</summary>
        <p>
          본문 확인 {items.filter((i) => i.review.text).length}/{items.length} · 이미지 검토{' '}
          {items.filter((i) => i.review.images).length}/{items.length} · 방법 검증{' '}
          {items.filter((i) => i.review.method).length}/{items.length}. 가져오기 완료는 전수 내용
          검토나 X 전체 이력 확보를 의미하지 않습니다.
        </p>
        {batches
          .slice(-12)
          .reverse()
          .map((b) => (
            <p key={b.id}>
              {b.startedAt.slice(0, 16)} · {b.checkpoint.source} · {b.read}건 ·{' '}
              {b.checkpoint.status}
              {b.checkpoint.reason ? ' · ' + b.checkpoint.reason : ''}
            </p>
          ))}
      </details>
    </div>
  );
}

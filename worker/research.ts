import { ASSETS } from '../shared/catalog';
import {
  RESEARCH_AUTHORS,
  RESEARCH_LIST_ID,
  type ResearchFeed,
  type ResearchPost,
} from '../shared/research';
import { claimRefresh, epoch, putState, readState, type Env } from './storage';

const KEY = 'research:x-list:v1';
const DAY = 86400;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export function researchEnabled(
  env: Pick<Env, 'X_BEARER_TOKEN' | 'X_COLLECTION_ENABLED' | 'X_MAX_REQUESTS_PER_DAY'>,
) {
  const cap = Number(env.X_MAX_REQUESTS_PER_DAY);
  return (
    env.X_COLLECTION_ENABLED === '1' &&
    !!env.X_BEARER_TOKEN &&
    Number.isInteger(cap) &&
    cap > 0 &&
    cap <= 24
  );
}
/** Save original URLs and minimal metadata only. Never turn an opinion into market data. */
export function parseResearchPosts(payload: unknown, now = epoch()): ResearchPost[] {
  const body = object(payload);
  if (
    array(body.errors).length ||
    (!Array.isArray(body.data) && object(body.meta).result_count !== 0)
  )
    throw new Error('INVALID_X_RESPONSE');
  const users = new Map(
    array(object(body.includes).users).map((raw) => {
      const user = object(raw);
      return [String(user.id), user] as const;
    }),
  );
  const allowed = new Map(RESEARCH_AUTHORS.map((a) => [a.handle.toLowerCase(), a.handle]));
  const posts = new Map<string, ResearchPost>();
  for (const raw of array(body.data).slice(0, 100)) {
    const p = object(raw),
      user = users.get(String(p.author_id));
    const handle = allowed.get(String(user?.username || p.username || '').toLowerCase());
    const time = typeof p.created_at === 'string' ? Date.parse(p.created_at) / 1000 : NaN;
    if (
      !handle ||
      typeof p.id !== 'string' ||
      !/^\d{1,20}$/.test(p.id) ||
      !Number.isFinite(time) ||
      time > now + 300 ||
      time < now - 7 * DAY ||
      p.withheld ||
      user?.protected
    )
      continue;
    const text = typeof p.text === 'string' ? p.text : '';
    const assets = ASSETS.filter(
      (a) =>
        new RegExp(`(?:^|[^a-z0-9])${a.id}(?:$|[^a-z0-9])`, 'i').test(text) ||
        text.includes(a.name),
    ).map((a) => a.id);
    posts.set(p.id, {
      id: p.id,
      handle,
      publishedAt: time,
      url: `https://x.com/${handle}/status/${p.id}`,
      assets,
      media: array(object(p.attachments).media_keys).length > 0,
    });
  }
  return [...posts.values()].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 20);
}
export async function researchFeed(env: Env): Promise<ResearchFeed> {
  if (!researchEnabled(env))
    return {
      state: 'disabled',
      posts: [],
      fetchedAt: null,
      message: 'X 자동 수집은 아직 연결되지 않았습니다.',
    };
  const state = await readState<ResearchFeed>(env.DB, KEY, {
    state: 'pending',
    posts: [],
    fetchedAt: null,
  });
  if (state.fetchedAt && epoch() - state.fetchedAt > DAY)
    return {
      ...state,
      state: 'error',
      posts: [],
      message: 'X 원문 갱신이 지연되어 이전 목록을 숨겼습니다.',
    };
  return state;
}
export async function refreshResearch(env: Env) {
  if (!researchEnabled(env)) return;
  // A single scheduled request each hour; visits never trigger upstream X requests.
  if (!(await claimRefresh(env.DB, 'research:x-list', 3600))) return;
  const now = epoch(),
    day = Math.floor(now / DAY);
  const budgetKey = 'research:x-requests:' + day;
  const used = await readState<number>(env.DB, budgetKey, 0);
  if (used >= Number(env.X_MAX_REQUESTS_PER_DAY)) return;
  await putState(env.DB, budgetKey, used + 1); // Reserve before network, including failed requests.
  await env.DB.prepare('DELETE FROM state WHERE key LIKE ? AND key <> ?')
    .bind('research:x-requests:%', budgetKey)
    .run();
  try {
    const url = new URL(`https://api.x.com/2/lists/${RESEARCH_LIST_ID}/tweets`);
    url.searchParams.set('max_results', '20');
    url.searchParams.set('post.fields', 'created_at,attachments,entities,withheld');
    url.searchParams.set('expansions', 'author_id');
    url.searchParams.set('user.fields', 'username,protected');
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('X_HTTP_' + response.status);
    const text = await response.text();
    if (text.length > 500000) throw new Error('X_RESPONSE_TOO_LARGE');
    const posts = parseResearchPosts(JSON.parse(text), now);
    await putState(env.DB, KEY, { state: 'ready', posts, fetchedAt: now } satisfies ResearchFeed);
  } catch {
    const prior = await readState<ResearchFeed>(env.DB, KEY, {
      state: 'pending',
      posts: [],
      fetchedAt: null,
    });
    await putState(env.DB, KEY, {
      ...prior,
      state: 'error',
      message: 'X 원문을 갱신하지 못했습니다. 다음 정기 수집에서 다시 확인합니다.',
    });
  }
}

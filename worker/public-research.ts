import { ASSETS } from '../shared/catalog';
import {
  PUBLIC_SOURCES,
  type PublicPost,
  type PublicSource,
  type PublicSourceState,
  type PublicResearchFeed,
} from '../shared/public-research';
import { claimRefresh, epoch, putState, readState, type Env } from './storage';

const key = (id: string) => 'research:public:' + id;
const aliases: Record<string, string[]> = {
  BTC: ['bitcoin', '비트코인'],
  ETH: ['ethereum', '이더리움'],
  DOGE: ['dogecoin', '도지코인'],
  SOL: ['solana', '솔라나'],
  XRP: ['ripple', '리플'],
  LINK: ['chainlink', '체인링크'],
  ONDO: ['ondo', '온도파이낸스'],
  PEPE: ['pepe', '페페'],
};
const plain = (text: string) =>
  text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n: string) => {
      const cp = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
export function mentionedAssets(text: string) {
  return ASSETS.filter((a) =>
    new RegExp(
      '(?:^|[^a-z0-9])(?:' + [a.id, ...aliases[a.id]].join('|') + ')(?:$|[^a-z0-9])',
      'i',
    ).test(text),
  ).map((a) => a.id);
}
function allowedLink(raw: string, source: PublicSource) {
  try {
    const u = new URL(plain(raw), source.url);
    return u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      source.hosts.includes(u.hostname)
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function parsePublicFeed(body: string, source: PublicSource, now = epoch()): PublicPost[] {
  if (body.length > 3_000_000 || /<!DOCTYPE[^>]*\[|<!ENTITY/i.test(body))
    throw new Error('Invalid public source');
  const posts = new Map<string, PublicPost>();
  if (source.kind === 'x') {
    const handle = source.handle!;
    // Only visible public articles; never execute hydration scripts or acquire a guest token.
    for (const match of body.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)) {
      const article = match[1];
      const hrefs = [...article.matchAll(/\bhref=["']([^"']+\/status\/\d+)["']/gi)].map(
        (m) => m[1],
      );
      const own = hrefs
        .map((h) => allowedLink(h, source))
        .find(
          (h) => h && new URL(h).pathname.match(new RegExp('^/' + handle + '/status/\\d+$', 'i')),
        );
      if (!own) continue;
      const id = own.split('/').pop()!;
      const snowflake = Number((BigInt(id) >> 22n) + 1288834974657n) / 1000;
      const stamped = Number(article.match(/"timestamp"\s*:\s*(\d{13})/)?.[1]) / 1000;
      // Check the displayed timestamp against the canonical status id when present.
      if (Number.isFinite(stamped) && Math.abs(stamped - snowflake) > 300) continue;
      const time = Math.floor(snowflake);
      if (time > now + 300 || time < now - 90 * 86400) continue;
      const assets = mentionedAssets(plain(article));
      posts.set(id, {
        id,
        source: source.id,
        title: assets.length ? assets.join(' · ') + ' 관점과 차트' : '시장 관점 · 원문 보기',
        url: own,
        publishedAt: time,
        assets,
        kind: 'x',
        media: /pbs\.twimg\.com\/(?:media|amplify_video)|<video\b/.test(article),
      });
    }
    if (!posts.size) throw new Error('Public posts unavailable');
  } else {
    if (!/<(?:rss|feed)\b/i.test(body)) throw new Error('Invalid feed');
    for (const match of body.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)) {
      const item = match[1];
      const tag = (name: string) =>
        item.match(
          new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '>', 'i'),
        )?.[1] || '';
      const rawLink =
        tag('link') ||
        item.match(/<link\b(?=[^>]*\brel=["']alternate["'])[^>]*\bhref=["']([^"']+)["']/i)?.[1] ||
        item.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i)?.[1] ||
        '';
      const url = allowedLink(rawLink, source);
      const title = plain(tag('title')).slice(0, 180);
      const time = Date.parse(plain(tag('pubDate') || tag('published') || tag('updated'))) / 1000;
      if (!url || !title || !Number.isFinite(time) || time > now + 300 || time < 1230768000)
        continue;
      const assets = [...new Set([...source.assets, ...mentionedAssets(title)])];
      posts.set(url, {
        id: url,
        source: source.id,
        title,
        url,
        publishedAt: time,
        assets,
        kind: source.kind,
        media: source.kind === 'video',
      });
    }
    if (!posts.size) throw new Error('Empty feed');
  }
  return [...posts.values()].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 15);
}
export async function publicSourceStates(env: Env) {
  const rows = await env.DB.prepare(
    "SELECT key,value FROM state WHERE key LIKE 'research:public:%'",
  ).all<{ key: string; value: string }>();
  const values = new Map(
    rows.results.map((r) => [r.key, JSON.parse(r.value) as PublicSourceState]),
  );
  return PUBLIC_SOURCES.map(
    (s) =>
      values.get(key(s.id)) || {
        id: s.id,
        state: 'pending' as const,
        attemptedAt: null,
        fetchedAt: null,
        posts: [],
      },
  );
}
export async function publicResearchFeed(env: Env): Promise<PublicResearchFeed> {
  const states = await publicSourceStates(env);
  return {
    posts: states
      .flatMap((s) => (s.fetchedAt && epoch() - s.fetchedAt < 86400 ? s.posts : []))
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .slice(0, 300),
    sources: states.map(({ posts: _posts, ...s }) => s),
    cadenceSeconds: 3600,
    independentOfVisitors: true,
  };
}
export async function collectPublicSource(env: Env, source: PublicSource) {
  const previous = await readState<PublicSourceState>(env.DB, key(source.id), {
    id: source.id,
    state: 'pending',
    attemptedAt: null,
    fetchedAt: null,
    posts: [],
  });
  const now = epoch();
  try {
    const signal = AbortSignal.timeout(18000);
    const headers = {
      Accept:
        source.kind === 'x'
          ? 'text/html'
          : 'application/atom+xml, application/rss+xml, application/xml, text/xml',
      'User-Agent': 'CoinDeskResearch/0.13 (+https://coin-desk.pages.dev)',
    };
    let target = source.url;
    let response = await fetch(target, { signal, redirect: 'manual', headers });
    for (let hop = 0; [301, 302, 303, 307, 308].includes(response.status); hop++) {
      const location = response.headers.get('Location');
      const next = location ? new URL(location, target) : null;
      if (hop >= 3 || !next || !allowedLink(next.href, source))
        throw new Error('Source redirect rejected');
      await response.body?.cancel();
      target = next.href;
      response = await fetch(target, { signal, redirect: 'manual', headers });
    }
    if (!response.ok) throw new Error('Source HTTP ' + response.status);
    const reader = response.body!.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 3_000_000) {
        await reader.cancel();
        throw new Error('Source too large');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const posts = parsePublicFeed(new TextDecoder().decode(bytes), source, now);
    await putState(env.DB, key(source.id), {
      id: source.id,
      state: 'ready',
      failures: 0,
      nextAttemptAt: now + 3600,
      attemptedAt: now,
      fetchedAt: now,
      posts,
    } satisfies PublicSourceState);
  } catch (error) {
    const detail = error instanceof Error ? error.message : '';
    const reason =
      detail.match(/^Source HTTP \d{3}$/)?.[0] ||
      (/redirect/i.test(detail)
        ? 'redirect'
        : /timeout|aborted/i.test(detail)
          ? 'timeout'
          : /feed|source|posts/i.test(detail)
            ? 'parse'
            : 'connection');
    await putState(env.DB, key(source.id), {
      ...previous,
      state: 'error',
      failures: (previous.failures || 0) + 1,
      nextAttemptAt: now + Math.min(3600, 300 * 2 ** Math.min(previous.failures || 0, 4)),
      attemptedAt: now,
      error: '공개 원문 수집 지연 · ' + reason,
    } satisfies PublicSourceState);
  }
}
/** One bounded source each minute; a 42-source round completes within the hourly target. */
export async function refreshPublicResearch(env: Env) {
  if (!(await claimRefresh(env.DB, 'research:public-round', 55))) return;
  const states = await publicSourceStates(env);
  const due = states
    .filter(
      (s) =>
        !s.attemptedAt ||
        epoch() >= (s.nextAttemptAt ?? s.attemptedAt + (s.state === 'error' ? 300 : 3600)),
    )
    .sort((a, b) => (a.attemptedAt || 0) - (b.attemptedAt || 0))[0];
  const source = PUBLIC_SOURCES.find((s) => s.id === due?.id);
  if (source) await collectPublicSource(env, source);
}

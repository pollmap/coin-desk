import { useEffect, useState } from 'react';
import { json, pages } from './lib';
import { queryCache } from './query-cache';
export function useData<T>(url: string | null, paged = false, refresh = 300000) {
  const [state, setState] = useState<{
    key: string | null;
    data?: T;
    error?: string;
    loading: boolean;
  }>({ key: null, loading: true });
  const [revision, setRevision] = useState(0);
  const key = url ? (paged ? 'history:' : 'json:') + url : null;
  useEffect(() => {
    if (!url || !key) return;
    let mounted = true;
    let request: ReturnType<typeof queryCache.acquire<T>> | undefined;
    const cached = queryCache.peek<T>(key);
    setState({ key, data: cached?.data, loading: !cached });
    const load = async (force = false) => {
      if (document.hidden || request) return;
      const hit = queryCache.peek<T>(key);
      if (!force && hit && Date.now() - hit.time < refresh) {
        setState({ key, data: hit.data, loading: false });
        return;
      }
      request = queryCache.acquire<T>(key, async (signal) =>
        paged ? ((await pages(url, signal)) as T) : json<T>(url, signal),
      );
      const active = request;
      try {
        const data = await active.task;
        if (mounted) setState({ key, data, loading: false });
      } catch (e) {
        if (mounted)
          setState((prev) => ({
            key,
            data: prev.key === key ? prev.data : undefined,
            error: String(e instanceof Error ? e.message : e),
            loading: false,
          }));
      } finally {
        active.release();
        if (request === active) request = undefined;
      }
    };
    void load(revision > 0);
    const timer = setInterval(() => void load(true), refresh);
    const visible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted = false;
      request?.release();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [url, key, paged, refresh, revision]);
  const cached = key ? queryCache.peek<T>(key) : undefined;
  return {
    ...(state.key === key
      ? state
      : { loading: !!key && !cached, data: cached?.data, error: undefined }),
    reload: () => setRevision((v) => v + 1),
  };
}

import { useEffect, useState } from 'react';
import { json, pages } from './lib';
const cache = new Map<string, { data: unknown; time: number }>();
export function useData<T>(url: string | null, paged = false, refresh = 300000) {
  const [state, setState] = useState<{
    key: string | null;
    data?: T;
    error?: string;
    loading: boolean;
  }>({ key: null, loading: true });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    const hit = cache.get(url);
    setState({ key: url, data: hit?.data as T | undefined, loading: !hit });
    let inFlight = false;
    const load = async (force = false) => {
      if (document.hidden || inFlight) return;
      if (!force && hit && Date.now() - hit.time < refresh) {
        setState({ key: url, data: hit.data as T, loading: false });
        return;
      }
      inFlight = true;
      try {
        const data = paged
          ? await pages(url, controller.signal)
          : await json<T>(url, controller.signal);
        if (controller.signal.aborted) return;
        if (cache.size > 80) cache.delete(cache.keys().next().value!);
        cache.set(url, { data, time: Date.now() });
        setState({ key: url, data: data as T, loading: false });
      } catch (e) {
        if (!controller.signal.aborted)
          setState((prev) => ({
            key: url,
            data: prev.key === url ? prev.data : undefined,
            error: String(e instanceof Error ? e.message : e),
            loading: false,
          }));
      } finally {
        inFlight = false;
      }
    };
    void load(revision > 0);
    const timer = setInterval(() => void load(true), refresh);
    const visible = () => {
      if (!document.hidden) void load(true);
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [url, paged, refresh, revision]);
  return {
    ...(state.key === url ? state : { loading: true, data: undefined, error: undefined }),
    reload: () => setRevision((v) => v + 1),
  };
}

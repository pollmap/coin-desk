/** Small per-tab cache. Leaving one chart must not cancel another chart's request. */
export class QueryCache {
  private values = new Map<string, { data: unknown; time: number }>();
  private pending = new Map<
    string,
    { controller: AbortController; task: Promise<unknown>; users: number }
  >();
  constructor(private readonly capacity = 60) {}
  peek<T>(key: string) {
    return this.values.get(key) as { data: T; time: number } | undefined;
  }
  acquire<T>(key: string, loader: (signal: AbortSignal) => Promise<T>) {
    let entry = this.pending.get(key);
    if (!entry) {
      const controller = new AbortController();
      const created = { controller, task: Promise.resolve() as Promise<unknown>, users: 0 };
      created.task = loader(controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) {
            this.values.delete(key);
            this.values.set(key, { data, time: Date.now() });
            while (this.values.size > this.capacity)
              this.values.delete(this.values.keys().next().value!);
          }
          return data;
        })
        .finally(() => {
          if (this.pending.get(key) === created) this.pending.delete(key);
        });
      this.pending.set(key, created);
      entry = created;
    }
    entry.users++;
    let released = false;
    return {
      task: entry.task as Promise<T>,
      release: () => {
        if (released) return;
        released = true;
        entry.users--;
        if (entry.users === 0 && this.pending.get(key) === entry) {
          this.pending.delete(key);
          entry.controller.abort();
        }
      },
    };
  }
}
export const queryCache = new QueryCache();

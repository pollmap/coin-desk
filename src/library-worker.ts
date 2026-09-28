/// <reference lib="webworker" />
import { normalizeResearch, parseCsv, type ResearchItem } from '../shared/research-library';
import { buildLibraryIndex, searchLibrary } from '../shared/library-search';
let index: ReturnType<typeof buildLibraryIndex> = [];
self.onmessage = async (event: MessageEvent) => {
  const m = event.data;
  try {
    if (m.type === 'index') {
      index = buildLibraryIndex(m.items);
      return;
    }
    if (m.type === 'search') {
      self.postMessage({
        type: 'search',
        request: m.request,
        ids: searchLibrary(index, m),
      });
      return;
    }
    if (m.type === 'parse') {
      const text = String(m.text);
      let raw: unknown[] = [];
      const errors: string[] = [];
      if (String(m.name).toLowerCase().endsWith('.csv'))
        raw = parseCsv(text).map((r) => {
          if (r.images) {
            try {
              return { ...r, images: JSON.parse(r.images) };
            } catch {
              /* Preserve text even when old CSV media are not JSON. */
            }
          }
          return r;
        });
      else
        for (const [i, line] of text
          .replace(/^\uFEFF/, '')
          .split(/\r?\n/)
          .entries()) {
          if (!line.trim()) continue;
          try {
            raw.push(JSON.parse(line));
          } catch {
            errors.push('행 ' + (i + 1) + ': JSON 오류');
          }
        }
      const items: ResearchItem[] = [];
      for (const [i, r] of raw.entries()) {
        try {
          items.push(normalizeResearch(r, String(m.origin)));
        } catch (e) {
          errors.push('행 ' + (i + 1) + ': ' + String(e));
        }
      }
      self.postMessage({ type: 'parsed', request: m.request, items, errors });
    }
  } catch (e) {
    self.postMessage({ type: 'error', request: m.request, error: String(e) });
  }
};

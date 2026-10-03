import {
  mergeResearch,
  normalizeResearch,
  type ResearchItem,
  type ImportBatch,
} from '../shared/research-library';
const DB = 'coin-desk-private-library';
export async function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('items', { keyPath: 'id' });
      db.createObjectStore('media', { keyPath: 'key' });
      db.createObjectStore('batches', { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const complete = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = (event) =>
      reject(
        tx.error ??
          (event.target as IDBRequest)?.error ??
          new Error('기기 저장 작업에 실패했습니다.'),
      );
    tx.onabort = () => reject(tx.error ?? new Error('저장이 취소됐습니다.'));
  });
export async function libraryItems() {
  const db = await openLibrary();
  try {
    return (await request(db.transaction('items').objectStore('items').getAll())) as ResearchItem[];
  } finally {
    db.close();
  }
}
export async function libraryBatches() {
  const db = await openLibrary();
  try {
    return (await request(
      db.transaction('batches').objectStore('batches').getAll(),
    )) as ImportBatch[];
  } finally {
    db.close();
  }
}
export async function saveBatch(batch: ImportBatch) {
  const db = await openLibrary();
  try {
    const tx = db.transaction('batches', 'readwrite');
    const done = complete(tx);
    tx.objectStore('batches').put(batch);
    await done;
  } finally {
    db.close();
  }
}
export async function importItems(items: ResearchItem[], batch: ImportBatch) {
  const committed = structuredClone(batch);
  const db = await openLibrary();
  try {
    const tx = db.transaction(['items', 'batches'], 'readwrite'),
      done = complete(tx),
      store = tx.objectStore('items');
    for (const incoming of items) {
      const old = (await request(store.get(incoming.id))) as ResearchItem | undefined;
      const merged = mergeResearch(old, incoming);
      store.put(merged.item);
      committed[merged.kind]++;
      committed.read++;
    }
    committed.updatedAt = new Date().toISOString();
    committed.checkpoint.offset = committed.read;
    tx.objectStore('batches').put(committed);
    await done;
    Object.assign(batch, committed);
  } finally {
    db.close();
  }
}
export async function updateItem(item: ResearchItem) {
  const db = await openLibrary();
  try {
    const tx = db.transaction('items', 'readwrite'),
      done = complete(tx);
    tx.objectStore('items').put(item);
    await done;
  } finally {
    db.close();
  }
}
export interface StoredMedia {
  key: string;
  thumbnail: Blob;
  original?: Blob;
}
export async function storeMedia(media: StoredMedia) {
  const estimate = await navigator.storage?.estimate();
  const needed = media.thumbnail.size + (media.original?.size ?? 0);
  if (
    estimate?.quota &&
    estimate.usage !== undefined &&
    estimate.quota - estimate.usage < needed * 1.2
  )
    throw new Error('저장 공간이 부족합니다. 원본을 제외하거나 백업 후 공간을 확보해 주세요.');
  // Store bytes, not input-backed File handles. This also survives WebKit's
  // platform-specific Blob persistence restrictions and later source-file moves.
  const payload = {
    key: media.key,
    thumbnail: { type: media.thumbnail.type, bytes: await media.thumbnail.arrayBuffer() },
    original: media.original
      ? { type: media.original.type, bytes: await media.original.arrayBuffer() }
      : undefined,
  };
  const db = await openLibrary();
  try {
    const tx = db.transaction('media', 'readwrite'),
      done = complete(tx);
    tx.objectStore('media').put(payload);
    await done;
  } finally {
    db.close();
  }
}
export async function loadMedia(key: string) {
  const db = await openLibrary();
  try {
    const stored = await request(db.transaction('media').objectStore('media').get(key));
    if (!stored) return undefined;
    const blob = (v: Blob | { type: string; bytes: ArrayBuffer }) =>
      v instanceof Blob ? v : new Blob([v.bytes], { type: v.type });
    return {
      key: stored.key,
      thumbnail: blob(stored.thumbnail),
      original: stored.original ? blob(stored.original) : undefined,
    } satisfies StoredMedia;
  } finally {
    db.close();
  }
}
export async function thumbnail(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('썸네일 변환 실패'))),
        'image/webp',
        0.8,
      ),
    );
  } finally {
    bitmap.close();
  }
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function backupLibrary() {
  // Stream to disk where supported. Large originals never become one giant in-memory JSON.
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (o: unknown) => Promise<{
        createWritable: () => Promise<{
          write: (v: string) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    }
  ).showSaveFilePicker;
  let writer: {
    write: (v: string) => Promise<void>;
    close: () => Promise<void>;
    abort?: () => Promise<void>;
  } | null = picker
    ? await (await picker({ suggestedName: 'borichart-private-backup.jsonl' })).createWritable()
    : null;
  const items = await libraryItems(),
    batches = await libraryBatches();
  let temp:
    { root: FileSystemDirectoryHandle; file: FileSystemFileHandle; name: string } | undefined;
  if (!writer && navigator.storage?.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory(),
        name = 'coin-desk-backup-' + crypto.randomUUID() + '.jsonl';
      const file = await root.getFileHandle(name, { create: true });
      if ('createWritable' in file) {
        writer = await file.createWritable();
        temp = { root, file, name };
      }
    } catch {
      /* Restricted OPFS (including WebKit test ports): bounded small-file fallback below. */
    }
  }
  const chunks: string[] = [];
  let bytesInMemory = 0;
  const write = async (v: unknown) => {
    const line = JSON.stringify(v) + '\n';
    if (writer) await writer.write(line);
    else {
      bytesInMemory += line.length * 2;
      if (bytesInMemory > 64 * 1024 * 1024)
        throw new Error(
          '이 브라우저는 대용량 백업 저장을 지원하지 않습니다. Chrome에서 자료함을 백업해 주세요. 기존 자료는 유지됩니다.',
        );
      chunks.push(line);
    }
  };
  try {
    await write({ format: 'coin-desk-library', version: 1, batches });
    for (const item of items) await write({ type: 'item', item });
    for (const item of items)
      for (const m of item.media) {
        const stored = await loadMedia(m.key);
        if (!stored) continue;
        for (const kind of ['thumbnail', 'original'] as const) {
          const b = stored[kind];
          if (!b) continue;
          const bytes = new Uint8Array(await b.arrayBuffer());
          const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
            .map((v) => v.toString(16).padStart(2, '0'))
            .join('');
          for (let offset = 0; offset < bytes.length; offset += 192 * 1024) {
            const part = bytes.subarray(offset, offset + 192 * 1024);
            let binary = '';
            for (const value of part) binary += String.fromCharCode(value);
            await write({
              type: 'media',
              key: m.key,
              kind,
              mime: b.type,
              offset,
              total: bytes.length,
              sha256,
              data: btoa(binary),
            });
          }
        }
      }
    if (writer) {
      await writer.close();
      if (temp) {
        downloadBlob(await temp.file.getFile(), 'borichart-private-backup.jsonl');
        const saved = temp;
        setTimeout(() => void saved.root.removeEntry(saved.name).catch(() => {}), 60000);
      }
    } else
      downloadBlob(
        new Blob(chunks, { type: 'application/x-ndjson' }),
        'borichart-private-backup.jsonl',
      );
  } catch (e) {
    await writer?.abort?.().catch(() => {});
    if (temp) await temp.root.removeEntry(temp.name).catch(() => {});
    throw e;
  }
}
export async function restoreLibrary(
  file: File,
  progress: (n: number) => void,
  stopped: () => boolean,
) {
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '',
    header = false,
    count = 0;
  let media: {
    key: string;
    kind: 'thumbnail' | 'original';
    mime: string;
    total: number;
    offset: number;
    parts: Uint8Array<ArrayBuffer>[];
    sha256?: string;
  } | null = null;
  const batch: ImportBatch = {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    read: 0,
    added: 0,
    changed: 0,
    duplicate: 0,
    rejected: 0,
    checkpoint: { source: 'backup', offset: 0, status: 'running' },
  };
  const keys = new Set<string>();
  let chunk: ResearchItem[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += value ?? '';
      let split: number;
      while ((split = buffer.indexOf('\n')) >= 0) {
        if (stopped())
          throw new Error('복원 중지 · 저장된 행은 유지됩니다. 같은 파일로 재개할 수 있습니다.');
        const line = buffer.slice(0, split);
        buffer = buffer.slice(split + 1);
        if (!line.trim()) continue;
        const row = JSON.parse(line);
        if (!header) {
          if (row.format !== 'coin-desk-library' || row.version !== 1)
            throw new Error('지원하지 않는 백업입니다.');
          header = true;
          continue;
        }
        if (row.type === 'item') {
          const item = normalizeResearch(row.item, 'backup:' + file.name);
          item.origins = [
            ...new Set([
              ...(Array.isArray(row.item.origins)
                ? row.item.origins.filter((s: unknown) => typeof s === 'string')
                : []),
              ...item.origins,
            ]),
          ];
          item.revisions = Array.isArray(row.item.revisions)
            ? row.item.revisions.filter(
                (r: unknown) =>
                  r && typeof r === 'object' && typeof (r as { text: unknown }).text === 'string',
              )
            : [];
          chunk.push(item);
          item.media.forEach((m) => keys.add(m.key));
          if (chunk.length >= 100) {
            await importItems(chunk, batch);
            chunk = [];
          }
          count++;
          progress(count);
        } else if (row.type === 'media') {
          if (chunk.length) {
            await importItems(chunk, batch);
            chunk = [];
          }
          if (
            !keys.has(row.key) ||
            !['thumbnail', 'original'].includes(row.kind) ||
            !/^image\/(png|jpeg|webp|gif)$/.test(row.mime) ||
            !Number.isSafeInteger(row.total) ||
            row.total <= 0 ||
            row.total > 50 * 1024 * 1024 ||
            typeof row.data !== 'string' ||
            row.data.length > 300000
          )
            throw new Error('백업 이미지 형식 오류');
          if (row.offset === 0) {
            if (media) throw new Error('이전 이미지 조각 누락');
            media = {
              key: row.key,
              kind: row.kind,
              mime: row.mime,
              total: row.total,
              offset: 0,
              parts: [],
              sha256: row.sha256,
            };
          }
          if (
            !media ||
            media.key !== row.key ||
            media.kind !== row.kind ||
            media.offset !== row.offset ||
            media.total !== row.total ||
            media.mime !== row.mime ||
            media.sha256 !== row.sha256
          )
            throw new Error('이미지 조각 순서 오류');
          const bytes = Uint8Array.from(atob(row.data), (c) => c.charCodeAt(0));
          media.parts.push(bytes);
          media.offset += bytes.length;
          if (media.offset > media.total) throw new Error('이미지 크기 불일치');
          if (media.offset === media.total) {
            const previous = await loadMedia(media.key);
            const blob = new Blob(media.parts, { type: media.mime });
            if (media.sha256) {
              const actual = [
                ...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
              ]
                .map((v) => v.toString(16).padStart(2, '0'))
                .join('');
              if (actual !== media.sha256)
                throw new Error('백업 이미지 해시 불일치 · 기존 이미지 유지');
            }
            await storeMedia({
              key: media.key,
              thumbnail:
                media.kind === 'thumbnail'
                  ? blob
                  : (previous?.thumbnail ?? (await thumbnail(blob))),
              original: media.kind === 'original' ? blob : previous?.original,
            });
            media = null;
          }
        } else throw new Error('알 수 없는 백업 행');
      }
      if (buffer.length > 1024 * 1024) throw new Error('백업 행 크기 제한 초과');
      if (done) break;
    }
    if (buffer.trim() || media) throw new Error('백업 마지막 행 또는 이미지 조각 누락');
    if (!header) throw new Error('빈 백업입니다.');
    if (chunk.length) await importItems(chunk, batch);
    batch.checkpoint.status = 'complete';
    await saveBatch(batch);
  } catch (e) {
    batch.checkpoint.status = 'failed';
    batch.checkpoint.reason = String(e);
    await saveBatch(batch);
    throw e;
  } finally {
    await reader.cancel();
  }
  return count;
}

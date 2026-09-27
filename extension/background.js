import { allowedSite, allowedSource, validNonce, mediaUrl } from './protocol.js';
async function imageBytes(url) {
  const response = await fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('이미지 HTTP ' + response.status);
  const mime = response.headers.get('content-type')?.split(';')[0];
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mime ?? ''))
    throw new Error('지원하지 않는 이미지 형식');
  const reader = response.body.getReader(),
    parts = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 25 * 1024 * 1024) throw new Error('이미지 25MB 제한');
      parts.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return { bytes, mime };
}
async function db() {
  return await new Promise((resolve, reject) => {
    const r = indexedDB.open('coin-desk-x-import', 2);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains('posts'))
        r.result.createObjectStore('posts', { keyPath: 'post_id' });
      if (!r.result.objectStoreNames.contains('transfers'))
        r.result.createObjectStore('transfers', { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function store(rows) {
  const d = await db();
  try {
    await new Promise((resolve, reject) => {
      const tx = d.transaction('posts', 'readwrite');
      for (const row of rows) tx.objectStore('posts').put(row);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    d.close();
  }
}
async function posts() {
  const d = await db();
  try {
    return await new Promise((resolve, reject) => {
      const r = d.transaction('posts').objectStore('posts').getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    d.close();
  }
}
async function transferSnapshot(value) {
  const d = await db();
  try {
    return await new Promise((resolve, reject) => {
      const tx = d.transaction('transfers', value ? 'readwrite' : 'readonly');
      const request = value
        ? tx.objectStore('transfers').put({ id: 'active', ...value })
        : tx.objectStore('transfers').get('active');
      let result;
      request.onsuccess = () => {
        result = request.result;
      };
      tx.oncomplete = () => resolve(value ?? result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    d.close();
  }
}
async function begin(url, mode, queue = [], checkpoint) {
  if (!allowedSource(url))
    throw new Error('X 게시물·북마크·리스트·계정 주소만 사용할 수 있습니다.');
  if (!['post', 'bookmarks', 'account', 'list'].includes(mode)) throw new Error('수집 방식 오류');
  const previous = (await chrome.storage.local.get('job')).job;
  if (previous?.tabId)
    await chrome.tabs.sendMessage(previous.tabId, { type: 'STOP' }).catch(() => {});
  const tab = await chrome.tabs.create({ url, active: true });
  await chrome.storage.local.set({
    job: {
      tabId: tab.id,
      url,
      mode,
      queue,
      status: 'waiting',
      collected: checkpoint?.collected ?? 0,
      lastId: checkpoint?.lastId,
      scroll: checkpoint?.scroll,
      updatedAt: new Date().toISOString(),
      coverage: '화면 접근 범위만 수집',
    },
  });
}
chrome.tabs.onUpdated.addListener(async (id, change, tab) => {
  if (change.status !== 'complete') return;
  const { job } = await chrome.storage.local.get('job');
  if (job?.tabId !== id || job.status !== 'waiting' || !allowedSource(tab.url)) return;
  for (let i = 0; i < 5; i++) {
    try {
      const current = (await chrome.storage.local.get('job')).job;
      if (current?.tabId !== id || current.status !== 'waiting') return;
      await chrome.storage.local.set({ job: { ...current, status: 'running' } });
      await chrome.tabs.sendMessage(id, { type: 'START', mode: job.mode });
      break;
    } catch {
      const current = (await chrome.storage.local.get('job')).job;
      if (current?.tabId !== id || current.status === 'paused') return;
      await chrome.storage.local.set({
        job: {
          ...current,
          status: i === 4 ? 'failed' : 'waiting',
          reason: i === 4 ? '화면 수집기를 연결하지 못했습니다. X 탭 확인 후 재개하세요.' : '',
        },
      });
      await new Promise((r) => setTimeout(r, 500));
    }
  }
});
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  (async () => {
    if (sender.id !== chrome.runtime.id) throw new Error('확장 발신자 오류');
    if (m.type === 'BIND') {
      if (!sender.tab || !allowedSite(sender.url) || !validNonce(m.nonce))
        throw new Error('자료함 연결 대상 오류');
      await chrome.storage.session.set({
        connection: {
          tabId: sender.tab.id,
          url: sender.url,
          nonce: m.nonce,
          expires: Date.now() + 30 * 60 * 1000,
          sequence: 0,
        },
      });
      return { ok: true };
    }
    if (m.type === 'ROWS') {
      const { job } = await chrome.storage.local.get('job');
      if (
        sender.tab?.id !== job?.tabId ||
        !allowedSource(sender.url) ||
        job.status !== 'running' ||
        !Array.isArray(m.rows) ||
        m.rows.length > 100
      )
        throw new Error('수집 대상 오류');
      const rows = m.rows.filter(
        (r) =>
          /^\d{1,30}$/.test(r.post_id) && typeof r.text === 'string' && r.text.length <= 100000,
      );
      await store(rows);
      const current = (await chrome.storage.local.get('job')).job;
      if (current?.tabId !== job.tabId) return { ok: true };
      await chrome.storage.local.set({
        job: {
          ...current,
          collected: job.collected + rows.length,
          lastId: rows.at(-1)?.post_id ?? job.lastId,
          scroll: m.scroll,
          status: current.status === 'paused' ? 'paused' : 'running',
          updatedAt: new Date().toISOString(),
        },
      });
      return { ok: true };
    }
    if (m.type === 'DONE') {
      const { job } = await chrome.storage.local.get('job');
      if (sender.tab?.id !== job?.tabId) return {};
      if (job.status === 'paused') return { ok: true };
      const { coverage = {} } = await chrome.storage.local.get('coverage');
      coverage[job.url] = {
        status: m.status,
        reason: m.reason,
        lastId: job.lastId,
        collected: job.collected,
        checkedAt: new Date().toISOString(),
      };
      await chrome.storage.local.set({ coverage });
      const members = Array.isArray(m.members)
        ? m.members.filter((h) => /^[A-Za-z0-9_]{1,15}$/.test(h))
        : [];
      const queue = members.length ? members.map((h) => 'https://x.com/' + h) : (job.queue ?? []);
      if (queue.length && !['paused', 'failed'].includes(m.status) && m.readable !== false) {
        const [url, ...rest] = queue;
        await chrome.storage.local.set({
          job: {
            ...job,
            url,
            mode: 'account',
            queue: rest,
            collected: 0,
            lastId: undefined,
            scroll: 0,
            status: 'waiting',
            lastResult: m.reason,
          },
        });
        await chrome.tabs.update(job.tabId, { url });
      } else
        await chrome.storage.local.set({
          job: {
            ...job,
            status: m.status || 'access-limited',
            reason: m.reason,
            updatedAt: new Date().toISOString(),
          },
        });
      return { ok: true };
    }
    // Popup commands cannot be invoked by a page content script.
    if (sender.tab) throw new Error('이 작업은 확장 창에서 시작해 주세요.');
    if (m.type === 'STATUS') {
      const state = await chrome.storage.local.get(['job', 'transfer', 'transferCheckpoint']),
        connection = await chrome.storage.session.get('connection');
      return {
        ...state,
        connected: !!connection.connection && connection.connection.expires > Date.now(),
        stored: (await posts()).length,
      };
    }
    if (m.type === 'START') {
      await begin(m.url, m.mode);
      return { ok: true };
    }
    if (m.type === 'STOP') {
      const { transferCheckpoint } = await chrome.storage.local.get('transferCheckpoint');
      if (transferCheckpoint)
        await chrome.storage.local.set({
          transferCheckpoint: { ...transferCheckpoint, status: 'paused' },
        });
      const { job } = await chrome.storage.local.get('job');
      if (job) {
        await chrome.storage.local.set({ job: { ...job, status: 'paused' } });
        await chrome.tabs.sendMessage(job.tabId, { type: 'STOP' }).catch(() => {});
      }
      return { ok: true };
    }
    if (m.type === 'RESUME') {
      const { job } = await chrome.storage.local.get('job');
      if (!job) throw new Error('재개할 작업이 없습니다.');
      try {
        await chrome.storage.local.set({ job: { ...job, status: 'running' } });
        const response = await chrome.tabs.sendMessage(job.tabId, {
          type: 'START',
          mode: job.mode,
        });
        if (response?.error) throw new Error(response.error);
      } catch {
        await begin(job.url, job.mode, job.queue, job);
      }
      return { ok: true };
    }
    if (m.type === 'EXPORT') return { rows: await posts() };
    if (m.type === 'SEND') {
      const { connection: c } = await chrome.storage.session.get('connection');
      if (!c || c.expires < Date.now())
        throw new Error('Coin Desk 자료함에서 Chrome 연결을 먼저 눌러 주세요.');
      const tab = await chrome.tabs.get(c.tabId);
      if (!allowedSite(tab.url) || new URL(tab.url).origin !== new URL(c.url).origin)
        throw new Error('연결했던 자료함 탭이 변경됐습니다.');
      const destination = new URL(c.url).origin;
      const { transferCheckpoint: prior } = await chrome.storage.local.get('transferCheckpoint');
      const saved = await transferSnapshot();
      const useSaved =
        prior &&
        saved &&
        prior.signature === saved.signature &&
        prior.destination === destination &&
        prior.includeImages === !!m.images &&
        prior.status !== 'complete';
      const rows = useSaved ? saved.rows : await posts();
      const signature = useSaved
        ? saved.signature
        : [
            ...new Uint8Array(
              await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rows))),
            ),
          ]
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
      if (!useSaved) await transferSnapshot({ signature, rows });
      const resumable =
        prior &&
        prior.signature === signature &&
        prior.destination === destination &&
        prior.includeImages === !!m.images &&
        prior.status !== 'complete';
      const progress = resumable
        ? { ...prior, status: 'running' }
        : {
            signature,
            destination,
            includeImages: !!m.images,
            rowOffset: 0,
            mediaIndex: 0,
            images: 0,
            failed: 0,
            status: 'running',
          };
      if (m.continue && prior?.status === 'paused') return { ok: true, more: false, paused: true };
      progress.totalRows = rows.length;
      const imagesToSend = m.images
        ? rows.flatMap((row) =>
            (row.images ?? []).flatMap((image, index) => {
              const url = mediaUrl(image.url);
              return url ? [{ url, key: 'x:' + row.post_id + ':' + index }] : [];
            }),
          )
        : [];
      progress.totalImages = imagesToSend.length;
      if (
        m.images &&
        !(await chrome.permissions.contains({ origins: ['https://pbs.twimg.com/*'] }))
      )
        throw new Error('이미지 권한이 없습니다. 확장에서 다시 전송하세요.');
      const checkpoint = async () => {
        const current = (await chrome.storage.local.get('transferCheckpoint')).transferCheckpoint;
        if (current?.signature === signature && current.status === 'paused')
          throw new Error('전송을 중지했습니다. 같은 전송 버튼으로 이어 보낼 수 있습니다.');
        await chrome.storage.local.set({
          transferCheckpoint: { ...progress, updatedAt: new Date().toISOString() },
        });
      };
      await chrome.storage.local.set({ transferCheckpoint: progress });
      const transmit = async (payload) => {
        await checkpoint();
        if (Date.now() > c.expires)
          throw new Error('연결 시간이 끝났습니다. 다시 연결해 재개하세요.');
        const sequence = c.sequence++;
        await chrome.storage.session.set({ connection: c });
        const ack = await chrome.tabs.sendMessage(c.tabId, {
          ...payload,
          nonce: c.nonce,
          sequence,
        });
        if (!ack?.ok)
          throw new Error(ack?.error || '전송 확인이 없습니다. 자료는 확장에 보존됩니다.');
      };
      // Each message finishes quickly; the popup starts the next burst. A closed
      // popup, expired connection or suspended MV3 worker can resume this cursor.
      const started = Date.now();
      const rowEnd = Math.min(rows.length, progress.rowOffset + 500);
      while (progress.rowOffset < rowEnd) {
        await transmit({
          type: 'TRANSFER',
          rows: rows.slice(progress.rowOffset, progress.rowOffset + 100),
        });
        progress.rowOffset = Math.min(rows.length, progress.rowOffset + 100);
        await checkpoint();
      }
      if (progress.rowOffset < rows.length)
        return {
          ok: true,
          more: true,
          count: progress.rowOffset,
          images: progress.images,
          failed: progress.failed,
        };
      const imageEnd = Math.min(imagesToSend.length, progress.mediaIndex + 20);
      while (progress.mediaIndex < imageEnd && Date.now() - started < 60000) {
        const image = imagesToSend[progress.mediaIndex];
        let payload;
        try {
          payload = await imageBytes(image.url);
        } catch {
          progress.failed++;
          progress.mediaIndex++;
          await checkpoint();
          continue;
        }
        for (let offset = 0; offset < payload.bytes.length; offset += 192 * 1024) {
          let binary = '';
          for (const byte of payload.bytes.subarray(offset, offset + 192 * 1024))
            binary += String.fromCharCode(byte);
          await transmit({
            type: 'TRANSFER_MEDIA',
            key: image.key,
            mime: payload.mime,
            total: payload.bytes.length,
            offset,
            data: btoa(binary),
          });
        }
        progress.images++;
        progress.mediaIndex++;
        await checkpoint();
      }
      if (progress.mediaIndex < imagesToSend.length)
        return {
          ok: true,
          more: true,
          count: progress.rowOffset,
          images: progress.images,
          failed: progress.failed,
        };
      const { images, failed } = progress;
      await transmit({ type: 'TRANSFER_DONE', images, failed });
      progress.status = 'complete';
      await checkpoint();
      await chrome.storage.local.set({
        transfer: { at: new Date().toISOString(), rows: rows.length, images, failed },
      });
      return { ok: true, count: rows.length, images, failed };
    }
    return {};
  })().then(reply, (e) => reply({ error: String(e.message ?? e) }));
  return true;
});

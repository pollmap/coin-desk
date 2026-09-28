(() => {
  let nonce = null,
    expires = 0;
  const pending = new Map();
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const m = event.data;
    if (
      location.pathname === '/workspace/library' &&
      m?.type === 'CD_LIBRARY_HELLO' &&
      /^[a-f0-9-]{36}$/.test(m.nonce)
    ) {
      nonce = m.nonce;
      expires = Date.now() + 30 * 60 * 1000;
      const requestNonce = nonce;
      chrome.runtime
        .sendMessage({ type: 'BIND', nonce })
        .then((result) => {
          if (nonce !== requestNonce) return;
          window.postMessage(
            {
              type: 'CD_LIBRARY_READY',
              nonce,
              error:
                result?.ok === true
                  ? undefined
                  : result?.error || '확장 연결을 확인하지 못했습니다.',
              version: chrome.runtime.getManifest?.().version,
            },
            location.origin,
          );
        })
        .catch(() => {
          if (nonce === requestNonce)
            window.postMessage(
              { type: 'CD_LIBRARY_READY', nonce, error: '확장을 새로고침하고 다시 연결해 주세요.' },
              location.origin,
            );
        });
    }
    if (m?.type === 'CD_LIBRARY_ACK' && m.nonce === nonce) {
      const complete = pending.get(m.sequence);
      if (complete) {
        pending.delete(m.sequence);
        complete(m.error ? { error: m.error } : { ok: true });
      }
    }
  });
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (!['TRANSFER', 'TRANSFER_MEDIA', 'TRANSFER_DONE'].includes(m.type)) return;
    if (
      sender.id !== chrome.runtime.id ||
      m.nonce !== nonce ||
      Date.now() > expires ||
      location.pathname !== '/workspace/library' ||
      (m.type === 'TRANSFER' && (!Array.isArray(m.rows) || m.rows.length > 100))
    ) {
      reply({ error: '유효한 자료함 연결이 아닙니다.' });
      return;
    }
    const timer = setTimeout(() => {
      pending.delete(m.sequence);
      reply({ error: '저장 확인 시간 초과' });
    }, 20000);
    pending.set(m.sequence, (result) => {
      clearTimeout(timer);
      reply(result);
    });
    window.postMessage(
      {
        ...m,
        type:
          m.type === 'TRANSFER'
            ? 'CD_LIBRARY_CHUNK'
            : m.type === 'TRANSFER_MEDIA'
              ? 'CD_LIBRARY_MEDIA'
              : 'CD_LIBRARY_DONE',
      },
      location.origin,
    );
    return true;
  });
})();

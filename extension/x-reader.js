(() => {
  let running = false,
    stop = false;
  const seen = new Set(),
    members = new Set();
  function readPosts(mode) {
    return [...document.querySelectorAll('main article')].flatMap((article) => {
      const time = article.querySelector('time'),
        link = time?.closest('a');
      if (!link) return [];
      const match = link.getAttribute('href')?.match(/^\/([A-Za-z0-9_]+)\/status\/(\d+)/);
      if (!match || seen.has(match[2])) return [];
      if (mode === 'post' && match[2] !== location.pathname.match(/\/status\/(\d+)/)?.[1])
        return [];
      seen.add(match[2]);
      const images = [...article.querySelectorAll('img')]
        .map((i) => i.currentSrc || i.src)
        .filter((u) => {
          try {
            const x = new URL(u);
            return x.origin === 'https://pbs.twimg.com' && x.pathname.startsWith('/media/');
          } catch {
            return false;
          }
        })
        .map((url) => ({ url }));
      return [
        {
          post_id: match[2],
          account: match[1],
          post_url: 'https://x.com/' + match[1] + '/status/' + match[2],
          date_utc: time.getAttribute('datetime'),
          text: article.querySelector('[data-testid="tweetText"]')?.textContent ?? '',
          text_truncated: !!article.querySelector('[data-testid="tweet-text-show-more-link"]'),
          capture_url: location.origin + location.pathname,
          images,
        },
      ];
    });
  }
  function readMembers() {
    for (const cell of document.querySelectorAll(
      'main [data-testid="UserCell"], [role="dialog"] [data-testid="UserCell"]',
    ))
      for (const a of cell.querySelectorAll('a[href]')) {
        const h = a.getAttribute('href')?.match(/^\/([A-Za-z0-9_]{1,15})$/);
        if (h) members.add(h[1]);
      }
  }
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  async function run(mode) {
    if (running) return;
    running = true;
    stop = false;
    seen.clear();
    let unchanged = 0,
      oldSize = 0,
      rounds = 0;
    let reason = '화면 끝 또는 추가 로딩 없음 · 전체 과거 이력은 미확인',
      status = 'access-limited';
    try {
      while (!stop && rounds++ < 1200) {
        if (mode === 'list') readMembers();
        else {
          const rows = readPosts(mode);
          for (let offset = 0; offset < rows.length; offset += 100) {
            const result = await chrome.runtime.sendMessage({
              type: 'ROWS',
              rows: rows.slice(offset, offset + 100),
              scroll: window.scrollY,
            });
            if (result.error) throw new Error(result.error);
          }
        }
        const size = mode === 'list' ? members.size : seen.size;
        if (mode === 'post' && size) {
          reason = '현재 게시물 화면 읽기 완료';
          status = 'complete';
          break;
        }
        if (size === oldSize) unchanged++;
        else unchanged = 0;
        oldSize = size;
        if (unchanged >= 8) {
          if (!size) reason = '로그인·접근 권한·화면 구조를 확인해 주세요. 읽을 항목이 없습니다.';
          break;
        }
        const dialog = document.querySelector('[role="dialog"]');
        const scroller =
          dialog &&
          [...dialog.querySelectorAll('*')].find(
            (el) =>
              el.scrollHeight > el.clientHeight + 100 &&
              ['auto', 'scroll'].includes(getComputedStyle(el).overflowY),
          );
        if (scroller) scroller.scrollBy(0, Math.max(500, scroller.clientHeight * 0.85));
        else window.scrollBy(0, Math.max(600, innerHeight * 0.85));
        await pause(1500);
      }
      if (stop) {
        reason = '사용자가 중지했습니다.';
        status = 'paused';
      }
      if (rounds >= 1200) {
        reason = '안전 실행 구간 종료 · 재개 가능';
        status = 'paused';
      }
    } catch (e) {
      reason = String(e);
      status = 'failed';
    } finally {
      running = false;
      await chrome.runtime
        .sendMessage({
          type: 'DONE',
          status,
          reason,
          members: mode === 'list' && !stop ? [...members] : [],
          readable: mode === 'list' ? members.size > 0 : seen.size > 0,
        })
        .catch(() => {});
    }
  }
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (m.type === 'START') {
      if (running) {
        reply({ error: '이전 실행이 종료 중입니다. 새 탭에서 재개합니다.' });
        return;
      }
      void run(m.mode);
      reply({ ok: true });
    }
    if (m.type === 'STOP') {
      stop = true;
      reply({ ok: true });
    }
  });
})();

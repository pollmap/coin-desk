const $ = (id) => document.getElementById(id),
  send = async (m) => {
    const r = await chrome.runtime.sendMessage(m);
    if (r?.error) throw new Error(r.error);
    return r;
  };
let activeUrl = '';
const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
activeUrl = active?.url ?? '';
if (activeUrl.startsWith('https://x.com/')) $('url').value = activeUrl;
async function status() {
  try {
    const s = await send({ type: 'STATUS' });
    $('status').textContent =
      '보관 ' +
      s.stored +
      '건 · 자료함 ' +
      (s.connected ? '연결됨' : '미연결') +
      '\n' +
      (s.job
        ? ({
            waiting: '화면 여는 중',
            running: '읽는 중',
            paused: '일시 중지',
            failed: '확인 필요',
            'access-limited': '확인 가능한 범위까지 읽음',
            complete: '현재 게시물 읽기 완료',
          }[s.job.status] ?? '상태 확인 중') +
          '\n이번 계정에서 읽은 행 ' +
          s.job.collected +
          ' · 남은 계정 ' +
          (s.job.queue?.length ?? 0) +
          '\n' +
          (s.job.reason ?? s.job.coverage)
        : '시작할 자료를 선택하세요.') +
      (s.transfer
        ? '\n최근 전송 ' +
          s.transfer.rows +
          '건 · 이미지 ' +
          s.transfer.images +
          '개 · 실패 ' +
          s.transfer.failed +
          '개'
        : '');
  } catch (e) {
    $('status').textContent = String(e);
  }
}
async function action(fn) {
  for (const button of document.querySelectorAll('button'))
    if (button.id !== 'stop') button.disabled = true;
  try {
    await fn();
    await status();
  } catch (e) {
    $('status').textContent = String(e.message ?? e);
  } finally {
    for (const button of document.querySelectorAll('button')) button.disabled = false;
  }
}
$('start').onclick = () =>
  action(async () => {
    const mode = $('mode').value;
    let url = $('url').value.trim();
    if (mode === 'bookmarks') url = 'https://x.com/i/bookmarks';
    if (mode === 'list') {
      const match = url.match(/\/i\/lists\/(\d+)/);
      if (!match) throw new Error('리스트 주소를 넣어 주세요.');
      url = 'https://x.com/i/lists/' + match[1] + '/members';
    }
    await send({ type: 'START', url, mode });
  });
$('stop').onclick = () => action(() => send({ type: 'STOP' }));
$('resume').onclick = () => action(() => send({ type: 'RESUME' }));
$('send').onclick = () =>
  action(async () => {
    const images = $('images').checked;
    if (images && !(await chrome.permissions.request({ origins: ['https://pbs.twimg.com/*'] })))
      throw new Error('이미지 도메인 접근이 허용되지 않았습니다.');
    const result = await send({ type: 'SEND', images });
    $('status').textContent =
      result.count + '건 전송 · 이미지 ' + result.images + ' · 이미지 실패 ' + result.failed;
  });
$('export').onclick = () =>
  action(async () => {
    const { rows } = await send({ type: 'EXPORT' }),
      url = URL.createObjectURL(
        new Blob(
          rows.map((r) => JSON.stringify(r) + '\n'),
          { type: 'application/x-ndjson' },
        ),
      ),
      a = document.createElement('a');
    a.href = url;
    a.download = 'coin-desk-x-private.jsonl';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
$('local').onclick = () =>
  action(async () => {
    const granted = await chrome.permissions.request({
      origins: ['http://127.0.0.1/*', 'http://localhost/*'],
    });
    if (!granted)
      throw new Error('로컬 접근이 허용되지 않았습니다. 공개 사이트 자료함을 사용할 수 있습니다.');
    const registered = await chrome.scripting.getRegisteredContentScripts({
      ids: ['coin-desk-local'],
    });
    if (!registered.length)
      await chrome.scripting.registerContentScripts([
        {
          id: 'coin-desk-local',
          matches: ['http://127.0.0.1/*', 'http://localhost/*'],
          js: ['site-bridge.js'],
          runAt: 'document_idle',
          persistAcrossSessions: true,
        },
      ]);
  });
await status();
setInterval(status, 3000);

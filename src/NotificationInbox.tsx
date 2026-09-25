import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, X } from 'lucide-react';
import {
  SIGNAL_RULES,
  signalLabels,
  type ObservationSignal,
  type DailyBriefing,
  type SignalRule,
} from '../shared/signals';
import { useData } from './hooks';
import { dateLabel, money, saved, save } from './lib';
export function NotificationInbox() {
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<string[]>(() => saved('inbox-read', []));
  const [rules, setRules] = useState<SignalRule[]>(() => saved('inbox-rules', [...SIGNAL_RULES]));
  const btc = useData<{ data: ObservationSignal[] }>('/api/v1/signals?asset=BTC', false, 300000);
  const doge = useData<{ data: ObservationSignal[] }>('/api/v1/signals?asset=DOGE', false, 300000);
  const eth = useData<{ data: ObservationSignal[] }>('/api/v1/signals?asset=ETH', false, 300000);
  const briefings = useData<{ data: DailyBriefing[] }>('/api/v1/briefings', false, 300000);
  const signals = [...(btc.data?.data ?? []), ...(doge.data?.data ?? []), ...(eth.data?.data ?? [])]
    .filter((s) => s.notify && s.status !== 'withdrawn' && rules.includes(s.rule))
    .sort((a, b) => b.time - a.time);
  const briefs = briefings.data?.data ?? [];
  const ids = [...signals.map((s) => s.id), ...briefs.map((b) => 'brief:' + b.id)];
  const unread = ids.filter((id) => !read.includes(id)).length;
  function mark(ids: string[]) {
    const next = [...new Set([...read, ...ids])].slice(-1000);
    setRead(next);
    save('inbox-read', next);
  }
  function close() {
    dialog.current?.close();
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <>
      <button
        ref={trigger}
        className="icon-button inbox-trigger"
        aria-label={`알림함${unread ? ` · 읽지 않은 항목 ${unread}개` : ''}`}
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        <Bell size={18} />
        {unread > 0 && <span>{unread > 99 ? '99+' : unread}</span>}
      </button>
      <dialog
        ref={dialog}
        className="inbox-dialog"
        aria-labelledby="inbox-title"
        onCancel={() => close()}
        onClose={() => {
          setOpen(false);
          trigger.current?.focus();
        }}
      >
        <div className="picker-heading">
          <h2 id="inbox-title">알림함</h2>
          <button aria-label="알림함 닫기" onClick={close}>
            <X />
          </button>
        </div>
        <div className="inbox-actions">
          <button onClick={() => mark(ids)}>모두 읽음</button>
          <details>
            <summary>관심 규칙</summary>
            {SIGNAL_RULES.map((rule) => (
              <label key={rule}>
                <input
                  type="checkbox"
                  checked={rules.includes(rule)}
                  onChange={() => {
                    const next = rules.includes(rule)
                      ? rules.filter((r) => r !== rule)
                      : [...rules, rule];
                    setRules(next);
                    save('inbox-rules', next);
                  }}
                />
                {signalLabels[rule]}
              </label>
            ))}
          </details>
        </div>
        <h3>
          일일 브리핑 <small>매일 09:10 KST</small>
        </h3>
        {briefs.slice(0, 7).map((b) => (
          <details
            className="briefing"
            key={b.id}
            onToggle={(e) => {
              if (e.currentTarget.open) mark(['brief:' + b.id]);
            }}
          >
            <summary>
              {!read.includes('brief:' + b.id) ? '● ' : ''}
              {b.date} · 관찰 신호 {b.signals}개
            </summary>
            <dl>
              {b.prices.map((p) => (
                <div key={p.asset}>
                  <dt>{p.asset}</dt>
                  <dd>
                    {money(p.price, p.unit)} ·{' '}
                    {p.change === null ? '—' : `${p.change >= 0 ? '+' : ''}${p.change.toFixed(2)}%`}
                    <small>
                      {p.source} · {dateLabel(p.asOf)} 확정 종가
                    </small>
                  </dd>
                </div>
              ))}
            </dl>
            {b.missing.length > 0 && <p className="amber">자료 지연: {b.missing.join(', ')}</p>}
          </details>
        ))}
        {!briefs.length && (
          <p>
            {briefings.error
              ? '브리핑 조회가 지연되고 있습니다.'
              : '첫 서버 브리핑을 기다리고 있습니다.'}
          </p>
        )}
        <h3>새 관찰 신호</h3>
        {signals.map((s) => (
          <Link
            className="signal-row"
            key={s.id}
            to={
              '/?' +
              new URLSearchParams({
                asset: s.asset,
                price_source: ['upbit', 'binance'].includes(s.source) ? s.source : 'reference',
                period: 'all',
                signal: s.id,
                panels:
                  s.rule === 'mvrv1'
                    ? 'net:mvrv'
                    : s.rule === 'funding0'
                      ? 'futures:funding'
                      : 'rsi,drawdown',
              })
            }
            onClick={() => {
              mark([s.id]);
              close();
            }}
          >
            <b>
              {!read.includes(s.id) ? '● ' : ''}
              {s.asset} · {signalLabels[s.rule]} {s.direction === 'up' ? '상향 통과' : '하향 통과'}
            </b>
            <span>
              {s.source} · {dateLabel(s.time)}
            </span>
          </Link>
        ))}
        {!signals.length && <p>관심 규칙에 해당하는 새 알림이 없습니다.</p>}
        {(btc.error || doge.error || eth.error) && (
          <p role="status">일부 코인의 신호 조회가 지연됩니다.</p>
        )}
        <small>조건 변화 알림입니다. 과거 자료 보충은 새 알림을 만들지 않습니다.</small>
      </dialog>
    </>
  );
}

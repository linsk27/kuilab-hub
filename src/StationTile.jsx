import React, { useEffect, useState } from 'react';
import { ArrowUpRight } from '@phosphor-icons/react';
import { rpc } from './station-rpc';

// 首页右下角那一行「联络站」。
// 两种资料源，按可用性自动降级：
//   1) public/guestbook.json 里如果填了 { "space": "...", "secret": "..." }，
//      就拉那个空间最近一条留言，显示“最近有人说：…”。（空间得由作者在 /hub 里开）
//   2) 没配置就退回在线状态：作者此刻在不在，留言多久回。
// 都不阻塞首屏：presence 失败就按“不在线”显示，留言读不到就隐藏那半句。

const POLL = 60000;

function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, Date.now() - t);
  const min = Math.round(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

export default function StationTile() {
  const [online, setOnline] = useState(null);
  const [guestbook, setGuestbook] = useState(null);
  const [latest, setLatest] = useState(null);

  // 有没有开公用留言空间
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}guestbook.json`, { signal: controller.signal })
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (data?.space && data?.secret) setGuestbook(data); })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let alive = true;
    let running = false;

    // skipHidden：轮询时后台标签页就别打了；但第一次无论如何都要拿到状态，
    // 否则用户在一个隐藏标签页里打开，回来看到的是“留言当天回”这种兜底文案
    async function tick(skipHidden = true) {
      if (running || (skipHidden && document.hidden)) return;
      running = true;
      try {
        if (guestbook) {
          const data = await rpc('guest_read', { space: guestbook.space, secret: guestbook.secret });
          if (!alive) return;
          const list = Array.isArray(data?.messages) ? data.messages : [];
          const mine = list.filter(m => m && m.body && m.sender !== 'author');
          setLatest(mine.length ? mine[mine.length - 1] : null);
          setOnline(Boolean(data?.online));
        } else {
          const data = await rpc('presence', {});
          if (alive) setOnline(Boolean(data?.online));
        }
      } catch {
        if (alive) setOnline(false);
      } finally {
        running = false;
      }
    }

    tick(false);
    const timer = window.setInterval(() => tick(true), POLL);
    const onVisible = () => { if (!document.hidden) tick(true); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [guestbook]);

  const state = online === null ? 'unknown' : online ? 'on' : 'off';
  const line = latest
    ? <><span className="station-quote">“{String(latest.body).slice(0, 42)}{String(latest.body).length > 42 ? '…' : ''}”</span><span className="station-when">{timeAgo(latest.created_at)}</span></>
    : <span className="station-status">{state === 'on' ? '此刻在线，留言一般当天回' : state === 'off' ? '不在线，留言也会看到' : '留言当天回'}</span>;

  return (
    <a className="station-tile" href="/hub" aria-label="去联络站留言">
      <span className={`station-dot is-${state}`} aria-hidden="true" />
      <span className="station-head">联络站</span>
      {latest ? <span className="station-quote">“{String(latest.body).slice(0, 26)}{String(latest.body).length > 26 ? '…' : ''}”</span>
        : <span className="station-status">{state === 'on' ? '此刻在线，留言当天回' : state === 'off' ? '不在线，留言也会看到' : '留言当天回'}</span>}
      {latest && <span className="station-when">{timeAgo(latest.created_at)}</span>}
      <ArrowUpRight size={13} weight="light" className="station-go" aria-hidden="true" />
    </a>
  );
}

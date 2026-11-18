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
    let cancelled = false;
    let retry = 0;
    let timer = 0;

    async function tick() {
      try {
        if (guestbook) {
          const data = await rpc('guest_read', { space: guestbook.space, secret: guestbook.secret });
          if (cancelled) return;
          const list = Array.isArray(data?.messages) ? data.messages : [];
          const mine = list.filter(m => m && m.body && m.sender !== 'author');
          setLatest(mine.length ? mine[mine.length - 1] : null);
          setOnline(Boolean(data?.online));
        } else {
          const data = await rpc('presence', {});
          if (cancelled) return;
          setOnline(Boolean(data?.online));
        }
        retry = 0;
      } catch {
        if (cancelled) return;
        // 首屏并发抢带宽时这个请求偶尔会失败一次，别让用户等一分钟：退避重试两回
        if (retry < 3) {
          retry += 1;
          timer = window.setTimeout(tick, retry * 1500 + 300);
          return;
        }
        setOnline(false);
      }
    }

    // 尽量等首屏资源下完再问状态（挂载就发容易和图片抢连接），
    // 但慢网下 load 可能要半分钟，所以最多等 2.5 秒就先问一次
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      timer = window.setTimeout(tick, 250);
    };
    if (document.readyState === 'complete') start();
    else {
      window.addEventListener('load', start, { once: true });
      timer = window.setTimeout(start, 2500);
    }

    const id = window.setInterval(() => { if (!document.hidden) tick(); }, POLL);
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(id);
      window.removeEventListener('load', start);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [guestbook]);

  // 还没问到就按“不在线”画：这一行永远有一个明确的信号，问到了再变绿
  const state = online ? 'on' : 'off';
  const settled = online !== null;
  const line = latest
    ? <><span className="station-quote">“{String(latest.body).slice(0, 42)}{String(latest.body).length > 42 ? '…' : ''}”</span><span className="station-when">{timeAgo(latest.created_at)}</span></>
    : <span className="station-status">{state === 'on' ? '此刻在线，留言一般当天回' : state === 'off' ? '不在线，留言也会看到' : '留言当天回'}</span>;

  return (
    <a className="station-tile" href="/hub" aria-label="去联络站留言">
      <span className={`station-dot is-${state}`} aria-hidden="true" />
      <span className="station-head">联络站</span>
      {latest ? <span className="station-quote">“{String(latest.body).slice(0, 26)}{String(latest.body).length > 26 ? '…' : ''}”</span>
        : <span className="station-status">{state === 'on' ? '此刻在线，留言当天回' : settled ? '不在线，留言也会看到' : '留言一般当天回'}</span>}
      {latest && <span className="station-when">{timeAgo(latest.created_at)}</span>}
      <ArrowUpRight size={13} weight="light" className="station-go" aria-hidden="true" />
    </a>
  );
}

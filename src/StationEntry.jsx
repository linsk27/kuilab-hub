import React, { useEffect, useState } from 'react';
import { ChatCircle } from '@phosphor-icons/react';

// 左栏那个「联络站」按钮（首页唯一的入口）。
// 它同时承担“状态”这件事：
//   · 默认问 presence，显示作者此刻在不在线
//   · 如果 public/guestbook.json 填了 { space, secret }，就改读那个空间最近一条留言
// 为了不让首页为了一个小圆点去加载整套云 SDK，这里直接用 fetch 打同源的 /api/station。

const POLL = 60000;

function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const min = Math.round(Math.max(0, Date.now() - t) / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

async function callStation(action, payload) {
  // 加超时：线上的请求偶尔会一直挂着（不报错也不返回），那样状态会永远停在“未决”，
  // 界面上就一直是“留言一般当天回”。超时后按失败处理，走重试/离线判定。
  const res = await fetch('/api/station', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
    cache: 'no-store',
    signal: AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined,
  });
  if (!res.ok) throw new Error(`station ${res.status}`);
  const data = await res.json();
  if (data && data.ok === false) throw new Error(String(data.error || 'station_error'));
  return data;
}

export default function StationEntry() {
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
          const data = await callStation('guest_read', { space: guestbook.space, secret: guestbook.secret });
          if (cancelled) return;
          const list = Array.isArray(data?.messages) ? data.messages : [];
          const mine = list.filter(m => m && m.body && m.sender !== 'author');
          setLatest(mine.length ? mine[mine.length - 1] : null);
          setOnline(Boolean(data?.online));
        } else {
          const data = await callStation('presence', {});
          if (cancelled) return;
          setOnline(Boolean(data?.online));
        }
        retry = 0;
      } catch {
        if (cancelled) return;
        // 首屏并发抢带宽时这个请求偶尔失败，退避重试三次再判定离线
        if (retry < 3) {
          retry += 1;
          timer = window.setTimeout(tick, retry * 1500 + 300);
          return;
        }
        setOnline(false);
      }
    }

    // 尽量等首屏资源下完再问，但慢网下 load 可能半分钟，最多等 2.5 秒就先问一次
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

  // 还没问到就按“不在线”画，这一行永远有明确信号，问到了再变绿
  const state = online ? 'on' : 'off';
  const settled = online !== null;
  const sub = latest
    ? `“${String(latest.body).slice(0, 18)}${String(latest.body).length > 18 ? '…' : ''}” · ${timeAgo(latest.created_at)}`
    : state === 'on' ? '此刻在线，留言当天回'
      : settled ? '不在线，留言也会看到' : '留言一般当天回';

  // 移到纸左侧之后只留一个图标：状态压成一个角上的小点，文字进 title / aria-label。
  return (
    <a className="dock-btn" href="/hub#/chat" aria-label={`联络站：${sub}`} title={`联络站 · ${sub}`}>
      <ChatCircle size={18} weight="regular" aria-hidden="true" />
      <i className={`dock-dot is-${state}`} aria-hidden="true" />
    </a>
  );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, DownloadSimple, UploadSimple, Trash, Check, MagnifyingGlass, LockSimple, CloudCheck, CloudSlash } from '@phosphor-icons/react';
import ThemeToggle from './ThemeToggle';
import { useTheme } from './theme';
import SiteNav from './SiteNav';

// #/work —— 上班时用的待办页。
//
// 本地优先：每次改动先写 localStorage（key: hub-work-v1），再防抖推去服务器。
// 服务器那边按「一句口令的 sha256」分空间，口令不对就是空列表；
// 所以换设备输入同一句就能接着用，忘了口令则只剩本机这一份。
//
// 删除是软删除（deleted: true）—— 多设备之间必须能传达"这条被删了"，
// 直接物理删除的话，另一台设备下次同步会把它重新插回来。

const KEY = 'hub-work-v1';
const PASS_KEY = 'hub-work-pass';
const LOCAL_ONLY_KEY = 'hub-work-local';

function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// ISO 是 UTC，直接截字符串会差 8 小时（下午三点写成 07:00）。
function localDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : todayKey(d);
}

function hhmm(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function stampOf(item) {
  return new Date(item.upd || item.doneAt || item.at || 0).getTime() || 0;
}

function loadAll() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(item => item && typeof item.text === 'string')
      // 早期本地数据没有 upd，用创建时间补上，合并时才有得比
      .map(item => ({ ...item, upd: item.upd || item.at || new Date().toISOString() }));
  } catch { return []; }
}

function saveAll(items) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
    window.dispatchEvent(new Event('hub:work'));
  } catch { /* 隐私模式：这一次能用，关掉就没了 */ }
}

// 合并两份清单：同一条按 upd 取新的。服务器和本地都不知道谁是"真相"，
// 时间戳是唯一可靠的裁判，这样两台设备离线各改各的也不会互相覆盖。
function mergeLists(local, remote) {
  const map = new Map();
  [...local, ...remote].forEach(item => {
    if (!item || !item.id) return;
    const prev = map.get(item.id);
    if (!prev || stampOf(item) >= stampOf(prev)) map.set(item.id, item);
  });
  return [...map.values()];
}

function dayLabel(key) {
  const today = todayKey();
  const yest = todayKey(new Date(Date.now() - 86400000));
  if (key === today) return '今天';
  if (key === yest) return '昨天';
  const [, m, d] = key.split('-');
  return `${Number(m)} 月 ${Number(d)} 日`;
}

async function callWork(action, pass, payload = {}) {
  const res = await fetch('/api/work', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload: { pass, ...payload } }),
    cache: 'no-store',
    signal: AbortSignal.timeout ? AbortSignal.timeout(9000) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(String(data?.error || `work ${res.status}`));
  return data;
}

export default function WorkPage() {
  const { theme, toggle } = useTheme();
  const [items, setItems] = useState(loadAll);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [pass, setPass] = useState(() => { try { return window.localStorage.getItem(PASS_KEY) || ''; } catch { return ''; } });
  const [localOnly, setLocalOnly] = useState(() => { try { return window.localStorage.getItem(LOCAL_ONLY_KEY) === '1'; } catch { return false; } });
  const [draftPass, setDraftPass] = useState('');
  const [passError, setPassError] = useState('');
  const [sync, setSync] = useState('idle');   // idle | pulling | pushing | offline | error
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const pushTimer = useRef(0);
  const latest = useRef(items);
  const today = todayKey();

  const alive = useMemo(() => items.filter(item => !item.deleted), [items]);
  const locked = !pass && !localOnly;

  // ---- 同步 ----
  const pushNow = async list => {
    if (!pass || localOnly) return;
    setSync('pushing');
    try {
      await callWork('push', pass, {
        items: list.map(item => ({
          id: item.id,
          text: item.text,
          done: Boolean(item.done),
          deleted: Boolean(item.deleted),
          at: item.at || new Date().toISOString(),
          doneAt: item.doneAt || '',
          upd: item.upd || new Date().toISOString(),
        })),
      });
      setSync('idle');
    } catch (error) {
      setSync(error?.name === 'TimeoutError' ? 'offline' : 'error');
    }
  };

  const schedulePush = (list, delay = 1200) => {
    if (!pass || localOnly) return;
    latest.current = list;
    window.clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(() => pushNow(latest.current), delay);
  };

  const pull = async () => {
    if (!pass || localOnly) return;
    setSync('pulling');
    try {
      const data = await callWork('pull', pass);
      const merged = mergeLists(loadAll(), data.items || []);
      setItems(merged);
      saveAll(merged);
      setSync('idle');
      // 本地新加的（离线时写的）要补推上去
      if (merged.length) schedulePush(merged, 600);
    } catch (error) {
      setSync(error?.name === 'TimeoutError' ? 'offline' : 'error');
    }
  };

  useEffect(() => {
    if (pass && !localOnly) pull();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pass, localOnly]);

  useEffect(() => () => window.clearTimeout(pushTimer.current), []);

  // 切回这一页时补一次，免得两台设备之间长期各说各话
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible' && pass && !localOnly) pull(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pass, localOnly]);

  const open = useMemo(
    () => alive.filter(item => !item.done).sort((a, b) => (b.at || '').localeCompare(a.at || '')),
    [alive],
  );
  const doneToday = useMemo(
    () => alive.filter(item => item.done && localDay(item.doneAt) === today)
      .sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')),
    [alive, today],
  );
  const doneTotal = useMemo(() => alive.filter(item => item.done).length, [alive]);

  const history = useMemo(() => {
    const q = query.trim().toLowerCase();
    const past = alive.filter(item => item.done && localDay(item.doneAt) !== today);
    const pool = q ? alive.filter(item => item.done) : past;
    const hit = q ? pool.filter(item => item.text.toLowerCase().includes(q)) : pool;
    const groups = new Map();
    hit
      .sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''))
      .forEach(item => {
        const key = localDay(item.doneAt) || '未知日期';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      });
    return { groups: [...groups.entries()], total: hit.length, past: past.length };
  }, [alive, query, today]);

  function commit(next) {
    setItems(next);
    saveAll(next);
    schedulePush(next);
  }

  function add(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) { inputRef.current?.focus(); return; }
    const now = new Date().toISOString();
    commit([{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, done: false, deleted: false, at: now, doneAt: null, upd: now }, ...items]);
    setDraft('');
    inputRef.current?.focus();
  }

  function toggleDone(id) {
    const now = new Date().toISOString();
    commit(items.map(item => (item.id === id
      ? { ...item, done: !item.done, doneAt: item.done ? null : now, upd: now }
      : item)));
  }

  function remove(id) {
    const now = new Date().toISOString();
    commit(items.map(item => (item.id === id ? { ...item, deleted: true, upd: now } : item)));
  }

  function unlock(event) {
    event.preventDefault();
    const value = draftPass.trim();
    if (value.length < 6) { setPassError('至少要 6 个字符，长一点才安全'); return; }
    try { window.localStorage.setItem(PASS_KEY, value); } catch { /* 存不了就本次有效 */ }
    setPass(value);
    setPassError('');
    setDraftPass('');
  }

  function useLocalOnly() {
    try { window.localStorage.setItem(LOCAL_ONLY_KEY, '1'); } catch { /* 同上 */ }
    setLocalOnly(true);
  }

  function signOut() {
    try {
      window.localStorage.removeItem(PASS_KEY);
      window.localStorage.removeItem(LOCAL_ONLY_KEY);
    } catch { /* 同上 */ }
    setLocalOnly(false);
    setPass('');
    setSync('idle');
  }

  function exportAll() {
    const blob = new Blob([JSON.stringify(alive, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `work-${today}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importAll(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!Array.isArray(parsed)) throw new Error('not array');
        commit(mergeLists(items, parsed.filter(item => item && typeof item.text === 'string' && item.id)));
      } catch { /* 文件不对就当没发生 */ }
    };
    reader.readAsText(file);
  }

  const rows = (list, done) => (
    <ul className="wk-list">
      {list.map(item => (
        <li className={`wk-item${done ? ' is-done' : ''}`} key={item.id}>
          <button
            type="button"
            className="wk-check"
            onClick={() => toggleDone(item.id)}
            aria-pressed={done}
            aria-label={done ? `撤销完成：${item.text}` : `完成：${item.text}`}
          >
            {done && <Check size={11} weight="bold" aria-hidden="true" />}
          </button>
          <span className="wk-text">{item.text}</span>
          <span className="wk-time">{done ? hhmm(item.doneAt) : hhmm(item.at)}</span>
          <button type="button" className="wk-del" onClick={() => remove(item.id)} aria-label={`删除：${item.text}`}>
            <Trash size={13} weight="light" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );

  const syncLabel = localOnly ? '只在这台设备'
    : sync === 'pulling' ? '正在取云端…'
      : sync === 'pushing' ? '正在存入云端…'
        : sync === 'offline' ? '离线，先存在本机'
          : sync === 'error' ? '这次没同步上，稍后重试'
            : '已同步';

  return (
    <div className="page uses-page">
      <main className="uses-sheet work-sheet">
        <header className="uses-head">
          <div className="uses-bar">
            <a className="uses-back" href="#/">
              <ArrowLeft size={14} weight="light" aria-hidden="true" />
              回到首页
            </a>
            <SiteNav current="Work" />
          </div>
          <div className="uses-top">
            <span className="uses-kicker">10 — Work</span>
            <span className="uses-meta">
              {locked ? '还没开锁' : open.length ? `${open.length} 件没做完` : '手上没有待办'}
              {!locked && doneToday.length ? ` · 今天完成 ${doneToday.length}` : ''}
            </span>
          </div>
          <h1>今天做点什么</h1>
          <p className="uses-lede">
            {locked
              ? '先给这份清单上一把锁。开锁之后待办会存到云端，换一台设备输入同一句就能接着用。'
              : '写一条、回车就好。勾掉的东西会落到下面的历史里，随时能翻回去找。'}
          </p>
        </header>

        {locked ? (
          <form className="wk-lock" onSubmit={unlock}>
            <label className="wk-lock-label" htmlFor="wk-pass">一句只有你知道的话</label>
            <div className="wk-lock-row">
              <input
                id="wk-pass"
                type="password"
                value={draftPass}
                onChange={event => { setDraftPass(event.target.value); setPassError(''); }}
                placeholder="至少 6 个字符，例如一句歌词"
                autoComplete="new-password"
              />
              <button type="submit" className="wk-add-btn">开锁</button>
            </div>
            {passError && <p className="wk-error" role="alert">{passError}</p>}
            <p className="wk-lock-note">
              第一次用就是<b>设置</b>它，之后在别的设备上输入同一句就能看到同一份待办。
              服务器只存它的哈希、不存原文；忘了就找不回云端那份 —— 本机还会留一份，可以导出。
            </p>
            <button type="button" className="wk-lock-skip" onClick={useLocalOnly}>
              先只用这台设备，不同步
            </button>
          </form>
        ) : (
          <>
            <form className="wk-add" onSubmit={add}>
              <input
                ref={inputRef}
                value={draft}
                onChange={event => setDraft(event.target.value)}
                placeholder="写一件事，回车加到今天"
                aria-label="新的待办"
                maxLength={160}
                autoComplete="off"
              />
              <button type="submit" className="wk-add-btn">加上</button>
            </form>

            {open.length > 0 && (
              <section className="wk-block" aria-label="还没做完">
                {rows(open, false)}
              </section>
            )}

            {doneToday.length > 0 && (
              <section className="wk-block" aria-label="今天完成">
                <div className="wk-sub"><span>今天勾掉的</span><span>{doneToday.length}</span></div>
                {rows(doneToday, true)}
              </section>
            )}

            {!open.length && !doneToday.length && (
              <p className="wk-empty">今天还什么都没写。上面那行输入框，回车就加上了。</p>
            )}

            <section className="wk-history">
              <button
                type="button"
                className="wk-history-toggle"
                onClick={() => setShowHistory(v => !v)}
                aria-expanded={showHistory}
              >
                <span>历史</span>
                <span className="wk-history-count">
                  {history.past ? `${history.past} 条` : '还没有'}
                </span>
                <span className={`wk-caret${showHistory ? ' is-open' : ''}`} aria-hidden="true">⌄</span>
              </button>

              {showHistory && (
                <>
                  <label className="wk-search">
                    <MagnifyingGlass size={14} weight="light" aria-hidden="true" />
                    <input
                      value={query}
                      onChange={event => setQuery(event.target.value)}
                      placeholder="搜一条做过的事"
                      aria-label="搜索历史待办"
                      autoComplete="off"
                    />
                    {query && <button type="button" onClick={() => setQuery('')} aria-label="清除搜索">×</button>}
                  </label>

                  {history.groups.length === 0 && (
                    <p className="wk-empty">{query ? '没找到。换个词试试。' : '还没有勾掉的事情。'}</p>
                  )}

                  {history.groups.map(([day, list]) => (
                    <div className="wk-day" key={day}>
                      <div className="wk-sub"><span>{dayLabel(day)}</span><span>{list.length}</span></div>
                      {rows(list, true)}
                    </div>
                  ))}
                </>
              )}
            </section>

            <footer className="uses-foot">
              <span className="wk-foot-left">
                <span className={`wk-sync is-${sync}${localOnly ? ' is-local' : ''}`}>
                  {localOnly ? <CloudSlash size={11} weight="light" aria-hidden="true" /> : <CloudCheck size={11} weight="light" aria-hidden="true" />}
                  {syncLabel}
                </span>
                <button type="button" className="wk-foot-btn" onClick={exportAll}>
                  <DownloadSimple size={12} weight="light" aria-hidden="true" />导出
                </button>
                <button type="button" className="wk-foot-btn" onClick={() => fileRef.current?.click()}>
                  <UploadSimple size={12} weight="light" aria-hidden="true" />导入
                </button>
                <input ref={fileRef} type="file" accept="application/json,.json" onChange={importAll} hidden />
                <button type="button" className="wk-foot-btn" onClick={signOut}>
                  <LockSimple size={12} weight="light" aria-hidden="true" />换一把锁
                </button>
              </span>
              <span className="uses-foot-right">
                <a className="wk-foot-link" href="#/uses">这站怎么搭的 <ArrowUpRight size={11} weight="light" aria-hidden="true" /></a>
                <ThemeToggle theme={theme} onToggle={toggle} />
              </span>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}

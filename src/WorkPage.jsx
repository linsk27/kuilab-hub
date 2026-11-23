import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, DownloadSimple, UploadSimple, Trash, Check, MagnifyingGlass } from '@phosphor-icons/react';
import ThemeToggle from './ThemeToggle';
import { useTheme } from './theme';
import SiteNav from './SiteNav';

// #/work —— 上班时用的待办页。
//
// 只做三件事：写一条、勾掉、回头找得到。
// 数据存在这台设备的 localStorage（key: hub-work-v1），不上传、不登录，
// 所以换设备要自己导出/导入 —— 页面底部写明了这件事。
//
// 为什么不走云端：待办是私事，公开站点的云端空间是给留言用的；
// 真要跨设备，先把这份数据的形状固定下来（导出就是全量 JSON），再谈同步。

const KEY = 'hub-work-v1';

function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// ISO 是 UTC，直接截字符串会差 8 小时（下午三点写成 07:00）。
// 日期和时间都过一遍 Date，落到本地时区。
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

function loadAll() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(item => item && typeof item.text === 'string') : [];
  } catch { return []; }
}

function saveAll(items) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
    window.dispatchEvent(new Event('hub:work'));
  } catch { /* 隐私模式：这一次能用，关掉就没了 */ }
}

// 日期显示：今天/昨天写成词，更早的写月日
function dayLabel(key) {
  const today = todayKey();
  const yest = todayKey(new Date(Date.now() - 86400000));
  if (key === today) return '今天';
  if (key === yest) return '昨天';
  const [, m, d] = key.split('-');
  return `${Number(m)} 月 ${Number(d)} 日`;
}

export default function WorkPage() {
  const { theme, toggle } = useTheme();
  const [items, setItems] = useState(loadAll);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const today = todayKey();

  useEffect(() => { setItems(loadAll()); }, []);

  const open = useMemo(
    () => items.filter(item => !item.done).sort((a, b) => (b.at || '').localeCompare(a.at || '')),
    [items],
  );
  const doneToday = useMemo(
    () => items.filter(item => item.done && localDay(item.doneAt) === today)
      .sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')),
    [items, today],
  );
  const doneTotal = useMemo(() => items.filter(item => item.done).length, [items]);

  // 历史 = 今天以前勾掉的。搜索时连今天的一起找，不然"刚做完就搜不到"很怪
  const history = useMemo(() => {
    const q = query.trim().toLowerCase();
    const past = items.filter(item => item.done && localDay(item.doneAt) !== today);
    const pool = q ? items.filter(item => item.done) : past;
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
  }, [items, query, today]);

  function commit(next) {
    setItems(next);
    saveAll(next);
  }

  function add(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) { inputRef.current?.focus(); return; }
    const now = new Date().toISOString();
    commit([{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, done: false, at: now, doneAt: null }, ...items]);
    setDraft('');
    inputRef.current?.focus();
  }

  function toggleDone(id) {
    const now = new Date().toISOString();
    commit(items.map(item => (item.id === id
      ? { ...item, done: !item.done, doneAt: item.done ? null : now }
      : item)));
  }

  function remove(id) {
    commit(items.filter(item => item.id !== id));
  }

  function exportAll() {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
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
        const byId = new Map(items.map(item => [item.id, item]));
        parsed.forEach(item => {
          if (item && typeof item.text === 'string' && item.id) byId.set(item.id, { ...item, id: String(item.id) });
        });
        commit([...byId.values()]);
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
              {open.length ? `${open.length} 件没做完` : '手上没有待办'}
              {doneToday.length ? ` · 今天完成 ${doneToday.length}` : ''}
            </span>
          </div>
          <h1>今天做点什么</h1>
          <p className="uses-lede">
            写一条、回车就好。勾掉的东西会落到下面的历史里，随时能翻回去找。
            只存在这台设备的浏览器里，不上传。
          </p>
        </header>

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
            <span>{doneTotal} 条已完成</span>
            <button type="button" className="wk-foot-btn" onClick={exportAll}>
              <DownloadSimple size={12} weight="light" aria-hidden="true" />导出
            </button>
            <button type="button" className="wk-foot-btn" onClick={() => fileRef.current?.click()}>
              <UploadSimple size={12} weight="light" aria-hidden="true" />导入
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" onChange={importAll} hidden />
          </span>
          <span className="uses-foot-right">
            <a className="wk-foot-link" href="#/uses">这站怎么搭的 <ArrowUpRight size={11} weight="light" aria-hidden="true" /></a>
            <ThemeToggle theme={theme} onToggle={toggle} />
          </span>
        </footer>
      </main>
    </div>
  );
}

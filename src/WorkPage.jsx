import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, DownloadSimple, UploadSimple, Trash, Check, LockSimple, CloudCheck, CloudSlash } from '@phosphor-icons/react';
import ThemeToggle from './ThemeToggle';
import { useTheme } from './theme';
import SiteNav from './SiteNav';
import { useRole, setRole } from './role';
import './work.css';

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

// 创建/完成时间的显示：和"这一页是哪天"同一天只给时分，跨天就带上「月/日」，
// 否则在 23 号那页看一条 24 号才勾掉的事，会读成 23 号 10:00。
function stampLabel(iso, base) {
  const day = localDay(iso);
  if (!day) return '—';
  const time = hhmm(iso);
  if (day === (base || todayKey())) return time;
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  return `${month}/${date} ${time}`;
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
  const role = useRole();
  const [items, setItems] = useState(loadAll);
  const [draft, setDraft] = useState('');
  const [tab, setTab] = useState('open');   // open | done
  // 整页看的是"某一天"：pickMonth 只是月历翻到哪个月，day 才是当前这一天
  const [pickMonth, setPickMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [day, setDay] = useState(() => todayKey());
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

  // 两个标签都只服务"这一天"：待办 = 这天记下的、还没勾的；已完成 = 这天勾掉的
  const dayOpen = useMemo(
    () => alive.filter(item => !item.done && localDay(item.at) === day)
      .sort((a, b) => (b.at || '').localeCompare(a.at || '')),
    [alive, day],
  );
  // 已完成只算「那天记下的、已经勾掉的」。一条待办只属于它被记下的那天，
  // 24 号勾掉 23 号写的，它仍然在 23 号，不重复出现在 24 号。
  const dayDone = useMemo(
    () => alive.filter(item => item.done && localDay(item.at) === day)
      .sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')),
    [alive, day],
  );

  // 更早还挂着没勾的。这一页只看当天，但漏在旧日子里的不能让它们悄悄消失，
  // 所以只在「待办」下面留一行指路，不把旧条目摊进来。
  const olderOpen = useMemo(
    () => open.filter(item => { const k = localDay(item.at); return k && k < day; }),
    [open, day],
  );
  const oldestOpenDay = olderOpen.length ? localDay(olderOpen[olderOpen.length - 1].at) : '';

  // 每天记下几条、其中勾掉几条。月历的深浅用这两个数：
  // 全勾完 = 浅，还有没勾 = 中，一半一半 = 深 —— 看颜色就知道那天收没收尾。
  const createdByDay = useMemo(() => {
    const map = new Map();
    alive.forEach(item => {
      const key = localDay(item.at);
      if (key) map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [alive]);

  const doneOfCreatedByDay = useMemo(() => {
    const map = new Map();
    alive.forEach(item => {
      if (!item.done) return;
      const key = localDay(item.at);
      if (key) map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [alive]);

  // 窄屏那个日期下拉的选项：今天 + 所有记过东西的日子，从新到旧
  const dayOptions = useMemo(() => {
    const keys = new Set([today, day, ...createdByDay.keys()]);
    return [...keys].sort((a, b) => b.localeCompare(a));
  }, [today, day, createdByDay]);

  // 月历格子：周一开头，前面用空位补齐；顺手数一下这个月有几天留下过东西
  const cal = useMemo(() => {
    const y = pickMonth.getFullYear();
    const m = pickMonth.getMonth();
    const lead = (new Date(y, m, 1).getDay() + 6) % 7;
    const total = new Date(y, m + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < lead; i += 1) days.push('');
    let count = 0;
    for (let d = 1; d <= total; d += 1) {
      const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push(key);
      if (createdByDay.get(key)) count += 1;
    }
    return { y, m, days, count };
  }, [pickMonth, createdByDay]);

  function commit(next) {
    setItems(next);
    saveAll(next);
    schedulePush(next);
  }

  // 选某一天：整页跟着走，月历也翻到那个月（窄屏下拉可能跨月）
  function selectDay(key) {
    setDay(key);
    const [y, m] = key.split('-').map(Number);
    setPickMonth(new Date(y, m - 1, 1));
  }

  function goToday() {
    const now = new Date();
    setDay(todayKey(now));
    setPickMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  }

  const shiftMonth = step => setPickMonth(cur => new Date(cur.getFullYear(), cur.getMonth() + step, 1));

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
          <span className="wk-meta">
            <span className="wk-stamp">建 {stampLabel(item.at, day)}</span>
            {done && <span className="wk-stamp is-done-at">完 {stampLabel(item.doneAt, day)}</span>}
          </span>
          <button type="button" className="wk-del" onClick={() => remove(item.id)} aria-label={`删除：${item.text}`}>
            <Trash size={13} weight="light" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );

  const TABS = [
    { id: 'open', label: '待办', count: dayOpen.length },
    { id: 'done', label: '已完成', count: dayDone.length },
  ];

  const syncLabel = localOnly ? '只在这台设备'
    : sync === 'pulling' ? '正在取云端…'
      : sync === 'pushing' ? '正在存入云端…'
        : sync === 'offline' ? '离线，先存在本机'
          : sync === 'error' ? '这次没同步上，稍后重试'
            : '已同步';

  return (
    <div className="page uses-page">
      <main className="uses-sheet work-sheet">
        <div className="wk-layout">
          {/* 左栏日期索引：纸面左边原来空着一大条，正好放一张月历。
              有记录的日子点一个小点，点一天就去那天；窄屏没有这栏，改用「已完成」里的日期下拉。 */}
          {role !== 'guest' && !locked && (
            <nav className="wk-side" aria-label="选择日期">
              <div className="wk-side-head">
                <span className="wk-side-title">日期</span>
                <span className="wk-side-nav">
                  <button type="button" onClick={() => shiftMonth(-1)} aria-label="上个月">‹</button>
                  <button
                    type="button"
                    className="wk-side-month"
                    onClick={() => { const d = new Date(); setPickMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}
                    title="回到本月"
                  >
                    {cal.y}.{String(cal.m + 1).padStart(2, '0')}
                  </button>
                  <button type="button" onClick={() => shiftMonth(1)} aria-label="下个月">›</button>
                </span>
              </div>

              <div className="wk-cal">
                {['一', '二', '三', '四', '五', '六', '日'].map(w => (
                  <span className="wk-cal-w" key={w} aria-hidden="true">{w}</span>
                ))}
                {cal.days.map((key, index) => {
                  if (!key) return <span className="wk-cal-gap" key={`gap-${index}`} aria-hidden="true" />;
                  const made = createdByDay.get(key) || 0;
                  const did = doneOfCreatedByDay.get(key) || 0;
                  // 三档深浅按"那天记下的收没收尾"：都勾完 = 浅，还有没勾 = 中，一半一半 = 深
                  const level = !made ? 0 : did === made ? 1 : did === 0 ? 2 : 3;
                  const isOn = key === day;
                  const marks = made ? `记下 ${made} 件，勾掉 ${did} 件` : '';
                  return (
                    <button
                      type="button"
                      key={key}
                      className={`wk-cal-d${level ? ` lv${level}` : ''}${key === today ? ' is-today' : ''}${isOn ? ' is-on' : ''}`}
                      onClick={() => selectDay(key)}
                      aria-pressed={isOn}
                      aria-label={`${dayLabel(key)}${marks ? `，${marks}` : ''}`}
                      title={`${dayLabel(key)}${marks ? ` · ${marks}` : ''}`}
                    >
                      {Number(key.slice(8))}
                    </button>
                  );
                })}
              </div>

              {/* 三档深浅要说清楚，不然只看得出"有深有浅" */}
              <div className="wk-side-key">
                <span><i className="wk-key lv1" aria-hidden="true" />都勾完</span>
                <span><i className="wk-key lv2" aria-hidden="true" />有没勾</span>
                <span><i className="wk-key lv3" aria-hidden="true" />各半</span>
              </div>

              <div className="wk-side-foot">
                <button
                  type="button"
                  className={`wk-side-all${day === today ? ' is-on' : ''}`}
                  onClick={goToday}
                  disabled={day === today}
                >
                  今天
                </button>
                <span>本月 {cal.count} 天</span>
              </div>
            </nav>
          )}

          <div className="wk-main">
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
                  {/* 数字已经在标签上，这里只说状态，别重复一遍 */}
                  {role === 'guest' ? '访客' : locked ? '还没开锁' : open.length ? `共 ${open.length} 件没做完` : '手上没有待办'}
                </span>
              </div>
              <h1>{role === 'guest' ? '这一页是私人的' : day === today ? '今天做点什么' : '那天做了什么'}</h1>
              <p className="uses-lede">
                {role === 'guest'
                  ? '这一页只对站主开放。访客看到的是一个空房间 —— 不过你可以回去重新认一下身份。'
                  : locked
                    ? '先给这份清单上一把锁。开锁之后待办会存到云端，换一台设备输入同一句就能接着用。'
                    : '一天一页：左边点哪天，就看那天记下的和勾掉的。写一条、回车，它会落在今天。'}
              </p>
            </header>

        {role === 'guest' ? (
          <div className="wk-guest">
            <p className="wk-guest-title">这是 Linda 的私人待办</p>
            <p className="wk-guest-text">
              访客进来只会看到这一页空房间。如果你想记自己的事，回去重新认一下身份，
              用一句只有你知道的话给自己开一页。
            </p>
            <div className="wk-guest-actions">
              <a className="wk-add-btn" href="#/">回首页</a>
              <button
                type="button"
                className="wk-lock-skip"
                onClick={() => { setRole(''); window.location.hash = '#/'; }}
              >
                我是 Linda
              </button>
            </div>
          </div>
        ) : locked ? (
          <form className="wk-lock" onSubmit={unlock}>
            <label className="wk-lock-label" htmlFor="wk-pass">空间口令 · 一句只有你知道的话</label>
            <div className="wk-lock-row">
              <input
                id="wk-pass"
                type="password"
                value={draftPass}
                onChange={event => { setDraftPass(event.target.value); setPassError(''); }}
                placeholder="至少 6 个字符，第一次输就是设置"
                autoComplete="new-password"
              />
              <button type="submit" className="wk-add-btn">开锁</button>
            </div>
            {passError && <p className="wk-error" role="alert">{passError}</p>}
            <p className="wk-lock-note">
              这句就是你的<b>空间名</b>：同一句进同一份清单，<b>换一句就是一个空白的新空间</b>，
              旧的那份还在，只是要原来那句才进得去。服务器只存它的哈希、不存原文；
              忘了就找不回云端那份 —— 本机还留着一份，可以先导出。
            </p>
            <button type="button" className="wk-lock-skip" onClick={useLocalOnly}>
              先只用这台设备，不同步
            </button>
          </form>
        ) : (
          <>
            {/* 只有今天能写。翻到别的日子是翻旧账，别把新条目塞进过去的页里 */}
            {day === today ? (
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
            ) : (
              <div className="wk-daybar">
                <span>这天只翻看，不加新条目</span>
                <button type="button" onClick={goToday}>回到今天</button>
              </div>
            )}

            {/* 窄屏没有左栏月历：这一行下拉就是换日子的地方 */}
            <label className="wk-date-pick">
              <span>日期</span>
              <select
                value={day}
                onChange={event => selectDay(event.target.value)}
                aria-label="选择日期"
              >
                {dayOptions.map(key => (
                  <option key={key} value={key}>{dayLabel(key)}</option>
                ))}
              </select>
              <i aria-hidden="true">▾</i>
            </label>

            <nav className="wk-tabs" role="tablist" aria-label="当天的待办">
              {TABS.map(item => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`wk-tab-${item.id}`}
                  aria-selected={tab === item.id}
                  aria-controls="wk-panel"
                  className={`wk-tab${tab === item.id ? ' is-active' : ''}`}
                  onClick={() => setTab(item.id)}
                >
                  <span>{item.label}</span>
                  <b>{item.count}</b>
                </button>
              ))}
              <span className="wk-tabs-day">{dayLabel(day)}</span>
            </nav>

            <div className="wk-panel" id="wk-panel" role="tabpanel" aria-labelledby={`wk-tab-${tab}`}>
              {tab === 'open' && (
                <>
                  {dayOpen.length
                    ? rows(dayOpen, false)
                    : <p className="wk-empty">
                        {day === today
                          ? '今天还没有待办。上面写好回车，就加到今天。'
                          : '这天没有留下待办。'}
                      </p>}

                  {olderOpen.length > 0 && (
                    <button
                      type="button"
                      className="wk-older"
                      onClick={() => selectDay(oldestOpenDay)}
                    >
                      更早还有 {olderOpen.length} 件没勾 · 最早在 {dayLabel(oldestOpenDay)}
                    </button>
                  )}
                </>
              )}

              {tab === 'done' && (dayDone.length
                ? rows(dayDone, true)
                : <p className="wk-empty">
                    {day === today
                      ? '今天还没勾掉任何一条。'
                      : `这天没有勾掉任何一条。${createdByDay.get(day) ? `记下过 ${createdByDay.get(day)} 件，还没勾。` : ''}`}
                  </p>)}
            </div>

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
          </div>
        </div>
      </main>
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MagnifyingGlass, ArrowRight, LinkSimple, FileText, MusicNotes, PaintBrush, ChatCircle, Copy, X, Stamp, Stack, ClockCounterClockwise, ChartLineUp, Rss } from '@phosphor-icons/react';

// ⌘K 面板：全站的一个入口。
// 只做三件事 —— 跳（页面/链接）、做（切主题、控制音乐、复制链接）、找（模糊匹配）。
// 键盘：⌘/Ctrl + K 开，Esc 关，↑↓ 选，↵ 执行。鼠标也能用。
// 和播放器/主题之间不靠 props 传状态，而是发一条 window 事件：
//   hub:player → 播放器自己处理；主题直接用传进来的回调。

const OPEN_EVENT = 'hub:palette';

export function openPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

// 打分：开头命中 > 包含 > 按顺序出现（拼音/缩写也能凑合匹配）
function score(text, query) {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return 1;
  if (t.startsWith(q)) return 100 - t.length;
  const at = t.indexOf(q);
  if (at >= 0) return 60 - at - t.length * 0.1;
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i += 1;
    if (i === q.length) return 20 - t.length * 0.1;
  }
  return -1;
}

export default function CommandPalette({ pageNames, onOpenPage = () => {}, links = [], onToggleTheme, onSearch }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;

  useEffect(() => {
    const onKey = event => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '') || event.target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(o => !o);
        return;
      }
      if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); }
      if (event.key === '/' && !typing && !open) { event.preventDefault(); setOpen(true); }
    };
    const onAsk = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onAsk);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_EVENT, onAsk);
    };
  }, [open]);

  useEffect(() => {
    if (!open) { setQuery(''); setActive(0); return; }
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [open]);

  // 搜索即预览：把当前输入交给首页，命中的卡片会亮起来、其余淡下去。
  // 面板一关就发空串，页面立刻复原。
  // 走 window 事件而不是 props —— 面板现在挂在 Router 外层，首页只是它的一个邻居，
  // 拿不到 setSearch。首页自己监听 hub:search。
  useEffect(() => {
    const query_ = open ? query : '';
    onSearchRef.current?.(query_);
    window.dispatchEvent(new CustomEvent('hub:search', { detail: query_ }));
  }, [open, query]);

  const items = useMemo(() => {
    const list = [];
    // 已经做成独立页面的两项：直接跳，不再弹介绍框
    const full = {
      About: { hash: '#/about', hint: '这里是什么', icon: FileText, keywords: 'about 关于 介绍' },
      Uses: { hash: '#/uses', hint: '这站怎么搭的', icon: Stack, keywords: 'colophon 装备 技术栈' },
      Archive: { hash: '#/archive', hint: '这一年写过的和改过的', icon: ClockCounterClockwise, keywords: 'timeline 年表 归档 文章' },
      Stats: { hash: '#/stats', hint: '一些数字', icon: ChartLineUp, keywords: 'stats 统计 访问 数字 数据' },
      RSS: { hash: '#/rss', hint: '怎么订阅', icon: Rss, keywords: 'rss 订阅 feed 阅读器' },
    };
    pageNames.forEach(name => {
      const page = full[name];
      list.push({
        id: `page:${name}`,
        group: '页面',
        label: name,
        hint: page ? page.hint : '打开这张介绍卡',
        icon: page ? page.icon : FileText,
        keywords: page ? page.keywords : '',
        run: () => (page ? (window.location.hash = page.hash) : onOpenPage(name)),
      });
    });
    links.forEach(link => {
      let host = '';
      try { host = new URL(link.url).hostname.replace(/^www\./, ''); } catch { host = ''; }
      list.push({
        id: `link:${link.id || link.name}`,
        group: '链接',
        label: link.name,
        hint: link.detail || host || link.url,
        icon: LinkSimple,
        external: link.url,
        // 域名也算关键词：输 dsmoney 能搜到「大肥鱼账本」，跟首页卡片的高亮保持一致
        keywords: `${link.detail || ''} ${host}`,
      });
    });
    list.push(
      { id: 'act:theme', group: '动作', label: '切换明暗主题', hint: '墨色 / 纸色', icon: PaintBrush, run: onToggleTheme, keywords: 'theme dark light 主题 明暗' },
      { id: 'act:play', group: '动作', label: '播放 / 暂停音乐', hint: '随身听', icon: MusicNotes, run: () => window.dispatchEvent(new CustomEvent('hub:player', { detail: 'toggle' })), keywords: 'music play pause 音乐 播放' },
      { id: 'act:next', group: '动作', label: '下一首', hint: '随身听', icon: MusicNotes, run: () => window.dispatchEvent(new CustomEvent('hub:player', { detail: 'next' })), keywords: 'next 下一首 切歌' },
      { id: 'act:hub', group: '动作', label: '去联络站', hint: '留言 / 邀请', icon: ChatCircle, external: '/hub', keywords: 'hub station 联络 留言' },
      // 日期章平时藏在双击里，这里给一条能搜到的入口，免得没人发现
      { id: 'act:stamp', group: '动作', label: '盖今天的日期章', hint: '纸感彩蛋', icon: Stamp, run: () => window.dispatchEvent(new Event('hub:stamp')), keywords: 'stamp date 印章 日期 盖章' },
      { id: 'act:copy', group: '动作', label: '复制本站链接', hint: window.location.host, icon: Copy, run: () => navigator.clipboard?.writeText(window.location.href), keywords: 'copy url 复制 链接' },
    );
    return list;
  }, [pageNames, links, onOpenPage, onToggleTheme]);

  const visible = useMemo(() => {
    const scored = items
      .map(item => ({ item, s: Math.max(score(item.label, query), score(item.keywords || '', query) * 0.9) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s);
    return scored.slice(0, 10).map(x => x.item);
  }, [items, query]);

  useEffect(() => { setActive(0); }, [query]);

  function run(item) {
    if (!item) return;
    setOpen(false);
    if (item.external) {
      if (item.external.startsWith('/')) window.location.href = item.external;
      else window.open(item.external, '_blank', 'noreferrer');
      return;
    }
    item.run?.();
  }

  if (!open) return null;

  return (
    <div className={`palette-scrim ${query ? 'is-previewing' : ''}`} role="presentation" onPointerDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="快速跳转">
        <div className="palette-input">
          <MagnifyingGlass size={16} weight="light" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="搜索链接、页面，或直接说要做的事…"
            aria-label="搜索"
            autoComplete="off"
            spellCheck={false}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActive(a => Math.min(visible.length - 1, a + 1)); }
              else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(a => Math.max(0, a - 1)); }
              else if (event.key === 'Enter') { event.preventDefault(); run(visible[active]); }
            }}
          />
          <button type="button" className="palette-close" onClick={() => setOpen(false)} aria-label="关闭">
            <X size={14} weight="light" />
          </button>
        </div>

        <ul className="palette-list" ref={listRef} role="listbox" aria-label="结果">
          {visible.map((item, i) => {
            const Icon = item.icon;
            const firstOfGroup = i === 0 || visible[i - 1].group !== item.group;
            return (
              <li key={item.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  className={`palette-item ${i === active ? 'is-active' : ''}`}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => run(item)}
                >
                  <span className="palette-group">{firstOfGroup ? item.group : ''}</span>
                  <Icon size={15} weight="light" className="palette-icon" aria-hidden="true" />
                  <span className="palette-label">{item.label}</span>
                  <span className="palette-hint">{item.hint}</span>
                  <ArrowRight size={13} weight="light" className="palette-go" aria-hidden="true" />
                </button>
              </li>
            );
          })}
          {!visible.length && <li className="palette-empty">没有匹配的结果。试试 “主题”、“gblog” 或 “下一首”。</li>}
        </ul>

        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>↵</kbd> 执行</span>
          <span><kbd>esc</kbd> 关闭</span>
          <span><kbd>j</kbd><kbd>k</kbd> 选卡片</span>
          <span className="palette-brand">⌘K · 随时唤出</span>
        </div>
      </div>
    </div>
  );
}

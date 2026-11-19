import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight } from '@phosphor-icons/react';
import ThemeToggle from './ThemeToggle';
import { useTheme } from './theme';
import SiteNav from './SiteNav';

// #/archive 年表：把「博客文章」和「站点更新」并成一条时间线。
// 数据全是现成的：文章来自 /api/blog（服务端抓 RSS），更新来自 public/now.json。
// 不设分页 —— 年表就该一眼看到头，按年月分组本身就是索引。

// 和首页共用一份缓存，来回切页不重新拉
let archiveCache = null;
let notesCache = null;

const MONTH = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

function build(notes, posts) {
  const rows = [
    ...posts.map(post => ({ date: post.date, text: post.title, url: post.url, tag: 'gblog', kind: 'post' })),
    ...notes.map(note => ({ date: note.date, text: note.text, url: null, tag: note.tag || '更新', kind: 'note' })),
  ].filter(row => /^\d{4}-\d{2}/.test(row.date || ''));
  // 同一天里，站点更新排在文章前面 —— 「我改了什么」比「我写了什么」更贴近这个站
  rows.sort((a, b) => (a.date === b.date ? (a.kind === 'note' ? -1 : 1) : b.date.localeCompare(a.date)));

  const years = [];
  for (const row of rows) {
    const [year, month] = row.date.split('-');
    let bucket = years.find(item => item.year === year);
    if (!bucket) { bucket = { year, count: 0, months: [] }; years.push(bucket); }
    let group = bucket.months.find(item => item.month === month);
    if (!group) { group = { month, items: [] }; bucket.months.push(group); }
    group.items.push(row);
    bucket.count += 1;
  }
  return { rows, years };
}

export default function ArchivePage() {
  const { theme, toggle } = useTheme();
  const [posts, setPosts] = useState(() => archiveCache?.posts || []);
  const [notes, setNotes] = useState(() => notesCache || []);
  const [postTotal, setPostTotal] = useState(() => archiveCache?.total || 0);
  const [state, setState] = useState(() => (archiveCache ? 'ready' : 'loading'));

  useEffect(() => {
    const abort = new AbortController();
    const load = async () => {
      const [blog, now] = await Promise.allSettled([
        fetch('/api/blog?limit=200', { signal: abort.signal }).then(response => (response.ok ? response.json() : null)),
        fetch(`${import.meta.env.BASE_URL}now.json`, { signal: abort.signal }).then(response => (response.ok ? response.json() : null)),
      ]);
      if (abort.signal.aborted) return;
      const blogData = blog.status === 'fulfilled' ? blog.value : null;
      const nowData = now.status === 'fulfilled' ? now.value : null;
      if (blogData?.posts?.length) {
        archiveCache = { posts: blogData.posts, total: blogData.total || blogData.posts.length };
        setPosts(blogData.posts);
        setPostTotal(archiveCache.total);
      }
      if (nowData?.updates?.length) {
        notesCache = nowData.updates;
        setNotes(nowData.updates);
      }
      setState(blogData?.posts?.length || nowData?.updates?.length ? 'ready' : 'failed');
    };
    load();
    return () => abort.abort();
  }, []);

  const { rows, years } = useMemo(() => build(notes, posts), [notes, posts]);
  const [activeYear, setActiveYear] = useState(null);
  const blocks = useRef({});

  useEffect(() => {
    if (!years.length) return undefined;
    if (!activeYear) setActiveYear(years[0].year);
    const observer = new IntersectionObserver(entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActiveYear(visible[0].target.dataset.year);
    }, { rootMargin: '-10% 0px -72% 0px', threshold: 0 });
    Object.values(blocks.current).forEach(node => node && observer.observe(node));
    return () => observer.disconnect();
  }, [years, activeYear]);

  function jump(year) {
    const node = blocks.current[year];
    if (!node) return;
    window.scrollTo({ top: node.getBoundingClientRect().top + window.scrollY - 28, behavior: 'smooth' });
    setActiveYear(year);
  }

  const countNote = notes.length;
  const loaded = state === 'ready';

  return (
    <div className="page uses-page">
      <main className="uses-sheet arc-sheet">
        <header className="uses-head">
          <div className="uses-bar">
            <a className="uses-back" href="#/">
              <ArrowLeft size={14} weight="light" aria-hidden="true" />
              回到首页
            </a>
            <SiteNav current="Archive" />
          </div>
          <div className="uses-top">
            <span className="uses-kicker">06 — Archive</span>
            <span className="uses-meta">
              {loaded ? `${String(postTotal || posts.length).padStart(2, '0')} 篇 · ${String(countNote).padStart(2, '0')} 条更新` : '正在整理'}
            </span>
          </div>
          <h1>这一年</h1>
          <p className="uses-lede">
            写过的文章和改过的入口，按月份排在一起。上面是 gblog 的全部文章，
            夹在中间那几条是这座站自己的改动 —— 同样的日子，两种痕迹。
          </p>
        </header>

        <div className="uses-main arc-main">
          {years.length > 1 && (
            <nav className="uses-toc arc-toc" aria-label="年份索引">
              {years.map(item => (
                <button type="button" key={item.year}
                  className={`uses-toc-item ${activeYear === item.year ? 'is-active' : ''}`}
                  aria-current={activeYear === item.year ? 'true' : undefined}
                  onClick={() => jump(item.year)}>
                  <span className="uses-toc-num">{item.year}</span>
                  <span className="uses-toc-title">{item.count} 条</span>
                </button>
              ))}
            </nav>
          )}

          <div className="uses-body arc-body">
            {!rows.length && (
              <div className="arc-empty" data-state={state}>
                <span className="arc-empty-label">{state === 'failed' ? 'Offline' : 'Reading'}</span>
                <p>{state === 'failed' ? '年表暂时没取到，刷新一次试试。' : '正在把这几年的东西摊开…'}</p>
                {state === 'loading' && <ol className="arc-skeleton" aria-hidden="true">
                  {[84, 66, 74, 58].map(width => <li key={width}><span className="ghost-bar" style={{ width: `${width}%` }} /></li>)}
                </ol>}
              </div>
            )}

            {years.map(bucket => (
              <section className="arc-year" key={bucket.year}
                data-year={bucket.year}
                ref={node => { blocks.current[bucket.year] = node; }}>
                <div className="arc-year-head">
                  <h2>{bucket.year}</h2>
                  <span className="arc-year-count">{String(bucket.count).padStart(2, '0')} 条</span>
                  <i className="arc-year-rule" aria-hidden="true" />
                </div>

                {bucket.months.map(group => (
                  <div className="arc-month" key={group.month}>
                    <div className="arc-month-head">
                      <span className="arc-month-name">{MONTH[Number(group.month) - 1]}</span>
                      <span className="arc-month-count">{String(group.items.length).padStart(2, '0')}</span>
                    </div>
                    <ol className="arc-list">
                      {group.items.map(row => (
                        <li className={`arc-row is-${row.kind}`} key={`${row.date}-${row.text}`}>
                          <span className="arc-day">{row.date.slice(8)}</span>
                          {row.url
                            ? <a className="arc-text" href={row.url} target="_blank" rel="noreferrer">
                                {row.text}
                                <ArrowUpRight className="arc-arrow" size={12} weight="light" aria-hidden="true" />
                              </a>
                            : <span className="arc-text">{row.text}</span>}
                          <span className="arc-tag">{row.tag}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>

        <footer className="uses-foot">
          <span>最近一条 · {(rows[0]?.date || new Date().toISOString().slice(0, 10)).replace(/-/g, '.')}</span>
          <span className="uses-foot-right">
            <a href="https://gblog.kuilab.cn/" target="_blank" rel="noreferrer">
              去博客 <ArrowUpRight size={12} weight="light" aria-hidden="true" />
            </a>
            <ThemeToggle theme={theme} onToggle={toggle} />
          </span>
        </footer>
      </main>
    </div>
  );
}

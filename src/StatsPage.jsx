import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowUpRight } from '@phosphor-icons/react';
import ThemeToggle from './ThemeToggle';
import { useTheme } from './theme';
import SiteNav from './SiteNav';
import { readCounters } from './counters';

// #/stats 一些数字
// 只放三类事实：站点自己的累计（云端聚合、没有个人信息）、内容量（RSS / links.json）、
// 以及这台设备上的痕迹（摸猫 / 盖章 / 听歌）。刻意不做排行榜、不做热力图。
const WINDOW = 14;

const pad = n => String(n).padStart(2, '0');
const fmt = n => Number(n || 0).toLocaleString('en-US');

function axis(days) {
  // 后端只回有记录的日子；这里补齐成连续的 14 天，图表才不会跳
  const byDay = new Map((days || []).map(row => [row.day, Number(row.hits) || 0]));
  const today = new Date();
  const out = [];
  for (let i = WINDOW - 1; i >= 0; i -= 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    out.push({ key, month: d.getMonth() + 1, day: d.getDate(), hits: byDay.get(key) || 0 });
  }
  return out;
}

export default function StatsPage() {
  const { theme, toggle } = useTheme();
  const [site, setSite] = useState(null);
  const [state, setState] = useState('loading');
  const [articles, setArticles] = useState(0);
  const [links, setLinks] = useState(0);
  const [local, setLocal] = useState({ pets: 0, stamps: 0, plays: 0, since: null });

  useEffect(() => {
    setLocal(readCounters());
    const abort = new AbortController();
    const load = async () => {
      const [stats, blog, linkList] = await Promise.allSettled([
        fetch('/api/stats', { signal: abort.signal }).then(response => (response.ok ? response.json() : null)),
        fetch('/api/blog', { signal: abort.signal }).then(response => (response.ok ? response.json() : null)),
        fetch(`${import.meta.env.BASE_URL}links.json`, { signal: abort.signal }).then(response => (response.ok ? response.json() : null)),
      ]);
      if (abort.signal.aborted) return;
      const siteData = stats.status === 'fulfilled' ? stats.value : null;
      if (siteData?.ok) { setSite(siteData); setState('ready'); } else setState('failed');
      if (blog.status === 'fulfilled' && blog.value?.total) setArticles(Number(blog.value.total) || 0);
      if (linkList.status === 'fulfilled' && Array.isArray(linkList.value)) setLinks(linkList.value.length);
    };
    load();
    return () => abort.abort();
  }, []);

  const days = useMemo(() => axis(site?.days), [site]);
  const peak = Math.max(...days.map(d => d.hits), 1);
  const span = useMemo(() => {
    if (!site?.first_day) return null;
    const start = new Date(`${site.first_day}T00:00:00`);
    const now = new Date();
    const diff = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - start) / 86400000) + 1;
    return Number.isFinite(diff) && diff > 0 ? diff : null;
  }, [site]);
  const total = Number(site?.total || 0);
  const paths = (site?.paths || []).map(row => ({
    path: row.path,
    hits: Number(row.hits) || 0,
    label: row.path === '/' ? '首页' : row.path.startsWith('/hub') ? '联络站' : row.path,
  }));

  const figures = [
    { label: 'Total visits', cn: '总访问', value: state === 'ready' ? fmt(total) : '—' },
    { label: 'Today', cn: '今天', value: state === 'ready' ? fmt(site?.today) : '—' },
    { label: 'Articles', cn: '文章', value: articles ? fmt(articles) : '—' },
    { label: 'Running', cn: '运行', value: span ? String(span) : '—', unit: span ? '天' : '' },
  ];

  const again = [
    { key: 'pets', label: '摸了小猫', unit: '次', value: local.pets },
    { key: 'stamps', label: '盖了日期章', unit: '个', value: local.stamps },
    { key: 'plays', label: '听过歌', unit: '首', value: local.plays },
  ];
  const localTotal = again.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="page uses-page">
      <main className="uses-sheet st-sheet">
        <header className="uses-head">
          <div className="uses-bar">
            <a className="uses-back" href="#/">
              <ArrowLeft size={14} weight="light" aria-hidden="true" />
              回到首页
            </a>
            <SiteNav current="Stats" />
          </div>
          <div className="uses-top">
            <span className="uses-kicker">07 — Numbers</span>
            <span className="uses-meta">
              {state === 'ready' ? `自 ${String(site.first_day || '').slice(5).replace('-', '.')} 起` : state === 'failed' ? '统计没取到' : '正在读'}
            </span>
          </div>
          <h1>一些数字</h1>
          <p className="uses-lede">
            不是仪表盘。这里只有三样东西：这座站自己攒下来的访问、它到底放了多少内容、
            以及你在这台设备上留下的痕迹。没有排行榜，也没有热力图。
          </p>
        </header>

        <section className="st-figures" aria-label="站点概览">
          {figures.map(item => (
            <div className="st-figure" key={item.label}>
              <span className="st-figure-label"><i>{item.label} · </i>{item.cn}</span>
              <b className={`st-figure-value ${state === 'ready' ? '' : 'is-waiting'}`}>{item.value}{item.unit && <i>{item.unit}</i>}</b>
            </div>
          ))}
        </section>

        <section className="st-chart" aria-label={`近 ${WINDOW} 天访问`}>
          <div className="st-chart-head">
            <span>近 {WINDOW} 天</span>
            <span className="st-chart-sum">
              {state === 'ready' ? `这 ${WINDOW} 天 ${fmt(days.reduce((sum, d) => sum + d.hits, 0))} 次` : '—'}
            </span>
          </div>
          {/* 柱子与刻度分两行：这样基线是一条干净的横线，不会被标签顶起来 */}
          <div className="st-bars" role="img" aria-label={days.map(d => `${d.month}月${d.day}日 ${d.hits} 次`).join('，')}>
            {days.map(day => (
              <span className="st-bar-col" key={day.key} title={`${day.month} 月 ${day.day} 日 · ${day.hits} 次`}>
                <i
                  className={`st-bar ${day.hits ? '' : 'is-zero'}`}
                  style={{ height: `${day.hits ? Math.max((day.hits / peak) * 100, 5) : 2}%` }}
                />
              </span>
            ))}
          </div>
          <div className="st-ticks" aria-hidden="true">
            {days.map((day, i) => (
              <span key={day.key}>{i === 0 || day.day === 1 ? `${day.month}.${day.day}` : day.day}</span>
            ))}
          </div>
        </section>

        {paths.length > 0 && (
          <section className="st-split" aria-label="访问去向">
            <div className="st-chart-head"><span>去向</span><span className="st-chart-sum">按入口分</span></div>
            <ul className="st-split-list">
              {paths.map(row => (
                <li key={row.path}>
                  <span className="st-split-name">{row.label}</span>
                  <span className="st-split-track"><i style={{ width: `${total ? (row.hits / total) * 100 : 0}%` }} /></span>
                  <span className="st-split-value">{fmt(row.hits)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="st-local" aria-label="这台设备">
          <div className="st-chart-head">
            <span>这台设备</span>
            <span className="st-chart-sum">只写在本机，不上传</span>
          </div>
          {localTotal === 0 ? (
            <p className="st-local-empty">
              还没有留下痕迹。摸摸右下角的小猫、双击页面盖个日期章、或者放一首歌。
            </p>
          ) : (
            <ul className="st-local-list">
              {again.map(item => (
                <li key={item.key}>
                  <span className="st-local-num"><b>{fmt(item.value)}</b><em>{item.unit}</em></span>
                  <span className="st-local-name">{item.label}</span>
                </li>
              ))}
            </ul>
          )}
          {local.since && <p className="st-local-since">从 {local.since.slice(5).replace('-', '.')} 起记在这台浏览器里，换设备或清缓存就归零。</p>}
        </section>

        <footer className="uses-foot">
          <span>数据来自站内 /api · 不含访客信息</span>
          <span className="uses-foot-right">
            <a href="https://github.com/linsk27/kuilab-hub" target="_blank" rel="noreferrer">
              源码 <ArrowUpRight size={12} weight="light" aria-hidden="true" />
            </a>
            <ThemeToggle theme={theme} onToggle={toggle} />
          </span>
        </footer>
      </main>
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight } from '@phosphor-icons/react';
import ThemeToggle from './ThemeToggle';
import { useTheme } from './theme';

// #/uses 装备页：把这座站的家底摊开写一遍。
// 不是"工具推荐"，是"这东西是怎么长出来的" —— 每一条都对得上仓库里的真实实现。
// 结构固定成 组 → 条目，条目只有「名」和「一句实话」，不写形容词堆砌。

const SECTIONS = [
  {
    kicker: '01',
    title: '骨架',
    items: [
      ['框架', 'React 19 + Vite 6，没有装路由库，hash 自己分'],
      ['样式', '全部手写 CSS。theme.css 是唯一的颜色来源，两套主题：墨 / 纸'],
      ['图标', 'Phosphor，按需 import，没有图标字体'],
      ['字体', 'Georgia 衬线 + 系统等宽，一个 webfont 都没下'],
    ],
  },
  {
    kicker: '02',
    title: '纸感',
    items: [
      ['噪点', '一层 feTurbulence 生成的 SVG 噪声，叠在底色上，不是位图'],
      ['胶带', '便签上沿一条半透明色块，clip-path 切出撕口'],
      ['墨线', '标题下面那条线是 SVG 路径，stroke-dashoffset 一笔画出来'],
      ['荧光笔', '标题背后一道色块，scaleX 从 0 扫到 1'],
      ['日期章', '双击页面盖一个，2.3 秒后自己淡掉'],
      ['季节色', '首帧脚本按月份写 data-season，只换一个 --warm 变量'],
    ],
  },
  {
    kicker: '03',
    title: '声音',
    items: [
      ['曲目', 'HoliznaCC0，CC0 1.0 公共领域；《夜航》是站内合成'],
      ['格式', 'WebM / Opus 64k。Ogg 容器会让 Chrome 去读文件尾，慢网首声要等十几秒'],
      ['波形', '歌单里预先算好 168 根柱子，不下载整首去解码'],
      ['预取', '用户没表示要听之前连 src 都不设，全程只发一个请求'],
    ],
  },
  {
    kicker: '04',
    title: '这只猫',
    items: [
      ['画法', '2D 分层雪碧图：头、身体、投影各自独立'],
      ['立体感', '三层差速做视差，不是 3D 模型。转起来头比身体多探一点'],
      ['表情', '同一只母版渲成整帧，换帧只变脸，不会"换了只猫"'],
      ['光标', '自己画的 SVG 白猫，Chromium 渲 256px 再缩到 32px，热点量在鼻尖'],
      ['它说话', '看几点、摸了几次、在放什么歌，再挑一句'],
    ],
  },
  {
    kicker: '05',
    title: '数据与部署',
    items: [
      ['托管', 'GitHub → Vercel，推送即部署'],
      ['版本', '/api/version 返回当前提交号，用来确认线上到底是哪一版'],
      ['联络站', '云端 Postgres + 行级安全，浏览器只打本站 /api/station，由它转发到 RPC'],
      ['删除', '作者端删除走独立函数，没有去改那个已经很长的 station_rpc'],
      ['离线', 'Service Worker 导航走 network-first，断网还能打开壳'],
    ],
  },
  {
    kicker: '06',
    title: '性能账',
    items: [
      ['首屏', '桌面 1440×900 一屏装完，page 高度正好 900，不滚'],
      ['缓存', '/images /cat /audio 全部 immutable，文件名带版本才换'],
      ['图片', '不缩图。缩了在 3 倍屏上会糊，靠缓存和首屏排序解决'],
      ['动效', '只碰 transform / opacity / stroke-dashoffset，不进布局'],
    ],
  },
];

export default function UsesPage() {
  const { theme, toggle } = useTheme();
  // 左侧索引：跟着滚动高亮当前一节，点一下滚过去。
  // 页面本来就只有一条读线，加了索引才像一份「文档」而不是一串清单。
  const [active, setActive] = useState(SECTIONS[0].kicker);
  const blocks = useRef({});

  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.dataset.kicker);
    }, { rootMargin: '-10% 0px -72% 0px', threshold: 0 });
    Object.values(blocks.current).forEach(node => node && observer.observe(node));

    // 最后一节滚不到页面顶部（到底就停住了），光靠观察器会一直停在倒数第二节
    const onScroll = () => {
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8;
      if (atBottom) setActive(SECTIONS[SECTIONS.length - 1].kicker);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { observer.disconnect(); window.removeEventListener('scroll', onScroll); };
  }, []);

  function jump(kicker) {
    const node = blocks.current[kicker];
    if (!node) return;
    const top = node.getBoundingClientRect().top + window.scrollY - 28;
    window.scrollTo({ top, behavior: 'smooth' });
    setActive(kicker);
  }

  return (
    <div className="page uses-page">
      <main className="uses-sheet">
        <header className="uses-head">
          <a className="uses-back" href="#/">
            <ArrowLeft size={14} weight="light" aria-hidden="true" />
            回到首页
          </a>
          <div className="uses-top">
            <span className="uses-kicker">05 — Colophon</span>
            <span className="uses-meta">六节 · 二十八条</span>
          </div>
          <h1>这站是怎么搭的</h1>
          <p className="uses-lede">
            一份给自己留的清单：用了什么、为什么这么选、哪些地方是踩过坑才改成现在这样的。
            每一条都对得上仓库里的真实实现，不是"技术栈罗列"。
          </p>
        </header>

        <div className="uses-main">
          <nav className="uses-toc" aria-label="章节索引">
            {SECTIONS.map(section => (
              <button type="button" key={section.kicker}
                className={`uses-toc-item ${active === section.kicker ? 'is-active' : ''}`}
                aria-current={active === section.kicker ? 'true' : undefined}
                onClick={() => jump(section.kicker)}>
                <span className="uses-toc-num">{section.kicker}</span>
                <span className="uses-toc-title">{section.title}</span>
              </button>
            ))}
          </nav>
          <div className="uses-body">
          {SECTIONS.map(section => (
            <section className="uses-block" key={section.kicker}
              data-kicker={section.kicker}
              ref={node => { blocks.current[section.kicker] = node; }}>
              <div className="uses-block-head">
                <span className="uses-num">{section.kicker}</span>
                <h2>{section.title}</h2>
              </div>
              <dl className="uses-list">
                {section.items.map(([label, value]) => (
                  <div className="uses-row" key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          </div>
        </div>

        <footer className="uses-foot">
          <span>最后更新 · 2026.11.19</span>
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

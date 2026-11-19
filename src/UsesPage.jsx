import React from 'react';
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
    kicker: '04',
    title: '声音',
    items: [
      ['曲目', 'HoliznaCC0，CC0 1.0 公共领域；《夜航》是站内合成'],
      ['格式', 'WebM / Opus 64k。Ogg 容器会让 Chrome 去读文件尾，慢网首声要等十几秒'],
      ['波形', '歌单里预先算好 168 根柱子，不下载整首去解码'],
      ['预取', '用户没表示要听之前连 src 都不设，全程只发一个请求'],
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
  return (
    <div className="page uses-page">
      <main className="uses-sheet">
        <header className="uses-head">
          <a className="uses-back" href="#/">
            <ArrowLeft size={14} weight="light" aria-hidden="true" />
            回到首页
          </a>
          <div className="uses-head-grid">
            <div className="uses-title">
              <p className="uses-kicker">05 — Colophon</p>
              <h1>这站是怎么搭的</h1>
            </div>
            <p className="uses-lede">
              一份给自己留的清单：用了什么、为什么这么选、哪些地方是踩过坑才改成现在这样的。
              每一条都对得上仓库里的真实实现，不是"技术栈罗列"。
            </p>
          </div>
        </header>

        <div className="uses-body">
          {SECTIONS.map(section => (
            <section className="uses-block" key={section.kicker}>
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

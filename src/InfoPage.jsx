import React from 'react';
import { ArrowLeft, ArrowUpRight, Rss } from '@phosphor-icons/react';
import ThemeToggle from './ThemeToggle';
import { useTheme } from './theme';
import SiteNav from './SiteNav';
import './info.css';

// #/about 与 #/rss：两张短的说明页。
// 它们以前是首页上的弹窗 —— 导航里挂着，点开却只是盖一层遮罩，跳转感是假的。
// 现在和装备页共用同一张纸、同一个页头，是真地址、能分享、能后退。

const PAGES = {
  About: {
    kicker: '08 — About',
    title: '这里是什么',
    lede: '一个手账式的入口：把散在外面的东西收在一处，顺便放几件自己喜欢的小玩意。',
    margin: '别急着走：首页那几张便签可以翻面，右下角的小圆点就是机关。',
    body: (
      <>
        <p>
          首页那张卡片里有三样东西：几张便签（点开是新标签页，不会把你留在这儿）、
          左栏今天勾掉的几件待办、右栏的博客目录。卡片右下角的小圆点可以把便签翻过来看背面。
        </p>
        <p>
          联络站是可以留言的：不用注册，起个名字就能说句话。留言存在云端，
          只有我能看到和回复；访客那边只留自己聊过的那一条，换设备就没了。
        </p>
        <p>
          页面上这些——纸纹、胶带、日期章、会转头的猫、随身听——都是自己做的。
          用了什么、为什么这么选、哪些地方踩过坑，都写在
          {' '}<a href="#/uses">这站是怎么搭的</a>{' '}那一页里。
        </p>
        <p>
          这个站不采集访客信息。会留下的只有两样：一次访问的计数（按天汇总，
          不区分是谁），以及你在联络站里自己写下的话。摸猫、盖章、听歌这几个数
          只写在你自己的浏览器里。
        </p>
      </>
    ),
  },
  RSS: {
    kicker: '09 — RSS',
    title: '订阅',
    lede: '新写的文章先发在 gblog，这里只是一条入口。',
    margin: '不用注册、不用邮箱、不用算法。它只是把一个列表放在你能拿走的地方。',
    body: (
      <>
        <p className="info-link-row">
          <Rss size={16} weight="light" aria-hidden="true" />
          <a href="https://gblog.kuilab.cn/index.xml" target="_blank" rel="noreferrer">
            gblog.kuilab.cn/index.xml
            <ArrowUpRight size={13} weight="light" aria-hidden="true" />
          </a>
        </p>
        <p>
          把上面这个地址粘到任意阅读器里就行——Feedly、Inoreader、NetNewsWire、
          Follow，或者干脆一个支持 RSS 的书签栏。不用注册，也不用给我邮箱。
        </p>
        <p>
          首页「gblog」那张卡里的目录就是从这份 feed 取的：服务端抓一次、缓存半小时，
          浏览器不用扛 1.3MB 的 XML。所以那边更新之后，这里最多差半小时。
        </p>
        <p>
          这个站自己的改动（换了版式、加了页面）不发 RSS。想看这些，
          去{' '}<a href="#/archive">这一年</a>{' '}那一页，它们和文章排在同一条时间线上。
        </p>
      </>
    ),
  },
};

export default function InfoPage({ name = 'About' }) {
  const { theme, toggle } = useTheme();
  const page = PAGES[name] || PAGES.About;

  return (
    <div className="page uses-page">
      <main className="uses-sheet info-sheet">
        <header className="uses-head">
          <div className="uses-bar">
            <a className="uses-back" href="#/">
              <ArrowLeft size={14} weight="light" aria-hidden="true" />
              回到首页
            </a>
            <SiteNav current={name} />
          </div>
          <div className="uses-top">
            <span className="uses-kicker">{page.kicker}</span>
          </div>
          <h1>{page.title}</h1>
          <p className="uses-lede">{page.lede}</p>
        </header>

        <div className="info-body">
          <div className="info-copy">{page.body}</div>
          <aside className="info-margin" aria-hidden="true">{page.margin}</aside>
        </div>

        <footer className="uses-foot">
          <span>© 2026 · kuilab.cn</span>
          <span className="uses-foot-right">
            <ThemeToggle theme={theme} onToggle={toggle} />
          </span>
        </footer>
      </main>
    </div>
  );
}

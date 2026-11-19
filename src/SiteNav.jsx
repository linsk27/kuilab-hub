import React from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';

// 全站唯一的一份导航。五项都是独立页面，都有真地址 ——
// 以前 About / Colophon / RSS 点开只是弹窗，混在真页面里会让人以为在跳转。
// Colophon 和「装备页」本来就是同一件事（那页的编号就是 05 — Colophon），已合并。
//
// 最后那颗放大镜是 ⌘K 面板的入口。桌面有快捷键，手机上没有任何键盘可按 ——
// 面板里的「盖一枚猫爪章」这类动作，移动端只能从这里进去。
// 这里直接发事件，不 import 面板模块，免得把 22KB 的 chunk 拖进首屏。
const ITEMS = [
  { label: 'About', href: '#/about' },
  { label: 'Uses', href: '#/uses' },
  { label: 'Archive', href: '#/archive' },
  { label: 'Stats', href: '#/stats' },
  { label: 'RSS', href: '#/rss' },
];

export default function SiteNav({ current = '', className = '' }) {
  return (
    <nav className={`site-nav ${className}`} aria-label="站点导航">
      {ITEMS.map(item => (
        <a key={item.label} href={item.href}
          className={current === item.label ? 'is-current' : ''}
          aria-current={current === item.label ? 'page' : undefined}>
          {item.label}
        </a>
      ))}
      <button
        type="button"
        className="nav-cmd"
        onClick={() => window.dispatchEvent(new Event('hub:palette'))}
        aria-label="搜索与快捷动作"
        title="搜索 · ⌘K"
      >
        <MagnifyingGlass size={13} weight="light" aria-hidden="true" />
      </button>
    </nav>
  );
}

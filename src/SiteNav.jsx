import React from 'react';

// 全站唯一的一份导航。五项都是独立页面，都有真地址 ——
// 以前 About / Colophon / RSS 点开只是弹窗，混在真页面里会让人以为在跳转。
// Colophon 和「装备页」本来就是同一件事（那页的编号就是 05 — Colophon），已合并。
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
    </nav>
  );
}

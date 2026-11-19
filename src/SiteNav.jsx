import React from 'react';

// 全站唯一的一份导航。首页放在顶部状态条中间，三个独立页放在「回到首页」那一行的右端。
// About / Colophon / RSS 仍然是弹窗：首页直接开，子页面用 #about 这样的锚点先回首页再开。
const ITEMS = [
  { label: 'About', info: true },
  { label: 'Uses', href: '#/uses' },
  { label: 'Archive', href: '#/archive' },
  { label: 'Stats', href: '#/stats' },
  { label: 'Colophon', info: true },
  { label: 'RSS', info: true },
];

export default function SiteNav({ current = '', onOpenInfo, className = '' }) {
  return (
    <nav className={`site-nav ${className}`} aria-label="站点导航">
      {ITEMS.map(item => (item.href
        ? <a key={item.label} href={item.href}
            className={current === item.label ? 'is-current' : ''}
            aria-current={current === item.label ? 'page' : undefined}>
            {item.label}
          </a>
        : <a key={item.label} href={`#${item.label.toLowerCase()}`}
            onClick={event => {
              // 在首页上不必绕一圈哈希：直接开弹窗
              if (!onOpenInfo) return;
              event.preventDefault();
              onOpenInfo(item.label);
            }}>
            {item.label}
          </a>))}
    </nav>
  );
}

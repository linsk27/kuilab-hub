// 主题模块（JS 部分）
// 全站只有这一处读写主题：默认「墨」、记住用户选择、同步浏览器状态栏颜色、
// 切换时用 View Transition 做一次从点击处扩散的圆形揭示。
// CSS 令牌在 theme.css，控件在 ThemeToggle.jsx。
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'hub-theme';
// 同一页里可能有两个 useTheme（页面自己的开关 + 全站特效层的右键菜单），
// 靠这条事件同步，否则点了右键菜单里的"换明暗"，页面上的开关图标不会跟着变。
const THEME_EVENT = 'hub:theme';
const META_COLOR = { dark: '#1A1715', light: '#F3EFE8' };

// 首帧由 index.html 的内联脚本写好 data-theme，这里只读回来，避免刷新闪一下
function readTheme() {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function useTheme() {
  const [theme, setTheme] = useState(readTheme);

  // 别人改了主题，这边跟着改
  useEffect(() => {
    const onSet = event => {
      const next = event.detail;
      if (next === 'light' || next === 'dark') setTheme(next);
    };
    window.addEventListener(THEME_EVENT, onSet);
    return () => window.removeEventListener(THEME_EVENT, onSet);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', META_COLOR[theme] || META_COLOR.dark);
    try { window.localStorage.setItem(STORAGE_KEY, theme); } catch { /* 隐私模式下忽略 */ }
  }, [theme]);

  const toggle = useCallback(event => {
    const next = theme === 'dark' ? 'light' : 'dark';
    // 本地先落状态，再把同一件事广播给页面里其它 useTheme
    const apply = value => {
      setTheme(value);
      window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: value }));
    };
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !document.startViewTransition) { apply(next); return; }

    const x = event?.clientX ?? window.innerWidth - 48;
    const y = event?.clientY ?? 36;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    ) * 1.05;

    // 默认的整页交叉淡入已经在 theme.css 里用 ::view-transition-* 关掉了，
    // 这里这一个类只是给调试留的抓手（z-index 也在那边定）
    const root = document.documentElement;
    root.classList.add('theming');
    const done = () => root.classList.remove('theming');
    try {
      const vt = document.startViewTransition(() => apply(next));
      vt.ready
        .then(() => root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 640, easing: 'cubic-bezier(.22,1,.36,1)', pseudoElement: '::view-transition-new(root)' },
        ))
        .catch(() => { /* 过渡被打断时不影响主题已切换 */ });
      vt.finished.then(done, done);
    } catch {
      done();
      apply(next);
    }
  }, [theme]);

  return { theme, toggle };
}

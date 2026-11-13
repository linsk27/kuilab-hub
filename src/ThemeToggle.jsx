// 主题开关：首页用「胶囊 + 日月」（pill），联络站用「单枚圆形按钮」（icon）。
// 颜色全部走 theme.css 的令牌，所以两套主题下都自动成立。
import React from 'react';
const SunIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />
  </svg>
);

const MoonIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M20 14.4A8.4 8.4 0 1 1 9.6 4a6.8 6.8 0 0 0 10.4 10.4Z" />
  </svg>
);

export default function ThemeToggle({ theme, onToggle, variant = 'pill' }) {
  const next = theme === 'dark' ? '亮色' : '暗色';
  const label = `切换到${next}主题`;

  if (variant === 'icon') {
    return <button type="button" className="theme-icon" onClick={onToggle} aria-label={label} title={label}>
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>;
  }

  return <button type="button" className={`theme-toggle ${theme}`} onClick={onToggle} aria-label={label} title={label}>
    <i className="theme-knob" aria-hidden="true" />
    <span className={`theme-ico sun ${theme === 'light' ? 'on' : ''}`}><SunIcon /></span>
    <span className={`theme-ico moon ${theme === 'dark' ? 'on' : ''}`}><MoonIcon /></span>
  </button>;
}

import React, { useEffect, useRef, useState } from 'react';
import PawTrail from './PawTrail';
import { StampLayer } from './PaperMarks';
import ContextMenu from './ContextMenu';
import BackToTop from './BackToTop';
import { useTheme } from './theme';

// 全站的「纸面层」：猫爪拖尾、双击日期章、右键手账菜单。
// 这三样不依赖任何页面内容，之前挂在首页的 App 里，所以一进 #/uses 就没了；
// 现在提到路由外层，凡是纸面页（首页 / 装备页 / 404）都在。
// 联络站不套这层：那是聊天界面，爪印和右键菜单会干扰读消息。

export default function SiteEffects() {
  const { toggle } = useTheme();
  const [toast, setToast] = useState('');
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function flash(text) {
    setToast(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(''), 1800);
  }

  return (
    <>
      <StampLayer />
      <PawTrail />
      <ContextMenu
        onStamp={point => window.dispatchEvent(new CustomEvent('hub:stamp', { detail: point }))}
        onCopy={() => {
          navigator.clipboard?.writeText(window.location.href)
            .then(() => flash('链接已复制'))
            .catch(() => flash('浏览器不让复制，手动选中吧'));
        }}
        onTheme={point => toggle(point)}
        onStation={() => { window.location.href = '/hub'; }}
      />
      {toast && <span className="stamp-hint" role="status">{toast}</span>}
      <BackToTop />
    </>
  );
}

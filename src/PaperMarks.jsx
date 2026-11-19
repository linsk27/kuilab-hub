import React, { useEffect, useRef, useState } from 'react';
import { bump } from './counters';

// 纸感两处需要 DOM 参与的：
//   1) 标题下面那条手绘墨线（SVG stroke-dashoffset 动画，只在首屏画一次）
//   2) 双击盖的日期章（绝对定位，脱离布局，不占版面）
// 其余（胶带、荧光笔）都是纯 CSS，见 styles.css 末尾「纸感四件套」。

const SEEN_KEY = 'hub-stamp-seen';

function todayText() {
  const d = new Date();
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export function HandUnderline() {
  // preserveAspectRatio="none" 让线随宽度拉伸，高度固定 9px —— 笔画不会跟着变粗
  return (
    <svg className="hand-rule" viewBox="0 0 240 12" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path className="hand-rule-ink" d="M3 8.4C26 5.2 54 3.5 84 3.9c26 .4 52 1.9 74 2.7 8 .3 14 0 21-.6" />
      <path className="hand-rule-tail" d="M179 5.9c14 .6 26-1.1 38-3.9" />
    </svg>
  );
}

export function StampLayer() {
  const [stamp, setStamp] = useState(null);
  const [hint, setHint] = useState(false);
  const timer = useRef(0);
  const seen = useRef(true);

  useEffect(() => {
    try { seen.current = localStorage.getItem(SEEN_KEY) === '1'; } catch { seen.current = true; }

    const markSeen = () => {
      if (seen.current) return;
      seen.current = true;
      try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* 存不了就每次都说一声，不影响盖章 */ }
    };

    function stampAt(x, y) {
      window.clearTimeout(timer.current);
      bump('stamps');
      setStamp({ id: `${Date.now()}-${Math.random()}`, x, y, text: todayText() });
      // 动画 2.3s 走完就卸掉，别在 DOM 里留一层透明节点
      timer.current = window.setTimeout(() => setStamp(null), 2400);
      setHint(false);
      markSeen();
    }

    // 章层是 position:fixed 的，所以坐标直接用视口值 ——
    // 这样不管页面滚到哪儿、在哪一页上盖章，落点都在手指下面
    function place(clientX, clientY) {
      const x = Math.min(Math.max(clientX, 54), Math.max(window.innerWidth - 54, 54));
      const y = Math.min(Math.max(clientY, 88), Math.max(window.innerHeight - 34, 88));
      stampAt(x, y);
    }

    function onDouble(event) {
      // 卡片、按钮、输入框上的双击有它自己的含义（连点两次、选中词），不抢
      if (event.target.closest?.('a,button,input,textarea,select,dialog,.palette-scrim,[contenteditable="true"]')) return;
      place(event.clientX, event.clientY);
    }

    function onAsk(event) {
      // 带坐标就盖在那儿（右键菜单），没有就盖在视口中间偏上（⌘K）；都走同一套夹取逻辑
      const point = event?.detail;
      if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) place(point.x, point.y);
      else place(window.innerWidth / 2, window.innerHeight * 0.46);
    }

    window.addEventListener('dblclick', onDouble);
    window.addEventListener('hub:stamp', onAsk);

    // 第一次来的人不会知道能双击：四秒后飘一条小提示，看到过一次就不再出现
    let show = 0;
    let hide = 0;
    if (!seen.current) {
      show = window.setTimeout(() => {
        setHint(true);
        hide = window.setTimeout(() => { setHint(false); markSeen(); }, 6200);
      }, 3800);
    }

    return () => {
      window.removeEventListener('dblclick', onDouble);
      window.removeEventListener('hub:stamp', onAsk);
      window.clearTimeout(timer.current);
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, []);

  return (
    <div className="stamp-layer" aria-hidden="true">
      {stamp && (
        <span className="date-stamp" key={stamp.id} style={{ left: `${stamp.x}px`, top: `${stamp.y}px` }}>
          <span className="date-stamp-date">{stamp.text}</span>
          <span className="date-stamp-mark">KUI · LAB</span>
        </span>
      )}
      {hint && <span className="stamp-hint">双击页面任意处，盖个今天的日期章</span>}
    </div>
  );
}

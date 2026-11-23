import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChatCircle } from '@phosphor-icons/react';
import StationEntry from './StationEntry';
import WorkEntry from './WorkEntry';
import { useRole } from './role';

// 首页左侧那两枚入口（联络站 / 工作台）。
//
// 为什么要 portal：`.paper-shell` 在入场时跑 `ink-rise`，带 transform，
// 而任何带 transform 的祖先都会成为 `position:fixed` 的包含块 ——
// 于是 fixed 变成「相对纸面定位」，加载那 0.8 秒里按钮落在纸里，
// 动画一结束包含块没了才跳回屏幕左边。这和 z-index、left 值都无关，
// 是结构问题，只能把它挪出那棵树。
//
// 桌面：挂到 document.body（无 transform 祖先），全程钉在视口左侧。
// 窄屏：纸边不够放，挂回 profile 末尾那个空的 .dock-slot，随文档流排一行。
const NARROW = '(max-width: 999px)';

export default function SideDock() {
  const role = useRole();
  const [target, setTarget] = useState(null);
  const [inline, setInline] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const pick = () => {
      const narrow = mq.matches;
      const slot = document.getElementById('dock-inline');
      setInline(narrow);
      setTarget(narrow ? slot : document.body);
    };
    pick();
    mq.addEventListener('change', pick);
    return () => mq.removeEventListener('change', pick);
  }, []);

  if (!target) return null;

  return createPortal(
    <div className={`side-dock ${inline ? 'is-inline' : 'is-rail'}`}>
      <React.Suspense
        fallback={<a className="dock-btn" href="/hub#/chat" aria-label="进入站内联络站"><ChatCircle size={18} weight="regular" aria-hidden="true" /></a>}
      >
        <StationEntry />
      </React.Suspense>
      {role !== 'guest' && <WorkEntry />}
    </div>,
    target,
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { Stamp, Copy, PaintBrush, MusicNotes, ChatCircle, ArrowUpRight } from '@phosphor-icons/react';

// 右键手账菜单：空白处右击弹一张小纸条，把平时藏在 ⌘K 里的动作摆到手边。
// 链接、按钮、输入框上不接管 —— 那里浏览器原生的「在新标签页打开」「粘贴」更有用。
export default function ContextMenu({ onStamp, onCopy, onTheme, onStation }) {
  const [at, setAt] = useState(null);
  const box = useRef(null);

  useEffect(() => {
    function open(event) {
      const target = event.target;
      if (target?.closest?.('a,button,input,textarea,select,img,dialog,.palette-scrim,.ctx-menu,[contenteditable="true"]')) return;
      event.preventDefault();
      const w = 188;
      const h = 196;
      setAt({
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - w - 8)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - h - 8)),
      });
    }
    function close(event) {
      if (event.type === 'pointerdown' && box.current?.contains(event.target)) return;
      setAt(null);
    }
    function onKey(event) {
      if (event.key === 'Escape') setAt(null);
    }
    window.addEventListener('contextmenu', open);
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('contextmenu', open);
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, []);

  if (!at) return null;

  const run = fn => () => {
    // 顺便带一份 clientX/clientY：切主题时圆形揭示要从菜单处扩散开
    const point = { x: at.x + 94, y: at.y + 40, clientX: at.x + 94, clientY: at.y + 40 };
    setAt(null);
    fn?.(point);
  };

  return (
    <div
      className="ctx-menu"
      ref={box}
      role="menu"
      aria-label="页面菜单"
      style={{ left: `${at.x}px`, top: `${at.y}px` }}
      onContextMenu={event => event.preventDefault()}
    >
      <span className="ctx-tape" aria-hidden="true" />
      <button type="button" role="menuitem" onClick={run(onStamp)}>
        <Stamp size={14} weight="light" aria-hidden="true" />
        <span>盖今天的日期章</span>
      </button>
      <button type="button" role="menuitem" onClick={run(onCopy)}>
        <Copy size={14} weight="light" aria-hidden="true" />
        <span>复制本页链接</span>
      </button>
      <button type="button" role="menuitem" onClick={run(onTheme)}>
        <PaintBrush size={14} weight="light" aria-hidden="true" />
        <span>换个明暗</span>
      </button>
      <button type="button" role="menuitem" onClick={run(() => window.dispatchEvent(new CustomEvent('hub:player', { detail: 'toggle' })))}>
        <MusicNotes size={14} weight="light" aria-hidden="true" />
        <span>播放 / 暂停</span>
      </button>
      <span className="ctx-rule" aria-hidden="true" />
      <button type="button" role="menuitem" onClick={run(() => { window.location.href = '/hub'; })}>
        <ChatCircle size={14} weight="light" aria-hidden="true" />
        <span>去联络站</span>
        <ArrowUpRight size={12} weight="light" className="ctx-go" aria-hidden="true" />
      </button>
    </div>
  );
}

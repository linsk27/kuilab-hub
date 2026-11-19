import React, { useEffect, useState } from 'react';

// 折角：把某一节/某一段的右上角折下来，像在书里做的记号。
// 存在 localStorage，下次打开还在；再点一下拆开。
// 它只是一个记号 —— 不自动滚动、不弹窗，不打断正在读的那一页。

const KEY = 'hub-folds-v1';

function readAll() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}

function write(foldKey, on) {
  const all = readAll();
  if (on) all[foldKey] = Date.now();
  else delete all[foldKey];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* 隐私模式：这一次有效，下次忘掉 */ }
}

export function foldCount() {
  return Object.keys(readAll()).length;
}

export default function FoldMark({ foldKey, label = '这一段' }) {
  const [on, setOn] = useState(() => Boolean(readAll()[foldKey]));

  // 同一个 key 在别的页面实例里被改过（比如路由复用组件），重新读一次
  useEffect(() => { setOn(Boolean(readAll()[foldKey])); }, [foldKey]);

  function toggle(event) {
    event.preventDefault();
    event.stopPropagation();
    const next = !on;
    setOn(next);
    write(foldKey, next);
    window.dispatchEvent(new CustomEvent('hub:toast', { detail: next ? '折在这儿了' : '角拆开了' }));
  }

  return (
    <button
      type="button"
      className={`fold-mark${on ? ' is-on' : ''}`}
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? `拆开折角：${label}` : `在这里折一个角：${label}`}
      title={on ? '拆开这个角' : '折一个角'}
    >
      <svg viewBox="0 0 26 26" aria-hidden="true" focusable="false">
        <path className="fold-face" d="M26 0v26L0 0z" />
        <path className="fold-crease" d="M0 0l26 26" />
      </svg>
    </button>
  );
}

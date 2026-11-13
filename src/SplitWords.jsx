// 逐词上浮（移植自 react-bits 的 SplitText，去掉 GSAP 依赖，纯 CSS 关键帧）
// 做法：每个词套一层 overflow:hidden 的遮罩行，词本身从 105% 处升上来。
// 注意关键帧写 from/to 且 fill both —— 这样 prefers-reduced-motion 关掉 animation 时，
// 词会退回默认可见状态，而不是卡在“藏起来”的那一帧。
import React from 'react';

export default function SplitWords({ text, accent = '', base = 0, step = 70, className = '' }) {
  const words = text.split(' ');
  return (
    <span className={`split ${className}`}>
      {words.map((word, index) => (
        <React.Fragment key={`${word}-${index}`}>
          <span className="split-line">
            <span className="split-word" style={{ '--i': index, '--base': `${base}ms`, '--step': `${step}ms` }}>
              {word}
              {index === words.length - 1 && accent ? <span className="heading-period">{accent}</span> : null}
            </span>
          </span>
          {/* 用真正的空格而不是占位元素：innerText / 复制 / 朗读都要能读出空格 */}
          {index < words.length - 1 ? ' ' : null}
        </React.Fragment>
      ))}
    </span>
  );
}

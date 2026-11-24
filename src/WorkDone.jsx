import React, { useEffect, useState } from 'react';
import { todayDone } from './workStore';

// 首页左栏「今日完成」：把今天勾掉的待办露三条出来。
// 数据就在 localStorage 里，和工作页共用；工作页一改会发 hub:work 事件。

function hhmm(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function WorkDone() {
  const [done, setDone] = useState(() => todayDone());

  useEffect(() => {
    const read = () => setDone(todayDone());
    read();
    window.addEventListener('hub:work', read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener('hub:work', read);
      window.removeEventListener('storage', read);
    };
  }, []);

  if (!done.length) return null;

  const shown = done.slice(0, 3);
  const rest = done.length - shown.length;

  return (
    <section className="done-now" aria-label="今天完成的待办">
      <div className="done-now-head">
        <span>今日完成</span>
        <span>{done.length} 件</span>
      </div>
      <ul className="done-now-list">
        {shown.map(item => (
          <li key={item.id}>
            <span className="done-now-time">{hhmm(item.doneAt)}</span>
            <span className="done-now-text" title={item.text}>{item.text}</span>
          </li>
        ))}
      </ul>
      {rest > 0 && <a className="done-now-more" href="#/work">还有 {rest} 件 →</a>}
    </section>
  );
}

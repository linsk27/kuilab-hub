import React, { useEffect, useState } from 'react';
import { ListChecks, ArrowUpRight } from '@phosphor-icons/react';

// 首页左栏的「工作台」入口。
// 只读 localStorage 里的条数，就为了那一句「还剩几件」——
// 一个数字比一个图标更容易让人点进去。

const KEY = 'hub-work-v1';

function readOpen() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return 0;
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    // 未完成的都算；今天勾掉的写成"今天清完了"更有成就感
    const open = raw.filter(item => item && !item.done).length;
    if (open) return open;
    const doneToday = raw.filter(item => item && item.done && String(item.doneAt || '').slice(0, 10) === key).length;
    return doneToday ? -doneToday : 0;
  } catch { return 0; }
}

export default function WorkEntry() {
  const [open, setOpen] = useState(readOpen);

  useEffect(() => {
    const read = () => setOpen(readOpen());
    read();
    window.addEventListener('hub:work', read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener('hub:work', read);
      window.removeEventListener('storage', read);
    };
  }, []);

  const cleared = open < 0;
  const count = Math.abs(open);
  const note = cleared ? `今天清完 ${count} 件` : count ? `${count} 件待办` : '空着';

  return (
    <a className="work-entry" href="#/work" aria-label={`工作台，${note}`}>
      <ListChecks size={18} weight="light" aria-hidden="true" />
      <span className="work-entry-text">
        <span className="work-entry-line">工作台</span>
        <span className="work-entry-note">{note}</span>
      </span>
      <ArrowUpRight size={15} weight="light" aria-hidden="true" />
    </a>
  );
}

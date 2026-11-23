import { useEffect, useState } from 'react';

// 站内只有两种身份：主人（Linda）和访客。
// 它不承担鉴权 —— 待办本身仍然靠口令保护；这里只决定「首页给谁看什么」，
// 比如工作台入口只对主人显示。身份存在本机，换设备要重新认一次。

const KEY = 'hub-role';
const EVENT = 'hub:role';

export function getRole() {
  try { return window.localStorage.getItem(KEY) || ''; } catch { return ''; }
}

export function setRole(role) {
  try {
    if (role) window.localStorage.setItem(KEY, role);
    else window.localStorage.removeItem(KEY);
  } catch { /* 隐私模式：这一次有效 */ }
  window.dispatchEvent(new Event(EVENT));
}

export function useRole() {
  const [role, set] = useState(getRole);
  useEffect(() => {
    const read = () => set(getRole());
    window.addEventListener(EVENT, read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener(EVENT, read);
      window.removeEventListener('storage', read);
    };
  }, []);
  return role;
}

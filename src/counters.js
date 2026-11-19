// 只存在这台设备上的三个数：摸猫、盖章、听歌。
// 刻意不上传 —— 它们是「你和这个页面之间」的痕迹，没有统计意义，
// 也不该拿去拼一个人的画像。#/stats 里会明写「只在这台设备上」。
const KEYS = {
  pets: 'hub-pets-v1',
  stamps: 'hub-stamps-v1',
  plays: 'hub-plays-v1',
  since: 'hub-since-v1',
};

function store() {
  try { return window.localStorage; } catch { return null; }
}

export function bump(name) {
  const key = KEYS[name];
  const box = store();
  if (!key || !box) return 0;
  try {
    // 第一次留下痕迹时顺手记下日期，页面上就能说「从 11.13 起」
    if (!box.getItem(KEYS.since)) box.setItem(KEYS.since, new Date().toISOString().slice(0, 10));
    const next = Number(box.getItem(key) || 0) + 1;
    box.setItem(key, String(next));
    return next;
  } catch {
    return 0;
  }
}

export function readCounters() {
  const box = store();
  const read = key => {
    if (!box) return 0;
    try { return Number(box.getItem(key) || 0) || 0; } catch { return 0; }
  };
  let since = null;
  try { since = box ? box.getItem(KEYS.since) : null; } catch { since = null; }
  return { pets: read(KEYS.pets), stamps: read(KEYS.stamps), plays: read(KEYS.plays), since };
}

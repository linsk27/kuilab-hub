// 待办数据的读取入口：工作页、首页左栏、工作台入口都从这里拿，
// 免得三处各写一遍「哪些算今天完成」。

export const WORK_KEY = 'hub-work-v1';

export function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function localDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : todayKey(d);
}

// 构建期预渲染（Node）里没有 window，读不到就当空清单
function store() {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

export function readWork() {
  try {
    const store_ = store();
    if (!store_) return [];
    const raw = JSON.parse(store_.getItem(WORK_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(item => item && typeof item.text === 'string' && !item.deleted);
  } catch { return []; }
}

// 今天勾掉的，按完成时间倒序
export function todayDone(items = readWork()) {
  const today = todayKey();
  return items
    .filter(item => item.done && localDay(item.doneAt) === today)
    .sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || '')));
}

// 还没做完的
export function openItems(items = readWork()) {
  return items.filter(item => !item.done);
}

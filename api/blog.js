// 站外博客（gblog.kuilab.cn）的最近文章。
// 浏览器直连要扛 1.3MB 的 RSS、还受跨域限制，这里在服务端取一次、只回标题/链接/日期，
// 结果交给 CDN 缓存半小时 —— 首页那块「最新几篇」就不会拖慢首屏。
const FEED = 'https://gblog.kuilab.cn/index.xml';
// 首页只要最新 4 篇；#/archive 要整份年表，用 ?limit=200 另取一份（CDN 按 URL 分别缓存）
const LIMIT = 4;
const MAX_LIMIT = 200;
const TTL = 10 * 60 * 1000;

// 同一个函数实例里再挡一层：CDN 是共享的，进程内缓存能让本地 dev 和冷启动也好受些
let cached = { at: 0, all: null };

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function plain(raw = '') {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (all, code) => {
      if (code[0] !== '#') return ENTITIES[code] ?? all;
      const point = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : all;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// 一律按 +08 出日期：函数跑在哪个时区都不该改变页面上的日子
function day(value) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return '';
  const at = new Date(time + 8 * 3600 * 1000);
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}-${String(at.getUTCDate()).padStart(2, '0')}`;
}

// RSS 里不只有文章：Hugo 的「搜索」「友链」「归档」这些页面也算 item，
// 日期常常是 2001-01-01 的占位值，混进年表会凭空多出两个年份。只认文章所在的路径。
const ARTICLE_PATH = /^\/(p|posts|projects|notes|life|diary)\//i;

function isArticle(url) {
  try { return ARTICLE_PATH.test(new URL(url).pathname); } catch { return false; }
}

function parse(xml) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(match => match[1]);
  const posts = [];
  for (const item of items) {
    const title = plain(item.match(/<title>([\s\S]*?)<\/title>/)?.[1]);
    const url = plain(item.match(/<link>([\s\S]*?)<\/link>/)?.[1]);
    if (!title || !/^https?:\/\//.test(url) || !isArticle(url)) continue;
    posts.push({ title, url, date: day(plain(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1])) });
  }
  return { posts, total: posts.length };
}

function wanted(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return LIMIT;
  return Math.min(n, MAX_LIMIT);
}

export default async function handler(req, res) {
  // Vercel 会填 req.query；本地 dev 的 shim 只有裸 req，从 url 里自己取一次
  const limit = wanted(req.query?.limit ?? new URL(req.url || '/', 'http://localhost').searchParams.get('limit'));
  const reply = all => {
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
    res.status(200).json({ ok: true, total: all.total, posts: all.posts.slice(0, limit), fetchedAt: all.fetchedAt });
  };
  try {
    if (cached.all && Date.now() - cached.at < TTL) return reply(cached.all);
    const response = await fetch(FEED, {
      signal: AbortSignal.timeout(9000),
      headers: { 'user-agent': 'kuilab-hub (+https://kuilab.cn)' },
    });
    if (!response.ok) throw new Error(`feed ${response.status}`);
    const { posts, total } = parse(await response.text());
    if (!posts.length) throw new Error('feed empty');
    cached = { at: Date.now(), all: { total, posts, fetchedAt: new Date().toISOString() } };
    reply(cached.all);
  } catch {
    // 博客挂了不该连累首页：给一个空列表，前端就把这块当「没取到」
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    res.status(200).json({ ok: false, total: 0, posts: [] });
  }
}

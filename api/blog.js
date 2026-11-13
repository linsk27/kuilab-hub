// 站外博客（gblog.kuilab.cn）的最近文章。
// 浏览器直连要扛 1.3MB 的 RSS、还受跨域限制，这里在服务端取一次、只回标题/链接/日期，
// 结果交给 CDN 缓存半小时 —— 首页那块「最新几篇」就不会拖慢首屏。
const FEED = 'https://gblog.kuilab.cn/index.xml';
const LIMIT = 4;
const TTL = 10 * 60 * 1000;

// 同一个函数实例里再挡一层：CDN 是共享的，进程内缓存能让本地 dev 和冷启动也好受些
let cached = { at: 0, payload: null };

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

function parse(xml) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(match => match[1]);
  const posts = [];
  for (const item of items) {
    const title = plain(item.match(/<title>([\s\S]*?)<\/title>/)?.[1]);
    const url = plain(item.match(/<link>([\s\S]*?)<\/link>/)?.[1]);
    if (!title || !/^https?:\/\//.test(url)) continue;
    posts.push({ title, url, date: day(plain(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1])) });
  }
  return { posts: posts.slice(0, LIMIT), total: posts.length };
}

export default async function handler(req, res) {
  try {
    if (cached.payload && Date.now() - cached.at < TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
      return res.status(200).json(cached.payload);
    }
    const response = await fetch(FEED, {
      signal: AbortSignal.timeout(9000),
      headers: { 'user-agent': 'kuilab-hub (+https://kuilab.cn)' },
    });
    if (!response.ok) throw new Error(`feed ${response.status}`);
    const { posts, total } = parse(await response.text());
    if (!posts.length) throw new Error('feed empty');
    const payload = { ok: true, total, posts, fetchedAt: new Date().toISOString() };
    cached = { at: Date.now(), payload };
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
    res.status(200).json(payload);
  } catch {
    // 博客挂了不该连累首页：给一个空列表，前端就把这块当「没取到」
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    res.status(200).json({ ok: false, total: 0, posts: [] });
  }
}

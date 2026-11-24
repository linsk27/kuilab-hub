/* 站点的 service worker：让第二次进站基本不出网。
 *
 * 策略（都只处理同源 GET）：
 *   · 页面导航 —— 先走网络，断网才用缓存里的首页（保证新版本能第一时间看到）
 *   · /assets/* 与图片字体 —— cache-first（文件名带 hash，可以放心长期用）
 *   · *.json（links / now / playlist）—— 网络优先，2 秒拿不到就用缓存
 *   · 音频（mp3/webm…）—— 完全不拦，Range 请求交给浏览器和 CDN
 *
 * 改版本号就会清掉旧缓存；部署新构建后第一次访问会顺带刷新。
 */
const VERSION = 'v7';
const ASSETS = `hub-assets-${VERSION}`;
const PAGES = `hub-pages-${VERSION}`;

// 安装时先把「壳」存下来：断网时至少能看到首页，而不是白屏
// （运行时缓存只覆盖用户真正访问过的页面，第一次访问就断网会没东西可用）
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/favicon.svg'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(PAGES);
    await Promise.all(SHELL.map(async url => {
      try {
        const response = await fetch(url, { cache: 'reload' });
        if (response.ok) await cache.put(url, response);
      } catch { /* 单个失败不影响安装 */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const stale = keys.filter(key => !key.endsWith(VERSION));
    await Promise.all(stale.map(key => caches.delete(key)));
    await self.clients.claim();
    // 有旧缓存 = 这是一次升级。旧页面还停在旧的 index.html 上，
    // 它引用的 hash 文件已经不在缓存里，不如直接让它重载一次，换成新版本。
    if (stale.length) {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(client => client.navigate(client.url).catch(() => {}));
    }
  })());
});

const isAudio = path => /\.(mp3|webm|ogg|m4a|wav)$/i.test(path);
const isAsset = path => /\/assets\//.test(path) || /\.(css|js|webp|png|jpe?g|svg|avif|woff2?)$/i.test(path);
const isData = path => /\.json$/i.test(path);

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName, timeout = 2000, noStore = false) {
  const cache = await caches.open(cacheName);
  try {
    const response = await Promise.race([
      fetch(request, noStore ? { cache: 'no-store' } : undefined),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout)),
    ]);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw new Error('offline');
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  if (isAudio(url.pathname)) return;   // 音频不要进 SW，交给浏览器流式取

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await networkFirst(request, PAGES, 12000, true);
      } catch {
        const cache = await caches.open(PAGES);
        const shell = await cache.match('/index.html') || await cache.match('/') || await caches.match('/index.html');
        return shell || new Response('离线了，连上网络再刷新一次。', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  if (isData(url.pathname)) {
    event.respondWith(networkFirst(request, PAGES, 2000));
    return;
  }

  if (isAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, ASSETS));
  }
});

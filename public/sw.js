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
const VERSION = 'v2';
const ASSETS = `hub-assets-${VERSION}`;
const PAGES = `hub-pages-${VERSION}`;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => !key.endsWith(VERSION)).map(key => caches.delete(key)));
    await self.clients.claim();
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

async function networkFirst(request, cacheName, timeout = 2000) {
  const cache = await caches.open(cacheName);
  try {
    const response = await Promise.race([
      fetch(request),
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
        return await networkFirst(request, PAGES, 12000);
      } catch {
        const cache = await caches.open(PAGES);
        const shell = await cache.match('/index.html') || await caches.match('/');
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

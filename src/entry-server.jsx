// 构建期预渲染入口（只在 Node 里跑，不进浏览器包）
//
// 为什么不做 hydrate：这个站的很多内容来自 localStorage（主题、身份、待办数）
// 和 Canvas（猫），水合时必然对不上，React 会报错并回退成整页重渲染。
// 所以这里只生成一份和真实版面一致的静态 HTML，浏览器仍然用 createRoot
// 全量接管 —— 功能一行都不用改，收益是「HTML 到手就有内容」。
//
// localStorage / matchMedia 这些浏览器对象在 Node 里不存在，
// 这里先垫一层最小实现，再动态 import 应用（顺序很重要）。

const store = new Map();

function installBrowserStubs() {
  if (typeof globalThis.localStorage === 'undefined') {
    globalThis.localStorage = {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)); },
      removeItem: key => { store.delete(key); },
      clear: () => store.clear(),
      key: i => [...store.keys()][i] ?? null,
      get length() { return store.size; },
    };
  }
  if (typeof globalThis.matchMedia === 'undefined') {
    globalThis.matchMedia = () => ({
      matches: false,
      media: '',
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    });
  }
  if (typeof globalThis.requestAnimationFrame === 'undefined') {
    globalThis.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 16);
    globalThis.cancelAnimationFrame = id => clearTimeout(id);
  }
}

export async function render({ links } = {}) {
  installBrowserStubs();
  const [{ renderToReadableStream }, React, { Router, seedPrerender }] = await Promise.all([
    import('react-dom/server'),
    import('react'),
    import('./main.jsx'),
  ]);
  seedPrerender({ links });

  // renderToString 不支持 Suspense（页面里有懒加载的音乐播放器和命令面板，
  // 一碰就整页放弃渲染）。改用流式渲染：这两块的 fallback 是 null，
  // 主内容照样能完整吐出来。
  const stream = await renderToReadableStream(React.createElement(Router), {
    onError(err) {
      console.error('[prerender] 渲染告警：', err?.stack || err?.message || err);
    },
  });
  await stream.allReady;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  html += decoder.decode();
  return html;
}

// 构建后把首页预渲染进 dist/index.html。
//
// 只做一件事：把 React 在 Node 里渲染出的静态标记塞进 #root。
// 浏览器仍用 createRoot 全量接管（不做 hydrate，见 src/entry-server.jsx 的说明），
// 所以 localStorage / Canvas / 事件这些统统不受影响。
//
// 顺带做两件让首屏更稳的事：
//   1. 样式表加 onload 标记，骨架在「CSS 到手」时就让位；
//   2. 在左栏插一个「今日完成」的占位，避免 React 挂载时整页跳一下。
import fs from 'node:fs';
import path from 'node:path';
import { render } from '../dist-ssr/entry-server.js';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const linksRaw = JSON.parse(read('public/links.json'));
const now = JSON.parse(read('public/now.json'));
const links = Array.isArray(linksRaw) ? linksRaw : linksRaw.links ?? [];

let html = await render({ links, now });

// 头像在客户端要等 onLoad 才加 is-loaded（渐变浮现），预渲染里没有 JS，
// 补上这个类，否则静态版是空圆环。
html = html.replace('class="portrait-wrap relative', 'class="portrait-wrap is-loaded relative');

// 兜底：出现 React 的「切回客户端渲染」模板，说明 SSR 里有东西抛了。
// 这种标记里带本机绝对路径，绝不能发到线上 —— 直接让构建失败。
if (html.includes('data-msg') || html.includes('dist-ssr')) {
  const m = html.match(/<template data-msg="(.{0,200})/s);
  throw new Error(`预渲染输出里有错误模板，构建中止。\n${m ? m[1] : ''}`);
}

// react-dom 的 Suspense 会在标记里插 <!--$--> 这类注释，静态页面用不上
html = html.replace(/<!--\/?\$-->|<!--\$!-->/g, '').replace(/<!--\/?-->(\s*)$/, '');

const file = path.join(root, 'dist/index.html');
let doc = fs.readFileSync(file, 'utf8');

const anchor = '<div id="root"></div>';
if (!doc.includes(anchor)) {
  throw new Error('dist/index.html 里找不到空的 #root，预渲染中止');
}
doc = doc.replace(anchor, `<div id="root">${html}</div>`);

// 样式表就绪就把骨架撤掉（CSS 一到，预渲染的真内容就能顶上来）
doc = doc.replace(/<link rel="stylesheet"([^>]*?)>/, (all, attrs) =>
  all.includes('onload') ? all : `<link rel="stylesheet"${attrs} onload="document.documentElement.setAttribute('data-css','1')">`);

// 「今日完成」的占位：head 脚本判断到有本地记录才会显示它（html.has-done），
// React 挂载后整块换成真内容，高度对齐，首页不会跳。
// 先清掉可能已经存在的占位，保证只有一份（这一步要幂等）。
doc = doc.replace(/<div class="done-slot"[^>]*><\/div>/g, '');
doc = doc.replace(
  '<div class="dock-slot" id="dock-inline"></div>',
  '<div class="done-slot" aria-hidden="true"></div><div class="dock-slot" id="dock-inline"></div>',
);

fs.writeFileSync(file, doc);
console.log(`[prerender] 首页标记 ${html.length} B 已写入 dist/index.html（总 ${doc.length} B）`);

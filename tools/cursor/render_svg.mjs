// 把 tools/cursor/*.svg 渲成 256×256 透明 PNG，供 make_cursor.py 缩到 32×32。
//
// 本仓库没把 playwright 列进依赖（太重），所以这里在本地找它的两种位置：
//   1) 当前项目 node_modules
//   2) 同级 link-station/ 里的 node_modules（平时跑截图脚本用的那份）
// 用法：cd personal-hub && node tools/cursor/render_svg.mjs
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

async function loadPlaywright() {
  const candidates = [
    'playwright',
    path.join(here, '../../../link-station/node_modules/playwright'),
    path.join(here, '../../node_modules/playwright'),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch { /* 换下一个 */ }
  }
  throw new Error('找不到 playwright，先在有它的目录装一份，或改这里的候选路径');
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 300, height: 300 } });

for (const name of ['cat', 'paw']) {
  const svgPath = path.join(here, `${name}.svg`);
  await page.goto(pathToFileURL(svgPath).href);
  const svg = await page.$('svg');
  await svg.screenshot({ path: path.join(here, `${name}-256.png`), omitBackground: true });
  console.log(name, '->', `${name}-256.png`);
}

await browser.close();

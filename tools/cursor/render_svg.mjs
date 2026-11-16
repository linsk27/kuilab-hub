// 把 SVG 用 Chromium 渲成 256×256 透明 PNG（矢量是曲线，缩到 32 才不糊）
import { chromium } from 'playwright';
import path from 'path';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 300, height: 300 } });
for (const name of ['cat', 'paw']) {
  const file = 'file:///' + path.resolve(`../../personal-hub/tools/cursor/${name}.svg`).replace(/\\/g, '/');
  await page.goto(file);
  const svg = await page.$('svg');
  await svg.screenshot({ path: `../../personal-hub/tools/cursor/${name}-256.png`, omitBackground: true });
  console.log(name, 'rendered');
}
await browser.close();

// 站点的公开总量：#/stats 用。
// 单独做成 GET，是为了能挂 CDN 缓存 —— POST 在 Vercel 上不会被边缘缓存，
// 每次都要冷启动 + 查库（实测 1.5~3.6s）。现在第一次之后基本是 50ms 内。
const ENDPOINT = process.env.WB_STATION_ENDPOINT || 'https://paper-personal-hub.app.workbuddy.host';
const KEY = process.env.WB_PUBLISHABLE_KEY || 'wbpk_eVEY1aEpbxlBCrnf210BzL_660WITnYX51B0LFZEurdcxLXJKsTkod8';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }
  try {
    const upstream = await fetch(`${ENDPOINT}/.cloud/database/rest/rpc/station_site_stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-wb-webapp-access-key': KEY },
      body: '{}',
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) throw new Error(`stats ${upstream.status}`);
    const data = await upstream.json();
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).send(JSON.stringify(data));
  } catch {
    // 失败不缓存，免得一次抖动被记 60 秒
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: false });
  }
}

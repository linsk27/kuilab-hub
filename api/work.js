// Vercel Serverless Function：工作待办的转发层。
// 和 api/station.js 同一套路：浏览器只打本站，服务端再拿 publishableKey 去调 RPC，
// 数据库那边用 Origin 白名单挡住了浏览器直连。
//
// 鉴权不在这里做，在 work_rpc 里：请求带一句口令，函数把它 sha256 成 space 名，
// 只读写这个 space 下的行。也就是说 —— 口令对不上，拿到的就是空列表。
const ENDPOINT = process.env.WB_STATION_ENDPOINT || 'https://paper-personal-hub.app.workbuddy.host';
const KEY = process.env.WB_PUBLISHABLE_KEY || 'wbpk_eVEY1aEpbxlBCrnf210BzL_660WITnYX51B0LFZEurdcxLXJKsTkod8';
const RPC_URL = `${ENDPOINT}/.cloud/database/rest/rpc/work_rpc`;
const MAX_BODY = 200000;
const ACTIONS = new Set(['pull', 'push']);

function hostOf(value) {
  try { return new URL(String(value)).hostname.toLowerCase(); } catch { return ''; }
}
function allowedHost(host) {
  return /^(www\.)?kuilab\.cn$/i.test(host)
    || /\.vercel\.app$/i.test(host)
    || /^(localhost|127\.0\.0\.1)$/i.test(host) || /\.localhost$/i.test(host)
    || host === 'paper-personal-hub.app.workbuddy.host';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  const siteHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].toLowerCase();
  const originHost = hostOf(req.headers.origin || req.headers.referer || '');
  if (!allowedHost(siteHost) || (originHost && !allowedHost(originHost))) {
    res.status(403).json({ ok: false, error: 'origin_not_allowed' });
    return;
  }

  let input = req.body;
  if (!input || typeof input !== 'object') {
    try { input = JSON.parse(String(input || '{}')); } catch { input = null; }
  }
  const action = String(input?.action || '');
  const payload = input?.payload && typeof input.payload === 'object' && !Array.isArray(input.payload) ? input.payload : {};
  if (!ACTIONS.has(action)) {
    res.status(400).json({ ok: false, error: 'unknown_action' });
    return;
  }
  const pass = String(payload.pass || '');
  if (pass.length < 6 || pass.length > 200) {
    res.status(400).json({ ok: false, error: 'bad_pass' });
    return;
  }

  const body = JSON.stringify({ p_action: action, p_payload: { ...payload, pass } });
  if (body.length > MAX_BODY) {
    res.status(413).json({ ok: false, error: 'payload_too_large' });
    return;
  }

  try {
    const upstream = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-wb-webapp-access-key': KEY },
      body,
      signal: AbortSignal.timeout(8000),
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(text || '{}');
  } catch {
    res.status(502).json({ ok: false, error: 'upstream_unavailable' });
  }
}

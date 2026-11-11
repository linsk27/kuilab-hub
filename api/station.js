// Vercel Serverless Function：联络站 RPC 的同源转发层。
// 云端数据面按 Origin 白名单放行，只认应用自有域名与本地开发地址；
// 部署在 kuilab.cn 的浏览器请求会被预检 403 拒绝。服务端发起的请求不带
// Origin，因此由这里转发即可，浏览器始终只访问本站。
// 这里只用 publishableKey（前端本来也可见），不含任何私密凭据。
const ENDPOINT = process.env.WB_STATION_ENDPOINT || 'https://paper-personal-hub.app.workbuddy.host';
const KEY = process.env.WB_PUBLISHABLE_KEY || 'wbpk_eVEY1aEpbxlBCrnf210BzL_660WITnYX51B0LFZEurdcxLXJKsTkod8';
const RPC_URL = `${ENDPOINT}/.cloud/database/rest/rpc/station_rpc`;
const MAX_BODY = 20000;

// 只允许联络站已经定义好的动作，避免这个入口被当成任意数据库代理。
const ACTIONS = new Set([
  'presence',
  'author_login', 'author_check', 'author_heartbeat', 'author_logout',
  'author_inbox', 'author_read', 'author_reply', 'author_space_create',
  'guest_open', 'guest_post', 'guest_read',
  'guest_rename', 'guest_invite_create', 'guest_invite_redeem',
]);

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

  // 双保险：请求必须到达本站，且浏览器来源必须是本站或允许的预览域名。
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
  const body = JSON.stringify({ p_action: action, p_payload: payload });
  if (body.length > MAX_BODY) {
    res.status(413).json({ ok: false, error: 'payload_too_large' });
    return;
  }

  try {
    // 不转发 Origin / Referer：这是服务端到服务端的调用。
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
};

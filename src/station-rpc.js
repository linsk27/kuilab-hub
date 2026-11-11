import { cloud } from './station-cloud';

// 新联络站后端只有一个入口函数：station_rpc(p_action, p_payload)。
// 成功时 data 是 jsonb 对象；失败时 data 形如 {ok:false,error}。
const RPC_NAME = 'station_rpc';

export function rpcErrorText(error) {
  const business = error?.business;
  if (business) {
    switch (business) {
      case 'invalid_pass': return '口令不正确，请重试。';
      case 'unauthorized': return '作者会话已失效，请重新登录。';
      case 'invalid_secret': return '联络凭据无效，请新建一次联络。';
      case 'space_not_found': return '这个联络空间不存在或已结束，请新建一次联络。';
      case 'rate_limited': return '发送太频繁，请稍后再试。';
      default: return `操作未完成：${business}`;
    }
  }
  const code = String(error?.code || error?.kind || '');
  const message = String(error?.message || '');
  if (/quota|exhaust|limit/i.test(code)) return '云服务额度不足或请求过于频繁，请稍后重试。';
  if (/42501|unauthenticated|invalid_grant/i.test(code)) return '登录已失效或没有访问权限，请重新操作。';
  // 后端函数/表还没建好时，PostgREST 会返回英文的 schema cache 报错，转成可理解的提示。
  if (/could not find the function|schema cache|does not exist|pgrst|undefined_function/i.test(`${code} ${message}`)) return '云服务尚未就绪（后端函数或数据表仍在准备中），请稍后重试。';
  if (/network|fetch|timeout|bad_response|failed to fetch/i.test(`${code} ${message}`)) return '暂时无法连接云服务，请检查网络后重试。';
  return message ? `操作未完成：${message}` : '操作未完成，请稍后重试。';
}

function normalizeData(raw) {
  let data = raw;
  // 某些 PostgREST 版本把返回 jsonb 的函数结果序列化成 JSON 字符串或单元素数组。
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { /* 交给后面的格式校验报错 */ }
  }
  if (Array.isArray(data) && data.length === 1) data = data[0];
  return data;
}

export async function rpc(action, payload = {}) {
  let result;
  try {
    result = await cloud.database.rpc(RPC_NAME, { p_action: action, p_payload: payload });
  } catch (e) {
    const err = new Error(String(e?.message || e || 'network'));
    err.code = 'network';
    throw err;
  }
  if (!result || result.error) {
    const upstream = result?.error;
    const err = new Error(String(upstream?.message || upstream || '云服务未返回结果'));
    err.code = String(upstream?.code || upstream?.kind || 'rpc_error');
    throw err;
  }
  const data = normalizeData(result.data);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    const err = new Error('服务返回格式异常');
    err.code = 'bad_response';
    throw err;
  }
  if (data.ok === false || (data.error && data.ok !== true)) {
    const err = new Error(String(data.error || 'operation_failed'));
    err.business = String(data.error || 'operation_failed');
    throw err;
  }
  return data;
}

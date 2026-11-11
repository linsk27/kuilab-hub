import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk';

export const publicConfig = Object.freeze({
  resourceId: 'wbcs_OsoISoWoC83f5ZbZNGOWAx',
  endpoint: 'https://paper-personal-hub.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_eVEY1aEpbxlBCrnf210BzL_660WITnYX51B0LFZEurdcxLXJKsTkod8',
});
export const cloud = createWorkBuddyCloud({
  endpoint: publicConfig.endpoint,
  oauthRelayBaseUrl: publicConfig.oauthRelayBaseUrl,
  publishableKey: publicConfig.publishableKey,
});
export function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}
export function explainError(error) {
  const code = String(error?.code || error?.kind || '');
  if (/quota|exhaust|limit/i.test(code)) return '云服务额度不足或请求过于频繁，请稍后重试或检查应用额度。';
  if (/42501|unauthenticated|invalid_grant/.test(code)) return '登录已失效、邀请已过期或当前账号没有访问权限，请重新登录或检查邀请。';
  if (/network|fetch/i.test(`${code} ${error?.message}`)) return '暂时无法连接云服务。请检查网络；本地预览可能受到应用域名访问限制。';
  return '操作未完成，请重试。若仍失败，请检查登录和云服务状态。';
}
export async function requireSession() {
  const session = unwrap(await cloud.auth.getSession());
  if (!session) throw { code: 'unauthenticated' };
  return session;
}

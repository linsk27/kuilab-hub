// 纯文本版本探针：用来确认当前域名到底落在了哪一次部署上。
// 打开 https://www.kuilab.cn/api/version 即可看到，不依赖前端渲染，也不会被页面缓存影响。
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).json({
    site: 'personal-hub',
    app: 'kuilab-hub',
    commit: process.env.VERCEL_GIT_COMMIT_SHA || 'unknown',
    deployment: process.env.VERCEL_URL || 'unknown',
    region: process.env.VERCEL_REGION || 'unknown',
    time: new Date().toISOString(),
  });
}

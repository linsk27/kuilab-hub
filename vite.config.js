import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import blog from './api/blog.js';

// 本地 dev 直接复用 api/blog.js 的 handler，
// 这样不用装 vercel 也能在 5186 看到首页那块「最新几篇」。
function apiDev() {
  return {
    name: 'api-dev',
    configureServer(server) {
      server.middlewares.use('/api/blog', async (req, res) => {
        const shim = {
          setHeader: (key, value) => res.setHeader(key, value),
          status(code) { res.statusCode = code; return this; },
          json(body) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(body));
          },
        };
        try {
          await blog(req, shim);
        } catch {
          res.statusCode = 200;
          res.end('{"ok":false,"posts":[]}');
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), apiDev()],
  base: '/',
});

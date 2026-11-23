import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import blog from './api/blog.js';
import station from './api/station.js';
import stats from './api/stats.js';
import work from './api/work.js';

// 本地 dev 直接复用 api/*.js 的 handler，
// 这样不用装 vercel 也能在本地看到首页的「最新几篇」和 #/stats 的统计。
function apiDev() {
  const shim = res => ({
    setHeader: (key, value) => res.setHeader(key, value),
    status(code) { res.statusCode = code; return this; },
    json(body) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
    },
    send(body) { res.end(body); },
    end(body) { res.end(body); },
  });

  return {
    name: 'api-dev',
    configureServer(server) {
      server.middlewares.use('/api/blog', async (req, res) => {
        try {
          await blog(req, shim(res));
        } catch {
          res.statusCode = 200;
          res.end('{"ok":false,"posts":[]}');
        }
      });

      server.middlewares.use('/api/stats', async (req, res) => {
        try {
          await stats(req, shim(res));
        } catch {
          res.statusCode = 200;
          res.end('{"ok":false}');
        }
      });

      server.middlewares.use('/api/work', async (req, res) => {
        if (req.method === 'POST') {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          try {
            req.body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          } catch {
            req.body = {};
          }
        }
        try {
          await work(req, shim(res));
        } catch {
          res.statusCode = 502;
          res.end('{"ok":false,"error":"dev_shim_failed"}');
        }
      });

      // Vercel 会替我们把 JSON body 解析好；这里要自己收一遍
      server.middlewares.use('/api/station', async (req, res) => {
        if (req.method === 'POST') {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          try {
            req.body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          } catch {
            req.body = {};
          }
        }
        try {
          await station(req, shim(res));
        } catch {
          res.statusCode = 502;
          res.end('{"ok":false,"error":"dev_shim_failed"}');
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), apiDev()],
  base: '/',
});

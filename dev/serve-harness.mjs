// Dev-only: test the in-page editor on real sites without loading the extension.
//   node dev/serve-harness.mjs
//   open http://localhost:5179/p/https/example.com/some/page
// The page's HTML is fetched from the real site, CSP meta tags are removed, a <base> tag keeps
// its scripts/styles/images loading from the real origin, and dev/harness.js is added.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const PORT = 5179;

createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/harness.js')) {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end(readFileSync(new URL('./harness.js', import.meta.url)));
    }
    const m = req.url.match(/^\/p\/(https?)\/([^/]+)(\/.*)?$/);
    if (!m) {
      res.statusCode = 404;
      return res.end('Use /p/https/<host>/<path>');
    }
    const target = `${m[1]}://${m[2]}${m[3] ?? '/'}`;
    const r = await fetch(target, {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36', accept: 'text/html' },
      redirect: 'follow',
    });
    let html = await r.text();
    html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
    const base = `<base href="${r.url}">`;
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (h) => `${h}${base}`) : base + html;
    const tag = `<script src="http://localhost:${PORT}/harness.js"></script>`;
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${tag}</body>`) : html + tag;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e));
  }
}).listen(PORT, () => console.log(`harness proxy on http://localhost:${PORT}/p/https/<host>/<path>`));

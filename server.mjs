/**
 * 本地部署服务器 —— SQLite 持久化 + 静态资源 + Edge Function 入口
 *
 *   npm start
 *   node --experimental-sqlite server.mjs [--port 5173] [--host 0.0.0.0]
 *                                        [--db data/blog.sqlite] [--quiet]
 *
 * 与 EdgeOne 的关系：src/main.js 仍是同一个 onRequest 处理器，这里只负责
 *   - 用 SQLite 实现 KV / Blob 存储，替代平台绑定；
 *   - 把 Node 的 http.IncomingMessage 转成标准 Request；
 *   - 提供 /usr/ 静态资源（其余路径全部交给函数处理）。
 * 因此同一份代码既能部署到 EdgeOne（KV + Blob），也能在本地/容器里独立运行。
 */
import http from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// 本地已有每请求摘要日志；默认关闭 main.js 的结构化 JSON 日志，避免重复。
// 需要结构化日志时用 `LOG_LEVEL=info npm start`。
process.env.LOG_LEVEL ||= 'off';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const argv = process.argv.slice(2);

function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : 'true';
}

const PORT = Number(process.env.PORT || arg('port', '5173')) || 5173;
const HOST = process.env.HOST || arg('host', '0.0.0.0');
const DB_PATH = resolve(ROOT, process.env.DB_PATH || arg('db', 'data/blog.sqlite'));
const QUIET = argv.includes('--quiet');
const MAX_BODY = Number(process.env.MAX_BODY_BYTES || 25 * 1024 * 1024) || 25 * 1024 * 1024;
// 本地没有边缘函数 1MB 的请求体限制，默认把附件上限放宽到 20MB（仍受 MAX_BODY 约束）
process.env.MAX_UPLOAD_BYTES ||= String(
  Math.max(0, Math.min(MAX_BODY - 1024 * 1024, 20 * 1024 * 1024))
);
const USR_ROOT = resolve(ROOT, 'usr');

let sqlite;
try {
  sqlite = await import('./src/storage/sqlite.js');
} catch (e) {
  if (e?.code === 'ERR_UNKNOWN_BUILTIN_MODULE' || /node:sqlite/.test(String(e?.message || ''))) {
    console.error(
      '✗ 当前 Node 不支持 node:sqlite。\n' +
        '  需要 Node.js >= 22.5，并以 `node --experimental-sqlite server.mjs` 启动；\n' +
        '  直接运行 `npm start` 已内置该参数。'
    );
    process.exit(1);
  }
  throw e;
}

let onRequest;
let Database;
let KV;
try {
  [{ default: onRequest }, { Database }, { KV }] = await Promise.all([
    import('./src/main.js'),
    import('./src/db.js'),
    import('./src/storage/kv.js'),
  ]);
} catch (e) {
  if (/Cannot find package|ERR_MODULE_NOT_FOUND/.test(String(e?.message || ''))) {
    console.error('✗ 缺少运行依赖，请先执行 `npm install`。\n', e.message);
    process.exit(1);
  }
  throw e;
}

const store = sqlite.openSqliteStore({ path: DB_PATH });

/** 每个请求都新建 Database：KV 包装里的读缓存是请求级的，不能跨请求复用 */
function createDatabase() {
  const kv = new KV(store.binding);
  return new Database(kv, new sqlite.SqliteBlobStorage(store, kv));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.map': 'application/json',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
};

/** 只放行仓库 usr/ 下的真实文件，避免源码、数据库与配置被直接下载 */
async function serveStatic(pathname, req, res) {
  let rel;
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return false;
  }
  if (!rel.startsWith('usr/')) return false;

  const abs = resolve(ROOT, rel);
  if (!abs.startsWith(USR_ROOT + sep)) return false;

  try {
    const st = await stat(abs);
    if (!st.isFile()) return false;

    const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag });
      res.end();
      return true;
    }

    const ext = extname(abs).toLowerCase();
    // admin.css 不带 hash 且经常调整，给短缓存；其余静态资源 1 小时
    const maxAge = /\/(css\/admin\.css|js\/joe\.admin-editor)/.test(rel) ? 300 : 3600;
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': `public, max-age=${maxAge}`,
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    res.end(req.method === 'HEAD' ? undefined : await readFile(abs));
    return true;
  } catch {
    return false;
  }
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        settled = true;
        const err = new Error('请求体超过大小限制');
        err.status = 413;
        reject(err);
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolvePromise(Buffer.concat(chunks));
    });
    req.on('error', (e) => {
      if (settled) return;
      settled = true;
      reject(e);
    });
  });
}

function sendError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`${status} ${message}\n`);
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  try {
    const parsed = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (await serveStatic(parsed.pathname, req, res)) return;

    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      sendError(res, e.status || 400, e.message);
      return;
    }

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers[k] = v;
    }
    // 本机 socket 地址是可信来源，覆盖客户端自带的 X-Real-IP，
    // 供安全模块（评论身份键、后台 IP 白名单）使用。
    headers['x-real-ip'] = String(req.socket.remoteAddress || '').replace(/^::ffff:/i, '');

    const request = new Request(parsed.href, {
      method: req.method,
      headers,
      body: body.length ? body : undefined,
      redirect: 'manual',
    });

    const env = { __database: createDatabase() };
    const out = await onRequest({ request, env, params: {}, waitUntil() {} });
    const buf = Buffer.from(await out.arrayBuffer());

    // 本地走 HTTP，浏览器会拒收带 Secure 的会话 Cookie
    const setCookies = (out.headers.getSetCookie?.() || []).map((c) =>
      c.replace(/;\s*Secure/gi, '')
    );

    res.statusCode = out.status;
    for (const [k, v] of out.headers) {
      const key = k.toLowerCase();
      if (key === 'set-cookie' || key === 'content-length' || key === 'transfer-encoding') continue;
      res.setHeader(k, v);
    }
    if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
    if (req.method !== 'HEAD') res.setHeader('Content-Length', buf.length);
    res.end(req.method === 'HEAD' ? undefined : buf);
  } catch (e) {
    console.error('[server]', e);
    if (!res.headersSent) sendError(res, 500, e?.message || 'Internal Server Error');
    else res.end();
  } finally {
    if (!QUIET) {
      console.log(`${req.method} ${req.url} → ${res.statusCode} ${Date.now() - started}ms`);
    }
  }
});

server.listen(PORT, HOST, () => {
  const installed = store.binding.get('opt:installed');
  installed
    .then((v) => (v ? '已安装' : '未安装，首次访问将进入 /install'))
    .catch(() => '状态未知')
    .then((state) => {
      console.log(`SQLite   ${DB_PATH}`);
      console.log(`本地服务 http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}  (${state})`);
    });
});

function shutdown(signal) {
  console.log(`\n收到 ${signal}，正在关闭…`);
  server.close(() => {
    store.close();
    process.exit(0);
  });
  server.closeAllConnections?.();
  setTimeout(() => {
    store.close();
    process.exit(0);
  }, 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (e) => {
  console.error('[server] uncaughtException', e);
  shutdown('uncaughtException');
});
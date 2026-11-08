/**
 * 本地预览服务器 —— 把 src/main.js 当作真实边缘函数挂载到 HTTP 上，
 * 供设计迭代时登录后台截图用。不参与生产构建。
 *
 *   node dev-server.mjs [--reset] [--port 5173]
 *
 * --reset 清空内存 KV 并重新安装 + 灌入示例内容。
 */
import http from 'node:http';
import { stat, readFile } from 'node:fs/promises';

const argv = process.argv.slice(2);
const RESET = argv.includes('--reset');
const PORT = Number(argv[argv.indexOf('--port') + 1]) || 5173;
const HOST = '127.0.0.1';

class MockKV {
  constructor() { this.map = new Map(); }
  async get(key, opts) {
    const v = this.map.get(key);
    if (v === undefined) return null;
    const type = typeof opts === 'string' ? opts : opts?.type || 'text';
    if (type === 'json' || type === 'array') { try { return JSON.parse(v); } catch { return null; } }
    return v;
  }
  async put(key, value) { this.map.set(key, String(value)); }
  async delete(key) { this.map.delete(key); }
  async list({ prefix = '', limit = 1000 } = {}) {
    const keys = [...this.map.keys()].filter((k) => k.startsWith(prefix)).sort();
    return { keys: keys.slice(0, limit).map((k) => ({ key: k, name: k })), complete: true, cursor: null };
  }
}

const KV = new MockKV();
globalThis.BLOG_KV = KV;

const { default: onRequest } = await import('./src/main.js');
const { KV: KVWrap } = await import('./src/storage/kv.js');
const { Database } = await import('./src/db.js');
const { BlobStorage } = await import('./src/storage/blob.js');

/** 安装 + 灌入足以审视排版的内容 */
async function seed() {
  const db = new Database(new KVWrap(KV), new BlobStorage(new KVWrap(KV)));
  for (const [k, v] of Object.entries({
    title: '墨记', description: '记录技术与生活的一隅', theme: 'joe', author: '墨',
    installed: 1,
  })) await db.kv.putJSON(`opt:${k}`, v);

  // 演示站默认建站日期（后台「站点设置」可改）
  const { JOE_DEFAULTS } = await import('./src/render/theme-joe.js');
  await db.kv.putJSON('opt:theme:joe', { ...JOE_DEFAULTS, JBirthDay: '2024/01/01 00:00:00' });

  const users = await db.listUsers();
  if (!users.length) {
    await db.createUser({ name: 'admin', mail: 'admin@example.com', password: 'admin123456', screenName: 'admin' });
  }
  const list = await db.listUsers();
  const author = list[0];

  const cats = [['随笔', 'essay'], ['技术', 'tech'], ['设计', 'design']];
  const catIds = {};
  for (const [name, slug] of cats) catIds[name] = await db.createMeta({ type: 'category', name, slug, description: '' });

  const tagIds = {
    edgeone: await db.createMeta({ type: 'tag', name: 'EdgeOne', slug: 'edgeone', description: '' }),
    typography: await db.createMeta({ type: 'tag', name: '排版', slug: 'typography', description: '' }),
  };

  const posts = [
    ['用 EdgeOne 跑一个 Typecho：KV 存数据，Blob 存图片', '这是一篇比较长的技术随笔，用来检验列表页在标题换行、摘要截断以及各种极端内容长度下的排版表现。', '技术'],
    ['设计系统里那些不起眼但很关键的留白', '留白不是空，是让内容呼吸的装置。', '设计'],
    ['关于写作节奏的一些不成熟想法', '慢慢写，慢慢想。', '随笔'],
    ['A short note about typography on the web', 'An English-titled post to check mixed CJK/Latin wrapping behaviour in tables and cards.', '设计'],
    ['把旧照片翻出来的时候', '有些东西会变，有些不会。', '随笔'],
    ['QPS 到底该怎么量', '压测的一点笔记，记给自己看。', '技术'],
  ];
  // 给演示文章一些阅读/点赞数据，让仪表盘与热门列表有内容
  await db.kv.putJSON('stat:views', { 1: 128, 2: 96, 3: 64, 4: 42, 5: 31, 6: 18 });
  await db.kv.putJSON('stat:agree', { 1: 12, 2: 8, 3: 5, 4: 3, 5: 2, 6: 1 });

  const tagOf = { 技术: [tagIds.edgeone.mid], 设计: [tagIds.typography.mid], 随笔: [] };
  let i = 0;
  for (const [title, text, cat] of posts) {
    await db.createContent({
      title, text, authorId: author.uid, type: 'post',
      categories: [catIds[cat].mid], tags: tagOf[cat],
      slug: `post-${i + 1}`, created: Math.floor(Date.now() / 1000) - i * 3600,
    });
    i++;
  }
  // 置顶一篇
  const all = (await db.listContents({ type: 'post', pageSize: 20 })).items;
  if (all[1]) await db.updateContent(all[1].cid, { sticky: 1 });

  for (const [cid, author2, text, status] of [
    [all[0]?.cid, '路过的风', '写得很清楚，收藏了。', 'approved'],
    [all[0]?.cid, '匿名', '期待后续更新～', 'approved'],
    [all[1]?.cid, '张三', '留白的说法很有共鸣。', 'waiting'],
    [all[2]?.cid, 'spam-bot', '加个链接 http://spam.example.com 看看效果', 'spam'],
  ]) {
    if (cid) await db.createComment({ cid, author: author2, mail: 'x@y.z', text, status });
  }

  // 关于页面：导航「关于本站」优先渲染 slug=about 的独立页面
  await db.createContent({
    title: '关于本站',
    slug: 'about',
    type: 'page',
    status: 'publish',
    authorId: author.uid,
    text: `### 关于本站

这里是「墨记」，记录技术与生活的一隅。

- 运行在 **EdgeOne** 边缘函数上
- 文章与配置存放在 KV，附件存放在 Blob
- 主题：Joe

### 关于我

一名热爱技术、偶尔写字的开发者。`,
  });

  // 留言板：独立页面承载评论，顶部导航自动出现「留言板」
  await db.createContent({
    title: '留言板',
    slug: 'guestbook',
    type: 'page',
    status: 'publish',
    allowComment: true,
    authorId: author.uid,
    text: '欢迎在这里留下你的想法、建议，或者只是打个招呼。',
  });
  return db;
}

if (RESET) {
  KV.map.clear();
  await seed();
}

// ---- HTTP ----
const ROOT = new URL('.', import.meta.url).pathname;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json',
};

/** 从仓库根提供静态资源，模拟线上 /usr/ 等目录。 */
async function serveStatic(pathname, res) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  const abs = ROOT + rel;
  if (!abs.startsWith(ROOT)) return false;              // 防目录穿越
  try {
    const st = await stat(abs);
    if (!st.isFile()) return false;
    const ext = abs.slice(abs.lastIndexOf('.')).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-store',
    });
    res.end(await readFile(abs));
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
    if (await serveStatic(pathname, res)) return;

    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;

    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method, headers, body: body.length ? body : undefined, redirect: 'manual',
    });
    const out = await onRequest({ request, env: {}, params: {}, waitUntil() {} });
    const buf = Buffer.from(await out.arrayBuffer());
    const outHeaders = Object.fromEntries(out.headers.entries());
    // 本地预览走 HTTP：浏览器会拒收带 Secure 的会话 Cookie，去掉该标记仅用于预览
    if (outHeaders['set-cookie']) outHeaders['set-cookie'] = outHeaders['set-cookie'].replace(/;\s*Secure/gi, '');
    res.writeHead(out.status, outHeaders);
    res.end(buf);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('SERVER ERROR: ' + e.message + '\n\n' + e.stack);
  }
});

server.listen(PORT, HOST, () => console.log(`预览服务: http://${HOST}:${PORT}  (admin / admin123456)`));
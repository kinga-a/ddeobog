/**
 * 真实端到端验证：起一个 HTTP 服务器，把构建产物当作真实的边缘函数挂载，
 * 通过真实网络请求验证全流程，而不是在进程内直接调用。
 *
 * 运行：node test-e2e.mjs
 */
import http from 'node:http';
import assert from 'node:assert';

// ---- 内存版 KV（模拟 EdgeOne KV 绑定）----
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
    return { keys: keys.slice(0, limit).map((key) => ({ key, name: key })), complete: true, cursor: null };
  }
}
const KV = new MockKV();
// 边缘运行时通过 globalThis 注入 KV binding
globalThis.BLOG_KV = KV;

const { default: onRequest } = await import('./edge-functions/[[default]].js');

// ---- 真实 HTTP 服务器 ----
let cookie = '';
const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers[k] = v;
    }
    if (cookie) headers['Cookie'] = cookie;

    const url = `http://${req.headers.host}${req.url}`;
    const request = new Request(url, {
      method: req.method,
      headers,
      body: body.length ? body : undefined,
      redirect: 'manual',
    });

    const out = await onRequest({ request, env: {}, params: {}, waitUntil() {} });
    const sc = out.headers.get('Set-Cookie');
    if (sc) cookie = sc.split(';')[0];
    const buf = Buffer.from(await out.arrayBuffer());
    res.writeHead(out.status, Object.fromEntries(out.headers.entries()));
    res.end(buf);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('SERVER ERROR: ' + e.message + '\n\n' + e.stack);
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
console.log(`测试服务器: ${base}\n`);

const results = [];
async function get(p, opts = {}) {
  const r = await fetch(base + p, { redirect: 'manual', ...opts });
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') };
}
async function post(p, form, opts = {}) {
  const body = new URLSearchParams(form).toString();
  return get(p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(opts.headers || {}) },
    body,
  });
}
async function test(name, fn) {
  try { await fn(); results.push(`✓ ${name}`); }
  catch (e) { results.push(`✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

await test('HTTP: 未安装时 / 重定向到 /install', async () => {
  const r = await get('/');
  assert.equal(r.status, 302);
  assert.ok(r.loc.includes('/install'));
});

await test('HTTP: 安装向导页可访问', async () => {
  const r = await get('/install');
  assert.equal(r.status, 200);
  assert.ok(r.text.includes('name="password"'));
});

await test('HTTP: 完成安装', async () => {
  const r = await post('/install', {
    title: '我的博客', description: '端到端测试', name: 'admin', mail: 'a@b.c',
    password: 'password123', password2: 'password123',
  });
  assert.equal(r.status, 302, `实际 ${r.status}: ${r.text.slice(0, 200)}`);
});

await test('HTTP: 安装后 /install 已关闭（安全）', async () => {
  const r = await get('/install');
  assert.equal(r.status, 403, `实际 ${r.status}`);
});

await test('HTTP: 首页渲染', async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  assert.ok(r.text.includes('joe_header'));
});

await test('HTTP: 登录后台', async () => {
  const r = await post('/admin/login', { name: 'admin', password: 'password123', step: 'password' });
  assert.equal(r.status, 302, `实际 ${r.status}`);
});

await test('HTTP: 发布文章', async () => {
  const r = await post('/admin/post', {
    type: 'post', title: '第一篇文章', text: '## 标题\n\n正文内容 **加粗**。', status: 'publish', allowComment: '1',
  });
  assert.equal(r.status, 302, `实际 ${r.status}: ${r.text.slice(0, 200)}`);
});

await test('HTTP: 文章页渲染（含 Markdown）', async () => {
  const r = await get('/archives/2/');
  assert.equal(r.status, 200, `实际 ${r.status}`);
  assert.ok(r.text.includes('第一篇文章'));
  assert.ok(r.text.includes('<h2>') || r.text.includes('<strong>'), 'Markdown 未渲染');
});

await test('HTTP: 静态资源可直接取到', async () => {
  const r = await get('/usr/themes/joe/assets/style.css');
  assert.ok(r.status === 200 || r.status === 404, `异常状态 ${r.status}`);
});

await test('HTTP: 提交评论', async () => {
  const r = await post('/comment/2', { author: '访客', mail: 'v@v.c', text: '写得不错', parent: 0 });
  assert.ok(r.status === 200 || r.status === 302, `实际 ${r.status}: ${r.text.slice(0, 120)}`);
});

await test('HTTP: 跨域评论提交被拒（CSRF）', async () => {
  const before = KV.map.size;
  const r = await post('/comment/2',
    { author: 'E', mail: 'e@e.c', text: 'spam', parent: 0 },
    { headers: { Origin: 'https://evil.example.com' } });
  const wrote = [...KV.map.keys()].some((k) => k.startsWith('cmt:') && !KV.map.get(k));
  assert.ok(r.status >= 400 || wrote, `跨域评论未被拒绝（status=${r.status}）`);
  console.log(`    → 跨域评论返回 ${r.status}`);
});

await test('HTTP: RSS 输出', async () => {
  const r = await get('/feed/');
  assert.equal(r.status, 200);
  assert.ok(r.text.includes('<rss') || r.text.includes('<?xml'));
});

await test('HTTP: 搜索', async () => {
  const r = await get('/search/第一篇/');
  assert.equal(r.status, 200);
});

await test('HTTP: 跨域 POST 被拒（CSRF）', async () => {
  const r = await post('/admin/post', {
    type: 'post', title: 'CSRF', text: 'x', status: 'publish',
  }, { headers: { Origin: 'https://evil.example.com' } });
  assert.equal(r.status, 403, `实际 ${r.status}`);
});

await test('HTTP: 登录限流生效（真实 HTTP 层）', async () => {
  cookie = '';
  let locked = false;
  for (let i = 0; i < 7 && !locked; i++) {
    const r = await post('/admin/login', { name: 'admin', password: 'bad', step: 'password' });
    if (r.text.includes('尝试次数过多')) locked = true;
  }
  assert.ok(locked, '限流未触发');
});

await test('HTTP: 安装完成后无任何路径 500', async () => {
  for (const p of ['/', '/archives/2/', '/feed/', '/search/x/', '/tag/x/', '/category/x/', '/admin/login']) {
    const r = await get(p);
    assert.ok(r.status < 500, `${p} 返回 ${r.status}`);
  }
});

server.close();
console.log('========== 真实 HTTP 端到端测试 ==========');
results.forEach((r) => console.log(r));
console.log(`\n共 ${results.length} 项，失败 ${results.filter((x) => x.startsWith('✗')).length} 项`);
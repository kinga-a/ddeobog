/**
 * 打包产物测试：直接加载 edge-functions/[[default]].js（minified bundle），
 * 验证构建产物而非源码可用。
 * 运行：node test-bundle.mjs
 */
import assert from 'node:assert';

class MockKV {
  constructor() { this.map = new Map(); }
  async get(key, opts) {
    const v = this.map.get(key);
    if (v === undefined) return null;
    const type = typeof opts === 'string' ? opts : opts?.type || 'text';
    if (type === 'json') { try { return JSON.parse(v); } catch { return null; } }
    return v;
  }
  async put(key, value) { this.map.set(key, String(value)); }
  async delete(key) { this.map.delete(key); }
  async list({ prefix = '', limit = 256 } = {}) {
    const keys = [...this.map.keys()].filter((k) => k.startsWith(prefix)).sort();
    return { keys: keys.slice(0, limit).map((key) => ({ key })), complete: true, cursor: null };
  }
}
globalThis.BLOG_KV = new MockKV();

const { default: onRequest } = await import('./edge-functions/[[default]].js');
let cookie = '';

async function call(method, path, { form } = {}) {
  const headers = {};
  if (cookie) headers['Cookie'] = cookie;
  let body;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(form).toString();
  }
  const res = await onRequest({
    request: new Request(`https://x.test${path}`, { method, headers, body, redirect: 'manual' }),
    env: {}, params: {}, waitUntil: () => {},
  });
  const sc = res.headers.get('Set-Cookie');
  if (sc) cookie = sc.split(';')[0];
  return res;
}

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push(`✓ ${name}`); }
  catch (e) { results.push(`✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
};

await test('bundle: 未安装重定向 /install', async () => {
  const r = await call('GET', '/');
  assert.equal(r.status, 302);
  assert.ok(r.headers.get('Location').includes('/install'));
});

await test('bundle: 安装成功', async () => {
  const r = await call('POST', '/install', { form: {
    title: 'B', description: 'd', name: 'admin', mail: 'a@b.c',
    password: 'password123', password2: 'password123' } });
  assert.equal(r.status, 302);
});

await test('bundle: 首页渲染', async () => {
  const r = await call('GET', '/');
  assert.equal(r.status, 200);
  const h = await r.text();
  assert.ok(h.includes('joe_header'));
  assert.ok(h.includes('Hello TypechoEdge'));
});

await test('bundle: Markdown 渲染 + QR 二维码可用（qrcode-generator 已打进 bundle）', async () => {
  await call('POST', '/admin/login', { form: { name: 'admin', password: 'password123', step: 'password' } });
  const r = await call('GET', '/admin/security?step=bind');
  const h = await r.text();
  assert.ok(h.includes('<svg'), 'TOTP 绑定页应有二维码 SVG');
});

await test('bundle: 产物保留顶层 onRequest 绑定（EdgeOne shim 裸引用它）', async () => {
  const fs = await import('node:fs');
  const code = fs.readFileSync('./edge-functions/[[default]].js', 'utf8');
  // 一旦标识符被压缩，CLI 内联后的 shim 会抛 ReferenceError → 线上 545
  assert.ok(
    /\bfunction\s+onRequest\b/.test(code),
    '产物中缺少顶层 onRequest 绑定，构建配置可能又开启了标识符压缩'
  );
});

await test('bundle: 根路径入口 index.js 存在且与 catch-all 一致', async () => {
  const fs = await import('node:fs');
  const a = fs.readFileSync('./edge-functions/[[default]].js', 'utf8');
  // 官方路由表：edge-functions/index.js → example.com/
  // 缺了它 `/` 不匹配任何函数路由，落到静态层后因无 index.html 而 404
  const b = fs.readFileSync('./edge-functions/index.js', 'utf8');
  assert.equal(a, b);
});

console.log('\n========== bundle 测试 ==========');
results.forEach((r) => console.log(r));
console.log(`\n共 ${results.length} 项，失败 ${results.filter((r) => r.startsWith('✗')).length} 项`);
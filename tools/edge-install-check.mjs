/**
 * 边缘安装流程检查 —— 在「只暴露 Web 标准 API」的沙箱里跑一次完整安装，
 * 验证 EdgeOne 生产环境的行为，而这些行为在本地 Node 预览里是**不会触发**的：
 *
 *   1. POST /install 成功后自动创建「关于本站」「留言板」两个独立页面；
 *   2. /about/ 与 /guestbook/ 直接 200 可访问，留言板默认是便签墙模式；
 *   3. 站长在后台删除页面后，再次访问对应路由会自动重建（不会 500 / 404）；
 *   4. 导航始终显示「留言板」。
 *
 * 用法：node tools/edge-install-check.mjs
 */
import vm from 'node:vm';
import { build } from 'esbuild';

const fail = (msg) => {
  console.error('✗', msg);
  process.exitCode = 1;
  throw new Error(msg);
};
const pass = (msg) => console.log('✓', msg);

const result = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  globalName: 'EdgeApp',
  platform: 'neutral',
  write: false,
  logLevel: 'silent',
});
const code = result.outputFiles[0].text;

// 边缘运行时提供的 API（无 process / Buffer / require）
const allow = [
  'fetch', 'Request', 'Response', 'Headers', 'URL', 'URLSearchParams',
  'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal',
  'crypto', 'atob', 'btoa', 'console', 'structuredClone', 'ReadableStream',
  'WritableStream', 'TransformStream', 'Blob', 'FormData', 'Event', 'EventTarget',
  'performance', 'queueMicrotask', 'setTimeout', 'clearTimeout',
];
const sandbox = Object.create(null);
for (const k of allow) if (k in globalThis) sandbox[k] = globalThis[k];
const ctx = vm.createContext(sandbox, { name: 'edge-install' });
vm.runInContext(code, ctx, { filename: 'src/main.js (edge IIFE)', timeout: 30000 });

const handler = sandbox.EdgeApp?.onRequest || sandbox.EdgeApp?.default;
if (typeof handler !== 'function') fail('边缘入口未导出 onRequest');

// 内存 KV：模拟 EdgeOne KV 的 get(key, { type: 'json' }) 调用形式
const store = new Map();
const kv = {
  async get(key, type) {
    if (!store.has(key)) return null;
    const kind = typeof type === 'string' ? type : type?.type;
    const v = store.get(key);
    if (kind === 'json') return typeof v === 'string' ? JSON.parse(v) : v;
    if (kind === 'arrayBuffer') return typeof v === 'string' ? new TextEncoder().encode(v).buffer : v;
    return v;
  },
  async put(key, value) { store.set(key, value); },
  async delete(key) { store.delete(key); },
  async list(opts = {}) {
    const prefix = opts.prefix || '';
    return {
      keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })),
      complete: true,
      cursor: '',
    };
  },
};
const env = { BLOG_KV: kv };

const req = async (path, init = {}) => {
  const res = await handler({
    request: new Request(`https://example.com${path}`, init),
    env,
    params: {},
    waitUntil() {},
  });
  return { res, body: await res.text() };
};

// ---- 1. 安装 ----
const install = await req('/install', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    name: 'admin', mail: 'admin@example.com',
    password: 'password123', password2: 'password123',
    title: 'Edge 测试', description: '测试默认页面',
  }),
});
if (install.res.status !== 302) fail(`install 期望 302，实际 ${install.res.status}`);
pass('install 返回 302');

// ---- 2. 默认页面可访问 ----
const about = await req('/about/');
if (about.res.status !== 200) fail(`/about/ 期望 200，实际 ${about.res.status}`);
if (!about.body.includes('关于本站')) fail('/about/ 未渲染关于本站页面');
pass('/about/ 200 且包含「关于本站」');

const wall = await req('/guestbook/');
if (wall.res.status !== 200) fail(`/guestbook/ 期望 200，实际 ${wall.res.status}`);
if (!wall.body.includes('留言板')) fail('/guestbook/ 未渲染留言板');
if (!wall.body.includes('joe_wall__board')) fail('/guestbook/ 默认未启用便签墙');
pass('/guestbook/ 200、包含「留言板」且默认便签墙');

// ---- 3. 导航常显留言板 ----
const home = await req('/');
if (!home.body.includes('/guestbook/')) fail('首页导航缺少留言板链接');
pass('导航始终显示留言板');

// ---- 4. 删除页面后自动重建（这是 Node 端不会触发的分支）----
// 登录后台，删除走真实管理接口，确保经过数据层的索引缓存失效逻辑。
// 直接改 store 会绕过缓存失效，不能代表生产路径。
const login = await req('/admin/login', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ name: 'admin', password: 'password123' }),
});
if (login.res.status !== 302) fail(`admin login 期望 302，实际 ${login.res.status}`);
const cookie = String(login.res.headers.get('set-cookie') || '').split(';')[0];

const removePage = async (slug) => {
  const idx = JSON.parse(store.get('idx:posts'));
  const hit = idx.find((e) => e.slug === slug && e.type === 'page');
  if (!hit) fail(`索引中找不到 ${slug}`);
  const del = await req('/admin/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({ cid: String(hit.cid) }),
  });
  if (del.res.status !== 302) fail(`删除 ${slug} 期望 302，实际 ${del.res.status}`);
};
await removePage('about');
const about2 = await req('/about/');
if (about2.res.status !== 200) fail(`删除后 /about/ 期望 200，实际 ${about2.res.status}`);
const idxAfter = JSON.parse(store.get('idx:posts'));
const aboutCount = idxAfter.filter((e) => e.slug === 'about' && e.type === 'page').length;
if (aboutCount !== 1) fail(`/about/ 重建后期望 1 条索引，实际 ${aboutCount}`);
pass('删除后访问 /about/ 自动重建且不重复');

await removePage('guestbook');
const wall2 = await req('/guestbook/');
if (wall2.res.status !== 200 || !wall2.body.includes('joe_wall__board'))
  fail('删除后 /guestbook/ 未能自动重建便签墙');
pass('删除后访问 /guestbook/ 自动重建');

if (process.exitCode) fail('边缘安装检查未通过');
console.log('✅ 边缘安装检查通过');
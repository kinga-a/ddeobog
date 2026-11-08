/**
 * 在「只暴露 Web 标准 API」的沙箱里执行边缘函数，复现真实边缘运行时的初始化环境。
 *
 * 优先检查 CLI 产物 `.edgeone/edge-functions/index.js`；
 * 若不存在（常规 CI / 本地开发），则用 esbuild 把 `src/main.js` 打成 IIFE 再检查，
 * 这样 `npm test` 每次都能验证「没有误用 process / Buffer / require 等 Node 专有 API」。
 *
 * 用法：node tools/edge-runtime-check.mjs
 */
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';

const CLI_FILE = '.edgeone/edge-functions/index.js';

let code;
let label;
if (existsSync(CLI_FILE)) {
  code = readFileSync(CLI_FILE, 'utf8');
  label = CLI_FILE;
} else {
  // 与 build.mjs 使用同一入口，但输出为可注入沙箱的 IIFE
  const result = await build({
    entryPoints: ['src/main.js'],
    bundle: true,
    format: 'iife',
    globalName: 'EdgeApp',
    platform: 'neutral',
    write: false,
    logLevel: 'silent',
  });
  code = result.outputFiles[0].text;
  label = 'src/main.js (IIFE)';
}

// 边缘运行时提供的 API（见官方文档 Edge Functions / Runtime APIs）
const allow = [
  'fetch', 'Request', 'Response', 'Headers', 'URL', 'URLSearchParams',
  'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal',
  'crypto', 'atob', 'btoa', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'queueMicrotask', 'console', 'structuredClone',
  'ReadableStream', 'WritableStream', 'TransformStream', 'Blob', 'FormData',
  'Event', 'EventTarget', 'performance',
];

const sandbox = Object.create(null);
for (const k of allow) {
  if (k in globalThis) sandbox[k] = globalThis[k];
}
// CLI 产物会在模块顶层调用 addEventListener 注册 fetch 处理器
sandbox.addEventListener = (type, cb) => {
  sandbox.__fetchHandler = cb;
};
// 明确不提供：process / Buffer / require / setImmediate / global / window

const ctx = vm.createContext(sandbox, { name: 'edge-runtime' });

let initError = null;
try {
  vm.runInContext(code, ctx, { filename: label, timeout: 20000 });
} catch (e) {
  initError = e;
}

if (initError) {
  console.error(`❌ 脚本初始化抛错（${label}）：`);
  console.error(initError && initError.stack ? initError.stack : String(initError));
  process.exit(1);
}

const handler =
  sandbox.__fetchHandler ||
  (sandbox.EdgeApp && (sandbox.EdgeApp.onRequest || sandbox.EdgeApp.default));

if (typeof handler !== 'function') {
  console.error('❌ 初始化完成但未找到请求处理器（onRequest / addEventListener）');
  process.exit(1);
}

console.log(`✓ 初始化通过，已找到请求处理器（${label}）`);

// 用一个假的 KV 绑定跑一次真实请求
const store = new Map();
const kv = {
  async get(key, type) {
    if (!store.has(key)) return null;
    const value = store.get(key);
    if (type === 'json') return typeof value === 'string' ? JSON.parse(value) : value;
    if (type === 'arrayBuffer') return typeof value === 'string' ? new TextEncoder().encode(value).buffer : value;
    return value;
  },
  async put(key, value) {
    store.set(key, value);
  },
  async delete(key) {
    store.delete(key);
  },
  async list() {
    return { keys: [...store.keys()].map((key) => ({ key })), complete: true, cursor: '' };
  },
};

// CLI 产物把构建期 env 内联进了字面量，绑定只能走 globalThis 通道
// （shim 里 `const globalthis = hookCtx`，src/storage/kv.js 也有 globalThis 兜底）。
sandbox.BLOG_KV = kv;

let responded = null;
const event = {
  request: new Request('https://example.com/install', { method: 'GET' }),
  env: { BLOG_KV: kv },
  params: {},
  waitUntil: () => {},
  respondWith: (p) => {
    responded = p;
  },
};

(async () => {
  try {
    const returned = handler(event, { fetch: globalThis.fetch, env: { BLOG_KV: kv } });
    const res = await (returned && typeof returned.then === 'function' ? returned : responded);
    if (!res || res.status !== 200) {
      console.error(`❌ onRequest 返回 ${res && res.status}，期望 200`);
      if (res) console.error('  body:', (await res.text()).slice(0, 400).replace(/\n/g, ' '));
      process.exit(1);
    }
    console.log('✓ onRequest 返回 200（边缘运行时全链路可用）');
  } catch (e) {
    console.error('❌ 请求处理抛错：');
    console.error(e && e.stack ? e.stack : String(e));
    process.exit(1);
  }
})();
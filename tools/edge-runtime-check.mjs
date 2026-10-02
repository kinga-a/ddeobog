/**
 * 在「只暴露 Web 标准 API」的沙箱里执行 CLI 产出的边缘函数 iife，
 * 复现真实边缘运行时的初始化环境，定位模块初始化期抛错（即线上 545）。
 *
 * 线上现象：任何路径返回 545 "Error return from script"，
 * 而 src/main.js 的 catch 会返回 500 —— 说明异常发生在 onRequest 被调用之前，
 * 即脚本初始化阶段。
 *
 * 用法：node tools/edge-runtime-check.mjs
 */
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';

const FILE = '.edgeone/edge-functions/index.js';

// .edgeone/ 由 `edgeone pages build` 生成且已在 .gitignore 中，
// CI 与平台构建不会执行 CLI，因此这里缺失时跳过而不是失败。
if (!existsSync(FILE)) {
  console.log('- 跳过边缘运行时检查（缺少 .edgeone/，先运行 `edgeone pages build`）');
  process.exit(0);
}

const code = readFileSync(FILE, 'utf8');

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
// 边缘运行时会注入 addEventListener（CLI 产物在模块顶层调用它注册 fetch 处理器）
sandbox.addEventListener = (type, cb) => {
  sandbox.__fetchHandler = cb;
};
// 明确不提供：process / Buffer / require / setImmediate / global / window

const ctx = vm.createContext(sandbox, { name: 'edge-runtime' });

let initError = null;
try {
  vm.runInContext(code, ctx, { filename: FILE, timeout: 20000 });
} catch (e) {
  initError = e;
}

if (initError) {
  console.error('❌ 脚本初始化抛错：');
  console.error(initError && initError.stack ? initError.stack : String(initError));
  process.exit(1);
}

if (typeof sandbox.__fetchHandler !== 'function') {
  console.error('❌ 初始化完成但未注册 fetch 处理器');
  process.exit(1);
}

console.log('✓ 初始化通过，已注册 fetch 处理器');

// 用一个假的 KV 绑定跑一次真实请求
const store = new Map();
const kv = {
  async get(key) {
    return store.has(key) ? store.get(key) : null;
  },
  async put(key, value) {
    store.set(key, value);
  },
  async delete(key) {
    store.delete(key);
  },
  async list() {
    return { keys: [...store.keys()].map((k) => ({ key: k })), complete: true, cursor: '' };
  },
};

// CLI 产物把构建期 env 内联进了字面量，绑定只能走 globalThis 通道
// （shim 里 `const globalthis = hookCtx`，src/storage/kv.js 也有 globalThis 兜底）。
sandbox.BLOG_KV = kv;

let responded = null;
const event = {
  request: new Request('https://example.com/install', { method: 'GET' }),
  waitUntil: () => {},
  respondWith: (p) => {
    responded = p;
  },
};

(async () => {
  try {
    sandbox.__fetchHandler(event, { fetch: globalThis.fetch, env: {} });
    const res = await responded;
    if (res.status !== 200) {
      console.error(`❌ onRequest 返回 ${res.status}，期望 200`);
      console.error('  body:', (await res.text()).slice(0, 400).replace(/\n/g, ' '));
      process.exit(1);
    }
    console.log('✓ onRequest 返回 200（边缘运行时全链路可用）');
  } catch (e) {
    console.error('❌ 请求处理抛错：');
    console.error(e && e.stack ? e.stack : String(e));
    process.exit(1);
  }
})();

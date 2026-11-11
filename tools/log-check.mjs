import vm from 'node:vm';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/main.js'], bundle: true, format: 'iife', globalName: 'EdgeApp', platform: 'neutral', write: false, logLevel: 'silent' });
const code = result.outputFiles[0].text;

const logs = [];
const sandbox = Object.create(null);
const allow = ['fetch','Request','Response','Headers','URL','URLSearchParams','TextEncoder','TextDecoder','AbortController','AbortSignal','crypto','atob','btoa','structuredClone','ReadableStream','WritableStream','TransformStream','Blob','FormData','Event','EventTarget','performance','queueMicrotask','setTimeout','clearTimeout'];
for (const k of allow) if (k in globalThis) sandbox[k] = globalThis[k];
sandbox.console = {
  log: (...a) => logs.push({ level: 'info', text: String(a[0]) }),
  error: (...a) => logs.push({ level: 'error', text: String(a[0]) }),
};
const ctx = vm.createContext(sandbox, { name: 'log-check' });
vm.runInContext(code, ctx, { filename: 'src/main.js (edge IIFE)', timeout: 30000 });
const handler = sandbox.EdgeApp?.onRequest || sandbox.EdgeApp?.default;

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
    return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), complete: true, cursor: '' };
  },
};

async function call(env, path, init = {}) {
  const res = await handler({ request: new Request(`https://example.com${path}`, init), env, params: {}, waitUntil() {} });
  await res.text();
  return res;
}

const env = { BLOG_KV: kv, LOG_LEVEL: 'info' };
await call(env, '/install', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ name: 'admin', mail: 'admin@example.com', password: 'password123', password2: 'password123', title: '日志测试', description: 'x' }),
});
for (const p of ['/', '/archives/1/', '/search/hello/', '/nope/', '/admin/login']) await call(env, p);

const parsed = logs.filter((l) => l.level === 'info').map((l) => JSON.parse(l.text));
console.log('INFO_LOGS', parsed.length);
console.log('SAMPLE', JSON.stringify(parsed[parsed.length - 1]));
console.log('FIELDS_OK', parsed.every((x) => x.requestId && x.method && x.path && x.status && typeof x.ms === 'number' && x.ip && x.ua !== undefined));
console.log('SEARCH_REDACTED', parsed.some((x) => x.path === '/search/[kw]/'));
console.log('STATUS_CODES', [...new Set(parsed.map((x) => x.status))].sort());

const before = logs.length;
const envError = { BLOG_KV: kv, LOG_LEVEL: 'error' };
await call(envError, '/');
console.log('ERROR_LEVEL_SILENT_FOR_INFO', logs.length === before);
const before2 = logs.length;
const envOff = { BLOG_KV: kv, LOG_LEVEL: 'off' };
await call(envOff, '/');
console.log('OFF_SILENT', logs.length === before2);
console.log('ERROR_LOGS', logs.filter((l) => l.level === 'error').length);

const beforeErr = logs.length;
const noKv = { LOG_LEVEL: 'info' };
const errRes = await call(noKv, '/');
const errLogs = logs.slice(beforeErr).filter((l) => l.level === 'error');
const errObj = errLogs.length ? JSON.parse(errLogs[0].text) : null;
console.log('ERROR_STATUS', errRes.status);
console.log('ERROR_FIELDS_OK', !!errObj && !!errObj.requestId && errObj.status === 500 && typeof errObj.message === 'string');
console.log('ERROR_SAMPLE', JSON.stringify(errObj && { level: errObj.level, path: errObj.path, status: errObj.status, message: errObj.message.slice(0, 60) }));

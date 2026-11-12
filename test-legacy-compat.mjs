/**
 * 品牌重命名兼容回归：
 * - 旧配置键 theme:joe 仍能被读取（后台保存后写 theme:5iblog）
 * - 旧路由 /joe/api 仍可用，新路由 /5iblog/api 正常
 * - 旧备份格式 typecho-edge-backup / typecho-edge-backup-encrypted 仍可识别
 * 运行：node test-legacy-compat.mjs
 */
import assert from 'node:assert';
import { validateBackup, BACKUP_FORMAT } from './src/backup.js';
import { isEncryptedBackup } from './src/backup-crypto.js';

process.env.LOG_LEVEL ||= 'off';

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
const kv = globalThis.BLOG_KV;

const { default: onRequest } = await import('./src/main.js');
const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({
  city: '重庆', weather: '晴', temperature: 20, temp_max: 22, temp_min: 15,
  forecast: [{ date: '2026-11-12', week: '星期四', weather_day: '晴', temp_max: 22, temp_min: 15 }],
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

const call = async (method, path, form) => {
  const headers = {};
  let body;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(form).toString();
  }
  return onRequest({
    request: new Request(`https://blog.example.com${path}`, { method, headers, body, redirect: 'manual' }),
    env: {}, params: {}, waitUntil: () => {},
  });
};

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push(`✓ ${name}`); }
  catch (e) { results.push(`✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
};

const install = await call('POST', '/install', {
  title: 'T', description: 'd', name: 'admin', mail: 'admin@test.com',
  password: 'password123', password2: 'password123',
});
assert.equal(install.status, 302, '安装应成功');

// 模拟旧实例：只有 theme:joe，没有 theme:5iblog
kv.map.delete('opt:theme:5iblog');
kv.map.set('opt:theme:joe', JSON.stringify({
  JWeather_Status: 'on',
  JWeather_City: '重庆',
  JWeather_Days: '3',
}));

await test('旧配置键 theme:joe 仍能驱动页面与天气', async () => {
  const page = await (await call('GET', '/')).text();
  assert.ok(page.includes('id="blog-weather"'), '旧配置应能开启天气容器');
  assert.ok(page.includes('data-days="3"'), '旧配置的预报天数应生效');

  const oldApi = await (await call('GET', '/joe/api?routeType=weather')).json();
  assert.equal(oldApi.code, 1);
  assert.equal(oldApi.data.city, '重庆');
  assert.equal(oldApi.data.days.length, 1);
});

await test('新路由 /5iblog/api 与旧路由同时可用', async () => {
  const next = await (await call('GET', '/5iblog/api?routeType=weather')).json();
  assert.equal(next.code, 1);
  assert.equal(next.data.city, '重庆');
});

await test('旧备份格式仍可识别', async () => {
  assert.doesNotThrow(() => validateBackup({ format: 'typecho-edge-backup', version: 1, data: {} }));
  assert.equal(validateBackup({ format: BACKUP_FORMAT, version: 1, data: {} }), 1);
  assert.equal(isEncryptedBackup({ format: 'typecho-edge-backup-encrypted' }), true);
});

globalThis.fetch = realFetch;
console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('✓')).length} / ${results.length} 通过`);
/**
 * 日志转发回归：
 * - Edge Function 在 LOG_SINK_URL 配置后异步 POST 一行 JSON
 * - Cloud Function /log-ingest 校验 Token、限制大小、字段截断并 console.log
 * 运行：node test-log-sink.mjs
 */
import assert from 'node:assert';
import http from 'node:http';

process.env.LOG_LEVEL ||= 'info';
const TOKEN = 'test-sink-token';
process.env.LOG_SINK_TOKEN = TOKEN;

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

const received = [];
const sink = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    received.push({ url: req.url, auth: req.headers.authorization, contentType: req.headers['content-type'], body });
    res.writeHead(204);
    res.end();
  });
});
await new Promise((resolve) => sink.listen(5399, '127.0.0.1', resolve));

process.env.LOG_SINK_URL = 'http://127.0.0.1:5399/log-ingest';

const { default: onRequest } = await import('./src/main.js');
const { default: logIngest } = await import('./cloud-functions/log-ingest.js');

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push(`✓ ${name}`); }
  catch (e) { results.push(`✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
};

await test('Edge Function：安装请求日志异步转发到 sink', async () => {
  const pending = [];
  const res = await onRequest({
    request: new Request('https://blog.example.com/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        title: 'T', description: 'd', name: 'admin', mail: 'admin@test.com',
        password: 'password123', password2: 'password123',
      }).toString(),
      redirect: 'manual',
    }),
    env: {},
    params: {},
    waitUntil: (p) => pending.push(p),
  });
  assert.equal(res.status, 302);
  await Promise.allSettled(pending);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(received.length >= 1, 'sink 应收到至少一条日志');
  const hit = received[0];
  assert.equal(hit.auth, `Bearer ${TOKEN}`);
  assert.ok(String(hit.contentType).includes('application/json'));
  const record = JSON.parse(hit.body);
  assert.equal(record.method, 'POST');
  assert.equal(record.path, '/install');
  assert.equal(record.status, 302);
  assert.ok(record.requestId);
});

await test('Cloud Function：Token 校验 / 方法 / 大小限制', async () => {
  const make = (body, headers = {}, method = 'POST') => new Request('https://example.com/log-ingest', {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : body,
  });

  const wrong = await logIngest({ request: make('{}', { Authorization: 'Bearer wrong' }), env: { LOG_SINK_TOKEN: TOKEN } });
  assert.equal(wrong.status, 401);

  const get = await logIngest({ request: make('', { Authorization: `Bearer ${TOKEN}` }, 'GET'), env: { LOG_SINK_TOKEN: TOKEN } });
  assert.equal(get.status, 405);

  const tooLarge = await logIngest({
    request: make(JSON.stringify({ message: 'x'.repeat(17 * 1024) }), { Authorization: `Bearer ${TOKEN}` }),
    env: { LOG_SINK_TOKEN: TOKEN },
  });
  assert.equal(tooLarge.status, 413);

  const saved = process.env.LOG_SINK_TOKEN;
  delete process.env.LOG_SINK_TOKEN;
  const unconfigured = await logIngest({ request: make('{}'), env: {} });
  process.env.LOG_SINK_TOKEN = saved;
  assert.equal(unconfigured.status, 503);
});

await test('Cloud Function：接收后 console.log 单行 JSON 并截断字段', async () => {
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    const record = {
      ts: '2026-11-12T00:00:00.000Z',
      level: 'info',
      requestId: 'abcd1234',
      method: 'GET',
      path: '/archives/1/',
      status: 200,
      ms: 12,
      ip: '1a2b3c4d',
      ua: 'Mozilla/5.0',
      message: 'x'.repeat(1000),
      extra: 'should be dropped',
    };
    const res = await logIngest({
      request: new Request('https://example.com/log-ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify(record),
      }),
      env: { LOG_SINK_TOKEN: TOKEN },
    });
    assert.equal(res.status, 204);
    assert.equal(logs.length, 1);
    const line = JSON.parse(logs[0]);
    assert.equal(line.sink, 'edge');
    assert.equal(line.requestId, 'abcd1234');
    assert.equal(line.path, '/archives/1/');
    assert.equal(line.message.length, 300);
    assert.equal('extra' in line, false, '未知字段应被丢弃');
  } finally {
    console.log = original;
  }
});

sink.close();
console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('✓')).length} / ${results.length} 通过`);
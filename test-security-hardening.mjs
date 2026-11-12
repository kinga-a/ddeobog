/**
 * 安全加固回归：评论蜜罐 / 频率限制 / 内容去重 / 安全响应头 / 后台 IP 白名单 / 事件记录
 * 运行：node test-security-hardening.mjs
 */
import assert from 'node:assert';

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

const { default: onRequest } = await import('./src/main.js');
let cookie = '';

async function call(method, path, { form, headers: extra } = {}) {
  const headers = { ...(extra || {}) };
  if (cookie) headers.Cookie = cookie;
  let body;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(form).toString();
  }
  const res = await onRequest({
    request: new Request(`https://blog.example.com${path}`, { method, headers, body, redirect: 'manual' }),
    env: {}, params: {}, waitUntil: () => {},
  });
  const sc = res.headers.get('Set-Cookie');
  if (sc && sc.split(';')[0] !== cookie) cookie = sc.split(';')[0];
  return res;
}

const commentCount = () => [...globalThis.BLOG_KV.map.keys()].filter((k) => k.startsWith('cmt:')).length;
const clearRateKeys = () => {
  for (const key of [...globalThis.BLOG_KV.map.keys()]) {
    if (key.startsWith('cmt_rate:') || key.startsWith('cmt_dup:')) globalThis.BLOG_KV.map.delete(key);
  }
};
const postComment = (mail, text, extra = {}) =>
  call('POST', '/comment/1', {
    headers: { 'User-Agent': 'HardeningTest/1.0', ...(extra.headers || {}) },
    form: { author: '测试', mail, text, parent: 0, ...(extra.form || {}) },
  });

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push(`✓ ${name}`); }
  catch (e) { results.push(`✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
};

// ---- 安装 ----
const install = await call('POST', '/install', {
  form: { title: 'T', description: 'd', name: 'admin', mail: 'admin@test.com', password: 'password123', password2: 'password123' },
});
assert.equal(install.status, 302, '安装应成功');

await test('安全响应头：HTML 含 4 个基础头 + CSP Report-Only', async () => {
  const res = await call('GET', '/');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(res.headers.get('X-Frame-Options'), 'SAMEORIGIN');
  assert.equal(res.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.ok((res.headers.get('Permissions-Policy') || '').includes('camera=()'));
  assert.ok((res.headers.get('Content-Security-Policy-Report-Only') || '').includes("default-src 'self'"));
});

await test('安全响应头：JSON 不带 CSP / X-Frame-Options', async () => {
  const res = await call('GET', '/action/hello');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(res.headers.get('Content-Security-Policy-Report-Only'), null);
  assert.equal(res.headers.get('X-Frame-Options'), null);
});

await test('蜜罐：填写 hp_site 不写库且返回静默提示', async () => {
  const before = commentCount();
  const res = await postComment('bot@test.com', '蜜罐内容', { form: { hp_site: 'http://spam.example.com' } });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.ok(!html.includes('id="Blog"'), '蜜罐命中不应返回 Blog 成功标记');
  assert.ok(html.includes('审核通过后显示'), '应返回与待审一致的静默提示');
  assert.equal(commentCount(), before, '蜜罐命中不应写入评论');
  const events = JSON.parse(globalThis.BLOG_KV.map.get('sec:events'));
  assert.equal(events[0].type, 'honeypot');
});

await test('正常评论成功，重复内容不重复写库', async () => {
  clearRateKeys();
  const before = commentCount();
  const first = await postComment('dup@test.com', '重复内容测试');
  assert.ok((await first.text()).includes('id="Blog"'), '首次评论应成功');
  const afterFirst = commentCount();
  assert.equal(afterFirst, before + 1);

  const second = await postComment('dup@test.com', '重复内容测试');
  const html = await second.text();
  assert.ok(!html.includes('id="Blog"'), '重复内容不应返回成功标记');
  assert.ok(html.includes('审核通过后显示'), '重复内容应静默提示');
  assert.equal(commentCount(), afterFirst, '重复内容不应写库');
  const events = JSON.parse(globalThis.BLOG_KV.map.get('sec:events'));
  assert.ok(events.some((e) => e.type === 'duplicate'));
});

await test('频率限制：第 6 条静默拒绝，前 5 条正常', async () => {
  clearRateKeys();
  const before = commentCount();
  for (let i = 1; i <= 5; i += 1) {
    const res = await postComment('rate@test.com', `限流测试 ${i}`);
    assert.ok((await res.text()).includes('id="Blog"'), `第 ${i} 条应成功`);
  }
  const sixth = await postComment('rate@test.com', '限流测试 6');
  const html = await sixth.text();
  assert.equal(sixth.status, 200, '前端兼容策略：限流也返回 200 静默提示');
  assert.ok(!html.includes('id="Blog"'), '第 6 条不应返回成功标记');
  assert.ok(html.includes('审核通过后显示'), '第 6 条应返回静默提示');
  assert.equal(commentCount(), before + 5, '第 6 条不应写库');
  const events = JSON.parse(globalThis.BLOG_KV.map.get('sec:events'));
  assert.ok(events.some((e) => e.type === 'rate'));
});

await test('管理员豁免频率限制', async () => {
  cookie = '';
  const login = await call('POST', '/admin/login', {
    form: { name: 'admin', password: 'password123', step: 'password' },
  });
  assert.equal(login.status, 302, '管理员登录应成功');
  clearRateKeys();
  for (let i = 1; i <= 6; i += 1) {
    const res = await postComment('admin@test.com', `管理员评论 ${i}`);
    assert.ok((await res.text()).includes('id="Blog"'), `管理员第 ${i} 条应成功`);
  }
});

await test('后台 IP 白名单：默认关闭，配置后非白名单 403', async () => {
  const baseline = await call('GET', '/admin');
  assert.equal(baseline.status, 200, '默认应允许访问后台');

  process.env.ADMIN_ALLOW_IPS = '10.0.0.1,192.168.1.*';
  try {
    const denied = await call('GET', '/admin', { headers: { 'X-Real-IP': '1.2.3.4' } });
    assert.equal(denied.status, 403, '非白名单应 403');

    const allowed = await call('GET', '/admin', { headers: { 'X-Real-IP': '10.0.0.1' } });
    assert.equal(allowed.status, 200, '精确白名单应放行');

    const wildcard = await call('GET', '/admin', { headers: { 'X-Real-IP': '192.168.1.9' } });
    assert.equal(wildcard.status, 200, '通配白名单应放行');

    const mcpDenied = await call('GET', '/mcp', { headers: { 'X-Real-IP': '1.2.3.4' } });
    assert.equal(mcpDenied.status, 403, '/mcp 同样受白名单保护');
  } finally {
    delete process.env.ADMIN_ALLOW_IPS;
  }
});

await test('后台安全页展示拦截事件并可清空', async () => {
  const page = await call('GET', '/admin/security');
  const html = await page.text();
  assert.ok(html.includes('评论防护'), '安全页应有评论防护卡片');
  assert.ok(html.includes('蜜罐命中') || html.includes('频率超限'), '应展示拦截事件');
  assert.ok(html.includes('clear-security-events'), '应有清空操作');

  const clear = await call('POST', '/admin/security', { form: { op: 'clear-security-events' } });
  assert.equal(clear.status, 302);
  const after = await (await call('GET', '/admin/security')).text();
  assert.ok(!after.includes('蜜罐命中'), '清空后不应再显示事件');
  assert.equal(globalThis.BLOG_KV.map.has('sec:events'), false);
});

console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('✓')).length} / ${results.length} 通过`);
/**
 * 安全/健壮性探测：找 test.mjs 未覆盖的边界。
 * 运行：node test-security.mjs
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

const { default: onRequest } = await import('./src/main.js');
let cookie = '';
async function call(method, path, { form, headers: extra, raw } = {}) {
  const headers = { ...(extra || {}) };
  if (cookie) headers['Cookie'] = cookie;
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
const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push(`✓ ${name}`); }
  catch (e) { results.push(`✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
};

// ---- 安装 ----
await call('POST', '/install', { form: {
  title: 'T', description: 'd', name: 'admin', mail: 'a@b.c',
  password: 'password123', password2: 'password123' } });

await test('[安全] 安装完成后 /install 不可再次 POST（否则可任意创建管理员）', async () => {
  const before = [...globalThis.BLOG_KV.map.keys()].filter((k) => k.startsWith('user:')).length;
  const res = await call('POST', '/install', { form: {
    title: 'X', description: 'x', name: 'hacker', mail: 'h@h.c',
    password: 'password123', password2: 'password123' } });
  const after = [...globalThis.BLOG_KV.map.keys()].filter((k) => k.startsWith('user:')).length;
  console.log(`    → 二次安装 POST 返回 ${res.status}，用户数 ${before} → ${after}`);
  assert.equal(after, before, '二次安装竟然创建了新用户！');
  assert.equal(res.status, 403, `已安装时应返回 403，实际 ${res.status}`);
});

await test('[安全] 安装完成后 GET /install 应不可访问', async () => {
  const res = await call('GET', '/install');
  const html = await res.text();
  console.log(`    → GET /install 返回 ${res.status}，含安装表单: ${html.includes('name="password"')}`);
  assert.equal(res.status, 403, `已安装时应返回 403，实际 ${res.status}`);
  assert.ok(!html.includes('name="password"'), '已安装后仍暴露安装表单');
});

await test('[安全] 修复后未安装状态仍可正常安装（防误锁）', async () => {
  // 用全新 KV 模拟未安装站点，确保修复没有把正常安装流程一起挡掉
  const saved = globalThis.BLOG_KV;
  globalThis.BLOG_KV = new MockKV();
  const fresh = await onRequest({
    request: new Request('https://blog.example.com/install'), env: {}, params: {}, waitUntil: () => {},
  });
  const freshHtml = await fresh.text();
  assert.equal(fresh.status, 200, '未安装时 /install 应可访问');
  assert.ok(freshHtml.includes('name="password"'), '未安装时应显示安装表单');

  const done = await onRequest({
    request: new Request('https://blog.example.com/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ title: 'T', description: 'd', name: 'admin', mail: 'a@b.c',
        password: 'password123', password2: 'password123' }).toString(),
      redirect: 'manual',
    }), env: {}, params: {}, waitUntil: () => {},
  });
  assert.equal(done.status, 302, '未安装时正常安装应成功');
  globalThis.BLOG_KV = saved;
  console.log('    → 未安装站点安装流程正常');
});

await test('[安全] 后台 POST 拒绝跨域 Origin（CSRF）', async () => {
  await call('POST', '/admin/login', { form: { name: 'admin', password: 'password123', step: 'password' } });
  const res = await call('POST', '/admin/post', {
    headers: { Origin: 'https://evil.example.com' },
    form: { type: 'post', title: 'CSRF', text: 'x', status: 'publish' },
  });
  console.log(`    → 跨域 POST 返回 ${res.status}`);
  assert.equal(res.status, 403, '跨域 POST 未被拒绝');
});

await test('[安全] 评论提交拒绝跨域 Origin', async () => {
  const res = await call('POST', '/comment/1', {
    headers: { Origin: 'https://evil.example.com' },
    form: { author: 'E', mail: 'e@e.c', text: 'spam', parent: 0 },
  });
  const cmt = globalThis.BLOG_KV.map.has('cmt:2');
  console.log(`    → 返回 ${res.status}，评论写入: ${cmt}`);
  assert.equal(cmt, false, '跨域评论被写入');
});

await test('[健壮] 未绑定 KV 时返回可读 500', async () => {
  const saved = globalThis.BLOG_KV;
  delete globalThis.BLOG_KV;
  const res = await onRequest({
    request: new Request('https://blog.example.com/'), env: {}, params: {}, waitUntil: () => {},
  });
  globalThis.BLOG_KV = saved;
  console.log(`    → 无 KV 返回 ${res.status}`);
  assert.equal(res.status, 500);
});

await test('[健壮] Cookie 篡改/伪造 token 不可越权', async () => {
  const saved = cookie;
  cookie = 'te_sess=' + 'a'.repeat(64);
  const res = await call('GET', '/admin');
  cookie = saved;
  console.log(`    → 伪造 token 访问 /admin 返回 ${res.status}`);
  assert.equal(res.status, 302, '伪造 session 应被拒');
});

await test('[健壮] 空/超长路径不 500', async () => {
  for (const p of ['/a'.repeat(500), '/archives/99999/', '/tag/%00/', '/../../etc/passwd']) {
    const res = await call('GET', p);
    assert.ok(res.status < 500, `${p.slice(0, 30)} 返回 ${res.status}`);
  }
});

await test('[安全] 文章标题 XSS 转义（判定标准：原始 payload 不得出现）', async () => {
  const PAYLOAD = '"><img src=x onerror=alert(1)>';
  await call('POST', '/admin/post', {
    form: { type: 'post', title: PAYLOAD, text: 'body', status: 'publish' },
  });
  for (const p of ['/', '/archives/2/']) {
    const html = await (await call('GET', p)).text();
    assert.equal(html.includes(PAYLOAD), false, `${p} 出现未转义 payload`);
  }
  console.log('    → 标题在首页/文章页均已转义');
});

await test('[安全] 评论内容 XSS 转义', async () => {
  const PAYLOAD = '<img src=x onerror=alert(1)>';
  await call('POST', '/comment/1', { form: { author: PAYLOAD, mail: 'a@b.c', text: PAYLOAD, parent: 0 } });
  const html = await (await call('GET', '/archives/1/')).text();
  assert.equal(html.includes(PAYLOAD), false, '评论区出现未转义 payload');
  console.log('    → 评论作者名与正文均已转义');
});

await test('[安全] 登录失败限流：连续错误后锁定', async () => {
  // 先退出登录态
  const saved = cookie;
  cookie = '';
  await call('POST', '/admin/login', { form: { name: 'admin', password: 'password123', step: 'password' } });
  cookie = saved;

  // 退出并连续爆破
  cookie = '';
  const errs = [];
  for (let i = 0; i < 7; i++) {
    const r = await call('POST', '/admin/login', { form: { name: 'admin', password: 'wrongpass', step: 'password' } });
    const t = await r.text();
    errs.push(t.includes('尝试次数过多') ? 'LOCKED' : 'fail');
  }
  console.log(`    → 7 次错误尝试: ${errs.join(',')}`);
  assert.ok(errs.includes('LOCKED'), '连续爆破未触发锁定');

  // 锁定后即使密码正确也应被拒
  const ok = await call('POST', '/admin/login', { form: { name: 'admin', password: 'password123', step: 'password' } });
  const okText = await ok.text();
  console.log(`    → 锁定后用正确密码: ${okText.includes('尝试次数过多') ? '已拒绝 ✓' : '未被拒绝'}`);
  assert.ok(okText.includes('尝试次数过多'), '锁定状态下正确密码仍可登录！');
});

console.log('\n========== 安全/健壮性探测 ==========');
results.forEach((r) => console.log(r));
console.log(`\n共 ${results.length} 项，失败 ${results.filter((r) => r.startsWith('✗')).length} 项`);
/**
 * MCP 协议回归：真实走 HTTP /mcp，而不是只检查后台卡片
 * 运行：node test-mcp.mjs
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
const TOKEN = 'mcp_' + 'a1b2c3d4'.repeat(6);
let cookie = '';

async function call(method, path, { form } = {}) {
  const headers = {};
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

async function mcp(message, token = TOKEN) {
  return onRequest({
    request: new Request('https://blog.example.com/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(message),
    }),
    env: {}, params: {}, waitUntil: () => {},
  });
}

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push(`✓ ${name}`); }
  catch (e) { results.push(`✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
};

const install = await call('POST', '/install', {
  form: { title: 'T', description: 'd', name: 'admin', mail: 'admin@test.com', password: 'password123', password2: 'password123' },
});
assert.equal(install.status, 302);
const login = await call('POST', '/admin/login', { form: { name: 'admin', password: 'password123', step: 'password' } });
assert.equal(login.status, 302);

const add = await call('POST', '/admin/security', {
  form: { op: 'mcp-add', name: '协议测试', remark: '', enabled: 'on', token: TOKEN },
});
assert.equal(add.status, 302);

await test('未授权 MCP 请求返回 401', async () => {
  const res = await mcp({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'mcp_wrong');
  assert.equal(res.status, 401);
});

await test('initialize / tools/list 正常', async () => {
  const init = await mcp({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  });
  const initBody = await init.json();
  assert.equal(init.status, 200);
  assert.equal(initBody.result.serverInfo.name, '5iblog-mcp');

  const list = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const listBody = await list.json();
  const names = listBody.result.tools.map((t) => t.name);
  for (const name of ['list_posts', 'get_post', 'create_post', 'update_post', 'delete_post', 'list_comments', 'list_media']) {
    assert.ok(names.includes(name), `缺少工具 ${name}`);
  }
});

await test('list_posts / create_post / get_post / delete_post 正常', async () => {
  const list = await (await mcp({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'list_posts', arguments: { pageSize: 5 } },
  })).json();
  const listed = JSON.parse(list.result.content[0].text);
  assert.ok(Array.isArray(listed.items) && listed.items.length >= 1);

  const created = await (await mcp({
    jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: { name: 'create_post', arguments: { title: 'MCP 测试文章', text: 'MCP 正文', status: 'publish' } },
  })).json();
  const post = JSON.parse(created.result.content[0].text);
  const cid = post.cid || post.row?.cid || post.data?.cid;
  assert.ok(cid, `create_post 未返回 cid：${created.result.content[0].text}`);

  const got = await (await mcp({
    jsonrpc: '2.0', id: 5, method: 'tools/call',
    params: { name: 'get_post', arguments: { cid } },
  })).json();
  assert.ok(got.result.content[0].text.includes('MCP 测试文章'));

  const deleted = await (await mcp({
    jsonrpc: '2.0', id: 6, method: 'tools/call',
    params: { name: 'delete_post', arguments: { cid } },
  })).json();
  assert.ok(deleted.result, 'delete_post 应返回结果');
});

console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('✓')).length} / ${results.length} 通过`);
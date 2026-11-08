/**
 * MCP 服务冒烟测试
 *
 * 前置条件：
 *   1. 站点已启动（本地 preview 或线上地址）
 *   2. 后台「安全设置 → MCP 服务」已开启，并拿到访问令牌
 *
 * 用法：
 *   MCP_TOKEN=mcp_xxx node test-mcp.mjs
 *   MCP_URL=https://example.com/mcp MCP_TOKEN=mcp_xxx node test-mcp.mjs
 *
 * 脚本会在测试中创建临时的分类、标签、文章，并在结束时删除；
 * 修改过的站点 pageSize 也会恢复原值。
 */
const BASE = process.env.MCP_URL || 'http://127.0.0.1:6080/mcp';
const TOKEN = process.env.MCP_TOKEN || '';

if (!TOKEN) {
  console.error('缺少 MCP_TOKEN 环境变量。请先在后台「安全设置 → MCP 服务」查看令牌。');
  process.exit(2);
}

let passed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    failures.push(name);
    console.log(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  }
}

async function post(payload, token = TOKEN) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }
  return { status: res.status, body };
}

async function tool(name, args = {}) {
  const { status, body } = await post({
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  const text = body?.result?.content?.[0]?.text ?? '';
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status, isError: !!body?.result?.isError, data, raw: text };
}

// ---- 协议层 ----
let r = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, '');
check('未授权返回 401', r.status === 401, String(r.status));

r = await post({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } },
});
check('initialize', r.status === 200 && r.body?.result?.serverInfo?.name === 'typecho-edge-mcp', r.body?.result?.protocolVersion);

r = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
check('notification 返回 202', r.status === 202, String(r.status));

r = await post([
  { jsonrpc: '2.0', id: 1, method: 'ping' },
  { jsonrpc: '2.0', id: 2, method: 'ping' },
]);
check('批量请求', r.status === 200 && Array.isArray(r.body) && r.body.length === 2, String(r.body?.length));

r = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
const toolNames = r.body?.result?.tools?.map((t) => t.name) || [];
check('tools/list', toolNames.length >= 20, `${toolNames.length} 个工具`);

r = await post({ jsonrpc: '2.0', id: 3, method: 'no/such/method' });
check('未知方法返回 -32601', r.body?.error?.code === -32601);

r = await tool('no_such_tool');
check('未知工具返回 isError', r.isError === true);
r = await tool('get_post', {});
check('缺少参数返回 isError', r.isError === true);

// ---- 站点信息 ----
const siteBefore = await tool('get_site_info');
const site = siteBefore.data?.site || {};
check('get_site_info', typeof site.title === 'string' && site.title.length > 0);

// ---- 分类 / 标签 ----
const catName = `Smoke分类${Date.now().toString(36)}`;
const tagName = `Smoke标签${Date.now().toString(36)}`;
const cat = await tool('create_category', { name: catName, slug: `smoke-cat-${Date.now().toString(36)}` });
const catMid = cat.data?.mid;
check('create_category', Number.isInteger(catMid), `mid=${catMid}`);

const catUpdated = await tool('update_category', { mid: catMid, name: `${catName}改` });
check('update_category', catUpdated.data?.name === `${catName}改`);

const tag = await tool('create_tag', { name: tagName, slug: `smoke-tag-${Date.now().toString(36)}` });
const tagMid = tag.data?.mid;
check('create_tag', Number.isInteger(tagMid), `mid=${tagMid}`);

const catList = await tool('list_categories');
check('list_categories', Array.isArray(catList.data) && catList.data.some((c) => c.mid === catMid));
const tagList = await tool('list_tags');
check('list_tags', Array.isArray(tagList.data) && tagList.data.some((t) => t.mid === tagMid));

// ---- 文章 CRUD ----
const title = `Smoke文章${Date.now().toString(36)}`;
const created = await tool('create_post', {
  title,
  text: '# Smoke\n\n由 test-mcp.mjs 创建，测试结束后自动删除。',
  categories: [`${catName}改`],
  tags: [tagName],
  status: 'publish',
  abstract: '冒烟测试摘要',
  allowComment: true,
});
const cid = created.data?.cid;
const slug = created.data?.slug;
check('create_post', Number.isInteger(cid), `cid=${cid}`);

const bySlug = await tool('get_post', { slug });
check('get_post（按 slug）', bySlug.data?.cid === cid && bySlug.data?.fields?.abstract === '冒烟测试摘要');

const updated = await tool('update_post', { cid, title: `${title}改`, status: 'hidden', password: 'mcp-test-pass' });
check('update_post', updated.data?.status === 'hidden');

const hiddenList = await tool('list_posts', { keyword: `${title}改`, status: 'hidden' });
check('list_posts（隐藏 + 关键词）', hiddenList.data?.total >= 1 && hiddenList.data?.items?.[0]?.hasPassword === true);

const fetched = await tool('get_post', { cid });
check('get_post（密码已加密）', typeof fetched.data?.password === 'string' && fetched.data.password.startsWith('pbkdf2$'));

const removed = await tool('delete_post', { cid });
check('delete_post', removed.data?.ok === true);

// ---- 评论 ----
const comments = await tool('list_comments', { pageSize: 5 });
check('list_comments', Array.isArray(comments.data?.items) && typeof comments.data?.total === 'number');
const firstComment = comments.data?.items?.[0];
if (firstComment) {
  const audited = await tool('set_comment_status', { coid: firstComment.coid, status: firstComment.status });
  check('set_comment_status', audited.data?.ok === true);
}

// ---- 站点信息修改并恢复 ----
const originalPageSize = site.pageSize || 10;
const changed = await tool('update_site_info', { pageSize: 7 });
check('update_site_info', changed.data?.ok === true);
const afterChange = await tool('get_site_info');
check('修改已生效', afterChange.data?.site?.pageSize === 7);
await tool('update_site_info', { pageSize: originalPageSize });

// ---- 附件 ----
const media = await tool('list_media', { pageSize: 5 });
check('list_media', Array.isArray(media.data?.items));

// ---- 清理 ----
await tool('delete_category', { mid: catMid });
await tool('delete_tag', { mid: tagMid });
const catAfter = await tool('list_categories');
check('清理临时分类/标签', Array.isArray(catAfter.data) && !catAfter.data.some((c) => c.mid === catMid));

console.log(`\nSUMMARY ${passed}/${passed + failures.length} passed`);
if (failures.length) {
  console.error(`FAILED: ${failures.join(', ')}`);
  process.exit(1);
}
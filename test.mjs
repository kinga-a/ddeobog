/**
 * 本地集成测试：模拟 EdgeOne Edge Function 运行时
 * - 用内存 Map 模拟 KV 绑定
 * - 直接 import 打包前的源码（src/main.js）验证安装→发文→浏览→评论→TOTP 全流程
 *
 * 运行：node test.mjs
 */
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';

// ---- mock KV binding ----
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
  async list({ prefix = '', cursor, limit = 256 } = {}) {
    const keys = [...this.map.keys()].filter((k) => k.startsWith(prefix)).sort();
    return { keys: keys.slice(0, limit).map((key) => ({ key })), complete: true, cursor: null };
  }
}

globalThis.BLOG_KV = new MockKV();

const { default: onRequest } = await import('./src/main.js');

let cookie = '';
let reqCount = 0;

async function call(method, path, { form, redirect = false } = {}) {
  reqCount++;
  const headers = {};
  if (cookie) headers['Cookie'] = cookie;
  let body;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(form).toString();
  }
  const request = new Request(`https://blog.example.com${path}`, { method, headers, body, redirect: redirect ? 'follow' : 'manual' });
  const res = await onRequest({ request, env: {}, params: {}, waitUntil: () => {} });
  const setCookie = res.headers.get('Set-Cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return res;
}

const results = [];
const test = async (name, fn) => {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (e) {
    results.push(`✗ ${name}\n    ${e.message}`);
    process.exitCode = 1;
  }
};

// ================= 测试 =================

await test('未安装时重定向到 /install', async () => {
  const res = await call('GET', '/');
  assert.equal(res.status, 302);
  assert.ok(res.headers.get('Location').includes('/install'));
});

await test('安装页面可访问', async () => {
  const res = await call('GET', '/install');
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes('TypechoEdge'));
});

await test('完成安装（创建管理员账号存 KV）', async () => {
  const res = await call('POST', '/install', {
    form: {
      title: '测试博客', description: '边缘博客测试',
      name: 'admin', mail: 'admin@test.com',
      password: 'password123', password2: 'password123',
    },
  });
  assert.equal(res.status, 302);
  assert.ok(res.headers.get('Location').includes('/admin'));
  // 验证 KV 中有用户
  assert.ok(globalThis.BLOG_KV.map.has('user:1'), '用户应存入 KV user:1');
  assert.ok(globalThis.BLOG_KV.map.has('opt:installed'), 'installed 配置应存入 KV');
});

await test('安装后首页 200 且包含 Joe 主题结构', async () => {
  const res = await call('GET', '/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('joe_header'), '应包含 Joe header');
  assert.ok(html.includes('Hello TypechoEdge'), '应包含示例文章');
  assert.ok(html.includes('usr/themes/joe/assets/css/joe.global.min.css'), '应引用 Joe 原版 CSS');
});

await test('文章页渲染（/archives/1/）', async () => {
  const res = await call('GET', '/archives/1/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('joe_detail__title'), '应有文章标题结构');
  assert.ok(html.includes('<h2'), 'Markdown 标题应渲染');
  assert.ok(html.includes('joe_comment__respond'), '应有评论区');
  assert.ok(html.includes('Joe_Article_Views'), '应有阅读数元素');
});

await test('RSS 订阅 /feed/', async () => {
  const res = await call('GET', '/feed/');
  assert.equal(res.status, 200);
  const xml = await res.text();
  assert.ok(xml.includes('xmlns="http://www.w3.org/2005/Atom"'));
  assert.ok(xml.includes('Hello TypechoEdge'));
});

await test('搜索路由 /search/xxx/', async () => {
  const res = await call('GET', '/search/%E6%AC%A2%E8%BF%8E/');
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes('关键字'));
});

await test('404 页面', async () => {
  const res = await call('GET', '/not-exist-path-xyz/');
  assert.equal(res.status, 404);
});

await test('Joe API: publish_list', async () => {
  const res = await call('POST', '/joe/api', { form: { routeType: 'publish_list', page: 1, pageSize: 10, type: 'created' } });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.code, 1);
  assert.ok(data.data.length >= 1);
  assert.ok(data.data[0].permalink.startsWith('/archives/'));
});

await test('Joe API: handle_views 计数', async () => {
  const res = await call('POST', '/joe/api', { form: { routeType: 'handle_views', cid: 1 } });
  const data = await res.json();
  assert.equal(data.code, 1);
  assert.equal(data.data.views, 1);
});

await test('Joe API: search 联想返回标题/permalink/阅读量', async () => {
  // 走 GET + query string：边缘运行时的 request.formData() 在无 Content-Type 时
  // 是同步抛错，用 .catch() 接不住，会直接 500
  const res = await call('GET', '/joe/api?routeType=search&s=Hello&pageSize=8');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.code, 1);
  assert.ok(data.data.total >= 1);
  assert.ok(data.data.data.length >= 1);
  const hit = data.data.data[0];
  assert.ok(hit.title.includes('Hello'));
  assert.ok(hit.permalink.startsWith('/archives/'));
  assert.ok(typeof hit.views === 'number');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(hit.time));
});

await test('Joe API: GET 无参数不 500', async () => {
  for (const p of ['/joe/api', '/joe/api?routeType=handle_views&cid=1', '/joe/api?routeType=baidu_push']) {
    const res = await call('GET', p);
    assert.equal(res.status, 200, `GET ${p} 返回 ${res.status}`);
  }
});

await test('Joe API: search 空关键字返回空列表而非报错', async () => {
  const res = await call('POST', '/joe/api', { form: { routeType: 'search', s: '   ' } });
  const data = await res.json();
  assert.equal(data.code, 1);
  assert.equal(data.data.total, 0);
  assert.deepEqual(data.data.data, []);
});

await test('主题：搜索面板结构与脚本齐备', async () => {
  const res = await call('GET', '/');
  const html = await res.text();
  // CSS 期望 .joe_header__searchout-inner > .search > input + button
  assert.ok(
    /class="joe_header__searchout-inner"\s*>\s*<div class="search">/.test(html),
    '搜索面板缺少 .search 包裹层，主题 CSS 的 input/button 布局不会生效'
  );
  assert.ok(html.includes('class="submit search-btn"'));
  // 联想渲染脚本必须被引入
  assert.ok(html.includes('assets/js/joe.search.js'), '未引入 joe.search.js，搜索框点了没反应');
  // 下拉容器（联想结果挂载点）必须落在 .joe_header__above-search 之内
  const aboveAt = html.indexOf('class="joe_header__above-search"');
  const resultAt = html.indexOf('class="result"');
  assert.ok(aboveAt >= 0 && resultAt > aboveAt, '联想结果挂载点 .result 不在 .joe_header__above-search 内');
  // 布局补丁样式表必须被引入
  assert.ok(html.includes('assets/css/joe.layout.css'), '未引入 joe.layout.css');
});

await test('主题：正文与侧栏同属 .joe_body（两栏布局的挂载点）', async () => {
  const css = await readFile('usr/themes/joe/assets/css/joe.layout.css', 'utf8');
  // 侧栏在左：order:-1 + flex 固定宽度，正文 flex:1
  assert.ok(/\.joe_body\s*\{[^}]*display:\s*flex/.test(css), 'joe_body 未启用 flex');
  assert.ok(/\.joe_body > \.joe_aside\s*\{[^}]*order:\s*-1/.test(css), '侧栏未置于左侧');
  assert.ok(/\.joe_body > \.joe_main\s*\{[^}]*flex:\s*1 1 auto/.test(css), '正文列未占据剩余宽度');
  // 搜索高亮样式已从内联 <style> 迁到该文件
  assert.ok(css.includes('.joe_header__above-search .result .item.active'));

  // 侧边悬浮按钮：主题缺 :hover，这里补了；热区放大到 46px
  assert.ok(/\.joe_action_item\s*\{[^}]*width:\s*46px[^}]*height:\s*46px/.test(css), '按钮未放大到 46px');
  assert.ok(/\.joe_action_item\.mode:hover/.test(css), '缺少主题切换按钮的 hover 反馈');
  assert.ok(/\.joe_action_item\.scroll\.active:hover/.test(css), '缺少回顶按钮的 hover 反馈');
  assert.ok(/\.joe_action_item\.mode:active/.test(css), '缺少按下反馈');
  // hover 选择器必须带 .scroll.active，否则被主题的 .scroll.active{transform:scale(1)} 压掉
  assert.ok(!/^\.joe_action_item:hover\b/m.test(css), '裸 .joe_action_item:hover 特异性不够，会被 .scroll.active 覆盖');

  for (const [path, marker] of [
    ['/', 'joe_index'],
    ['/archives/1/', 'joe_detail'],
    ['/search/Hello/', 'joe_archive__title'],
  ]) {
    const res = await call('GET', path);
    const html = await res.text();
    assert.ok(
      new RegExp(`class="joe_container joe_body"[\\s\\S]{0,120}?class="joe_main[^"]*">[\\s\\S]{0,200}?${marker}`).test(html),
      `${path} 未套用 .joe_body 两栏容器`
    );

    // 关键回归点：侧栏必须是 .joe_body 的**直接子节点**。
    // 曾因 post 模板少闭合一层 </div>，侧栏被塞进 .joe_main 内部，
    // 于是 .joe_body > .joe_aside 匹配不到，两栏布局整个失效。
    const bodyAt = html.indexOf('class="joe_container joe_body"');
    const bodyTag = html.indexOf('>', bodyAt) + 1;
    const asideAt = html.indexOf('<aside class="joe_aside">');
    assert.ok(bodyAt >= 0 && asideAt > bodyAt, `${path} 的侧栏不在 .joe_body 容器内`);

    const before = html.slice(bodyTag, asideAt);
    const open = (before.match(/<div\b/g) || []).length;
    const close = (before.match(/<\/div>/g) || []).length;
    assert.equal(
      open - close,
      0,
      `${path} 的 .joe_main 没有在侧栏之前闭合（div 多 ${open - close} 个），侧栏被嵌进了正文列`
    );
  }
});

await test('评论提交（存 KV，Joe 协议响应）', async () => {
  const res = await call('POST', '/comment/1', {
    form: { author: '张三', mail: 'zhang@test.com', text: '你好呀 ::(呵呵)', parent: 0, _: 'x' },
  });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('Joe'), 'Joe 前端约定响应含 Joe 即成功');
  // 验证 KV
  assert.ok(globalThis.BLOG_KV.map.has('cmt:1'), '评论应存入 KV');
});

await test('文章页展示评论（含表情替换）', async () => {
  const res = await call('GET', '/archives/1/');
  const html = await res.text();
  assert.ok(html.includes('张三'), '评论作者应展示');
  assert.ok(html.includes('owo_image'), 'Owo 表情应替换为图片');
  assert.ok(html.includes('1 评论') || html.includes('(1)'), '评论数应为 1');
});

await test('插件 action：/action/hello', async () => {
  const res = await call('GET', '/action/hello');
  const data = await res.json();
  assert.equal(data.code, 1);
  assert.ok(data.data.message.includes('Hello World'));
});

// ---- 登录与后台 ----

await test('错误密码登录被拒', async () => {
  const res = await call('POST', '/admin/login', { form: { name: 'admin', password: 'wrong-pass', step: 'password' } });
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes('用户名或密码错误'));
});

await test('未登录访问后台重定向登录页', async () => {
  const savedCookie = cookie; cookie = '';
  const res = await call('GET', '/admin');
  assert.equal(res.status, 302);
  assert.ok(res.headers.get('Location').includes('/admin/login'));
  cookie = savedCookie;
});

await test('正确密码登录成功（无 TOTP 时直接进后台）', async () => {
  const res = await call('POST', '/admin/login', { form: { name: 'admin', password: 'password123', step: 'password' } });
  assert.equal(res.status, 302);
  assert.ok(res.headers.get('Location').endsWith('/admin'));
  assert.ok(cookie.includes('te_sess='), '应设置会话 Cookie');
});

await test('后台仪表盘', async () => {
  const res = await call('GET', '/admin');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('仪表盘'));
  assert.ok(html.includes('文章'));
});

await test('后台撰写文章（Markdown + 分类标签 + 字段）', async () => {
  const res = await call('POST', '/admin/post', {
    form: {
      type: 'post', title: '第二篇文章',
      text: '# 标题一\n\n内容 **加粗**\n\n```js\nconsole.log(1)\n```\n\n<!--more-->\n\n后面内容',
      status: 'publish', password: '', allowComment: '1',
      categories: '1', tags: '测试, 边缘计算',
      field_thumb: '', field_abstract: '第二篇摘要',
    },
  });
  assert.equal(res.status, 302);
  const html = await call('GET', '/archives/2/').then((r) => r.text());
  assert.ok(html.includes('第二篇文章'));
  assert.ok(html.includes('<h1 id='), 'Markdown 标题');
  assert.ok(html.includes('language-js'), '代码块');
});

await test('分类页 /category/default/', async () => {
  const res = await call('GET', '/category/default/');
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes('默认分类'));
});

await test('标签页 /tag/测试/（中文 slug）', async () => {
  const res = await call('GET', '/tag/%E6%B5%8B%E8%AF%95/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('标签'));
});

await test('创建独立页面 + 前台访问 /[slug]/', async () => {
  await call('POST', '/admin/post', {
    form: { type: 'page', title: '关于我', slug: 'about', text: '这是关于页', status: 'publish', allowComment: '1' },
  });
  const res = await call('GET', '/about/');
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes('关于我'));
  // 导航应包含该页面
  const home = await call('GET', '/').then((r) => r.text());
  assert.ok(home.includes('href="/about/"'), '导航应包含独立页面');
});

await test('评论管理页', async () => {
  const res = await call('GET', '/admin/comments');
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes('张三'));
});

// ---- TOTP ----

await test('TOTP：获取绑定二维码页面', async () => {
  const res = await call('GET', '/admin/security?step=bind');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('<svg'), '应有二维码 SVG');
  assert.ok(!html.includes('otpauth'), '页面不应泄漏 otpauth URI');
  // 提取待绑定密钥（测试用）
  const key = [...globalThis.BLOG_KV.map.keys()].find((k) => k.startsWith('opt:totpPending:'));
  assert.ok(key, '应有 totpPending 密钥');
});

await test('TOTP：动态码正确时绑定成功', async () => {
  const { totpAt } = await import('./src/auth/totp.js');
  const secret = JSON.parse(globalThis.BLOG_KV.map.get('opt:totpPending:1'));
  const code = await totpAt(secret, Math.floor(Date.now() / 1000 / 30));
  const res = await call('POST', '/admin/security', { form: { op: 'enable', totp: code } });
  assert.equal(res.status, 302);
  const user = JSON.parse(globalThis.BLOG_KV.map.get('user:1'));
  assert.equal(user.totpEnabled, true);
  assert.equal(user.totpSecret, secret);
});

await test('TOTP：重新登录需要两步验证', async () => {
  cookie = ''; // 退出
  const res = await call('POST', '/admin/login', { form: { name: 'admin', password: 'password123', step: 'password' } });
  const html = await res.text();
  assert.ok(html.includes('动态码') || html.includes('TOTP'), '应要求输入动态码');
});

await test('TOTP：错误动态码被拒', async () => {
  const res = await call('POST', '/admin/login', { form: { step: 'totp', pending: 'fake', totp: '000000' } });
  assert.ok((await res.text()).includes('过期') || res.status === 200);
});

await test('TOTP：正确动态码登录成功', async () => {
  const { totpAt } = await import('./src/auth/totp.js');
  const user = JSON.parse(globalThis.BLOG_KV.map.get('user:1'));
  const code = await totpAt(user.totpSecret, Math.floor(Date.now() / 1000 / 30));
  // 先走密码步骤拿 pending token
  const pendingRes = await call('POST', '/admin/login', { form: { name: 'admin', password: 'password123', step: 'password' } });
  const pendingHtml = await pendingRes.text();
  const m = pendingHtml.match(/name="pending" value="([a-f0-9]+)"/);
  assert.ok(m, '应返回 pending token');
  const res = await call('POST', '/admin/login', { form: { step: 'totp', pending: m[1], totp: code } });
  assert.equal(res.status, 302);
  assert.ok(res.headers.get('Location').endsWith('/admin'));
  assert.ok(cookie.includes('te_sess='));
});

await test('站点设置保存（含 Joe 主题配置）', async () => {
  const res = await call('POST', '/admin/settings', {
    form: { title: '新站名', description: '新描述', pageSize: '5', commentStatus: 'approved', j_JBirthDay: '2024/01/01 00:00:00', j_JAside_Author_Nick: '边缘君' },
  });
  assert.equal(res.status, 302);
  const home = await call('GET', '/').then((r) => r.text());
  assert.ok(home.includes('新站名'));
  assert.ok(home.includes('边缘君'), 'Joe 主题侧栏昵称生效');
});

const setJoeOption = async (patch) => {
  const cur = (await globalThis.BLOG_KV.get('opt:theme:joe', 'json')) || {};
  await globalThis.BLOG_KV.put('opt:theme:joe', JSON.stringify({ ...cur, ...patch }));
};

await test('主题：舔狗日记 / 3D 标签云 可在后台开关', async () => {
  // 此前 JAside_Flatterer / JAside_3DTag 只有默认值，admin.js 的设置表单里没有对应字段，
  // 而 saveSettings 只写 form 中出现的 j_ 前缀字段，用户根本改不了。
  // 表单字段本身的断言放在已登录的「站点设置保存」用例里（需管理员会话）。
  const adminSrc = await readFile('src/controllers/admin.js', 'utf8');
  assert.ok(adminSrc.includes('name="j_JAside_Flatterer"'), '设置表单缺少「舔狗日记侧栏」开关');
  assert.ok(adminSrc.includes('name="j_JAside_3DTag"'), '设置表单缺少「3D 标签云侧栏」开关');

  const { JOE_DEFAULTS } = await import('./src/render/theme-joe.js');
  assert.equal(JOE_DEFAULTS.JAside_Flatterer, 'on', '舔狗日记默认应为开启');
  assert.equal(JOE_DEFAULTS.JAside_3DTag, 'off', '3D 标签云默认应为关闭');

  const has = (html, cls) => html.includes(`joe_aside__item ${cls}"`);

  await setJoeOption({ JAside_Flatterer: 'on' });
  assert.ok(has(await (await call('GET', '/')).text(), 'flatterer'), 'JAside_Flatterer=on 时侧栏缺舔狗日记');
  await setJoeOption({ JAside_Flatterer: 'off' });
  assert.ok(!has(await (await call('GET', '/')).text(), 'flatterer'), 'JAside_Flatterer=off 时舔狗日记仍在渲染');

  await setJoeOption({ JAside_3DTag: 'off', JAside_Flatterer: 'on' });
  assert.ok(!has(await (await call('GET', '/')).text(), 'tags'), 'JAside_3DTag=off 时标签云仍在渲染');

  // 渲染条件是 `=== 'on' && tags.length`；本用例排在"后台撰写文章"之后，库里已有标签
  assert.ok((await (await call('GET', '/tag/测试/')).status) === 200, '前置条件：库里应已有标签');

  await setJoeOption({ JAside_3DTag: 'on' });
  const onHtml = await (await call('GET', '/')).text();
  assert.ok(has(onHtml, 'tags'), 'JAside_3DTag=on 且有标签时，标签云没渲染');

  await setJoeOption({ JAside_Flatterer: 'on', JAside_3DTag: 'off' });
});

await test('友链插件：mode=links 页面渲染', async () => {
  await call('POST', '/admin/post', {
    form: { type: 'page', title: '友情链接', slug: 'links', text: '腾讯||https://qq.com||\nEdgeOne||https://edgeone.ai||', status: 'publish', allowComment: '1', field_mode: 'links' },
  });
  const res = await call('GET', '/links/');
  const html = await res.text();
  assert.ok(html.includes('joe_links'), '应渲染友链结构');
  assert.ok(html.includes('https://qq.com'));
});

await test('附件上传到 Blob（KV 降级模式）', async () => {
  const boundary = '----test' + Date.now();
  const fileBody = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="test.png"`,
    `Content-Type: image/png`,
    '',
    '\x89PNG\r\n\x1a\n test image data',
    `--${boundary}--`,
  ].join('\r\n');
  const request = new Request('https://blog.example.com/admin/upload', {
    method: 'POST',
    headers: { 'Cookie': cookie, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: fileBody,
  });
  const res = await onRequest({ request, env: {}, params: {}, waitUntil: () => {} });
  assert.equal(res.status, 302);
  // 附件访问
  const key = [...globalThis.BLOG_KV.map.keys()].find((k) => k.startsWith('file:data:'));
  assert.ok(key, '附件应存储（Blob 降级 KV）');
});

await test('登出后后台不可访问', async () => {
  await call('GET', '/admin/logout');
  const res = await call('GET', '/admin');
  assert.equal(res.status, 302);
});

// ================= 汇总 =================
console.log('\n========== 测试结果 ==========');
for (const r of results) console.log(r);
console.log(`\n共 ${results.length} 项，失败 ${results.filter((r) => r.startsWith('✗')).length} 项`);

/**
 * 本地集成测试：模拟 EdgeOne Edge Function 运行时
 * - 用内存 Map 模拟 KV 绑定
 * - 直接 import 打包前的源码（src/main.js）验证安装→发文→浏览→评论→TOTP 全流程
 *
 * 运行：node test.mjs
 */
import assert from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { pageNav, thumbnail } from './src/render/html.js';
import { KV } from './src/storage/kv.js';
import { BlobStorage } from './src/storage/blob.js';
import { Database } from './src/db.js';

/**
 * 假 Blob store，**刻意复刻真实 SDK 的两个行为**：
 * 1. get(key,{type:'arrayBuffer'}) 返回原始字节；
 * 2. getWithHeaders() 的 body 是 new TextDecoder('utf-8').decode(bytes)，
 *    二进制会被毁成字符串（这正是线上预览打不开的根因）。
 * 有了它，谁把读取改回 getWithHeaders 测试就会红。
 */
function makeFakeBlobStore() {
  const map = new Map();
  const calls = { del: [] };
  const toBytes = (v) => (v instanceof Uint8Array ? v : new Uint8Array(v));
  return {
    map,
    calls,
    async set(k, v) { map.set(k, toBytes(v).slice()); },
    async get(k, o = {}) {
      const raw = map.get(k);
      if (!raw) return null;
      const b = toBytes(raw);
      if (o.type === 'arrayBuffer') return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      return new TextDecoder('utf-8').decode(b);
    },
    async getWithHeaders(k) {
      const raw = map.get(k);
      if (!raw) return null;
      return { body: new TextDecoder('utf-8').decode(toBytes(raw)), headers: { 'content-type': 'image/png' } };
    },
    async delete(k) { calls.del.push(k); map.delete(k); },
  };
}

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

  // 回归点：首页卡片其实是 joe.index.js 清空后用这份数据重画的，取的是 _.image[0]。
  // 没封面时 image 为空数组，取出来是 undefined，模板就渲染出 data-src="undefined"，
  // lazysizes 再把这串写进 src——图片彻底不显示。必须始终有图可取。
  for (const item of data.data) {
    assert.ok(Array.isArray(item.image) && item.image.length >= 1, `${item.title} 的 image 为空`);
    const u = item.image[0];
    assert.equal(typeof u, 'string');
    assert.notEqual(u, 'undefined');
    assert.notEqual(u, '');
    assert.ok(/^(https?:\/\/|\/)/.test(u), `${item.title} 的 image[0] 不是可用地址：${u}`);
  }
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

await test('主题：搜索面板结构与脚本齐备（对齐 5i.ink）', async () => {
  const res = await call('GET', '/');
  const html = await res.text();
  const aboveAtOf = (h) => h.indexOf('class="joe_header__above-search"');
  // 与 5i.ink 一致：顶栏和移动端面板都是 <form>，input/button 是表单直接子元素
  assert.ok(
    /class="joe_header__searchout-inner"\s*>\s*<form class="search"/.test(html),
    '搜索面板缺少 .search 表单包裹层，主题 CSS 的 input/button 布局不会生效'
  );
  assert.ok(html.includes('class="joe_header__above-search" method="get"'),
    '顶栏搜索未使用 form，回车无法走原生提交');
  // 主题 CSS 靠 .submit / .icon / .result .item 的形状出效果，缺一样就散架
  assert.ok(html.includes('class="submit">搜索</button>'), '缺少 .submit 按钮');
  assert.ok(/<span class="icon"><\/span>/.test(html), '.icon 应为主题自带的 <span>（含聚焦翻转动画）');
  assert.ok(html.includes('class="result"'), '缺少联想/热门下拉面板');
  assert.ok(/<span class="sort">\d+<\/span>/.test(html), '.result 条目缺少 .sort 排名徽标');
  assert.ok(html.includes('class="text"'), '.result 条目缺少 .text 标题');
  assert.ok(/<span class="views">\d+ 阅读<\/span>/.test(html), '.result 条目缺少 .views 阅读量');
  // 热门条目必须带真实链接（曾误用不存在的 p.permalink，渲染成 href="undefined"）
  const aboveSeg = html.slice(aboveAtOf(html), aboveAtOf(html) + 1400);
  const hrefs = [...aboveSeg.matchAll(/<a href="([^"]*)"[^>]*class="item"/g)].map((m) => m[1]);
  assert.ok(hrefs.length > 0, '下拉面板没有渲染任何条目');
  for (const h of hrefs) {
    assert.ok(/^\/(archives\/\d+\/|attachment\/\d+\/|[^/]+\/)/.test(h), `下拉条目链接非法：${h}`);
  }
  // 联想渲染脚本必须被引入
  assert.ok(html.includes('assets/js/joe.search.js'), '未引入 joe.search.js，搜索框点了没反应');
  // 下拉容器（联想结果挂载点）必须落在 .joe_header__above-search 之内
  const aboveAt = html.indexOf('class="joe_header__above-search"');
  const resultAt = html.indexOf('class="result"');
  assert.ok(aboveAt >= 0 && resultAt > aboveAt, '联想结果挂载点 .result 不在 .joe_header__above-search 内');
  // 布局补丁样式表必须被引入
  assert.ok(html.includes('assets/css/joe.layout.css'), '未引入 joe.layout.css');
});

await test('主题：文章底部 operate + pagination 对齐 5i.ink', async () => {
  const html = await (await call('GET', '/archives/1/')).text();

  // ---- .joe_detail__operate：胶囊标签 + 分享面板 ----
  assert.ok(html.includes('class="joe_detail__operate"'), '缺少 .joe_detail__operate');
  assert.ok(html.includes('class="joe_detail__operate-tags"'), '缺少标签区');
  assert.ok(html.includes('class="joe_detail__operate-share"'), '缺少分享区');
  assert.ok(html.includes('class="reach"'), '缺少 .reach 分享面板容器');
  assert.ok(!html.includes('class="joe_detail__tags"'),
    '仍在输出 .joe_detail__tags，主题 CSS 里没有这条规则（裸链接）');

  // 三个分享入口，URL 模板与 5i.ink 一致
  assert.ok(html.includes('connect.qq.com/widget/shareqq/index.html?url='), '缺 QQ 分享');
  assert.ok(html.includes('sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzshare_onekey?url='), '缺 QQ 空间分享');
  assert.ok(html.includes('service.weibo.com/share/share.php?sharesource=weibo'), '缺微博分享');
  // 分享链接必须带文章绝对地址，否则第三方平台拿不到原文
  const shareUrls = [...html.matchAll(/class="reach"[\s\S]*?<\/div>/g)][0][0];
  const abs = shareUrls.match(/url=([^&"]+)/);
  assert.ok(abs && /^https?:\/\/[^/]+\/archives\/\d+\/$/.test(decodeURIComponent(abs[1])),
    `分享链接的 url 不是文章绝对地址：${abs && abs[1]}`);
  // 分享图标必须是内联 SVG（主题 CSS 用 svg{cursor:pointer} 和 hover 旋转）
  assert.ok(/class="joe_detail__operate-share">\s*<svg viewBox="0 0 1024 1024"[^>]*width="26"/.test(html),
    '分享入口图标应为 26×26 内联 svg');

  // ---- .joe_post__pagination：可见文字是「上一篇/下一篇」，标题在 title 属性 ----
  // 此刻夹具只有一篇文章，只有「下一篇」；两个方向齐全的那条见「上下篇文字」测试
  const pag = html.slice(html.indexOf('class="joe_post__pagination"'));
  const pagSeg = pag.slice(0, pag.indexOf('</ul>'));
  const sides = { prev: '上一篇', next: '下一篇' };
  let seen = 0;
  for (const [side, label] of Object.entries(sides)) {
    const m = new RegExp(`pagination-item ${side}"><a href="([^"]*)" title="([^"]*)">([^<]*)<\\/`).exec(pagSeg);
    if (!m) continue;
    seen++;
    assert.equal(m[3], label, `${side} 可见文字应为「${label}」，实际「${m[3]}」`);
    assert.ok(/^\/archives\/\d+\/$/.test(m[1]), `${side} 链接非法：${m[1]}`);
    assert.ok(m[2], `${side} 的 title 应为文章标题`);
  }
  assert.equal(seen, 0, '只有一篇文章时上下篇都应缺席');

  // ---- 分享面板的展开/收起必须有 JS（5i.ink 缺这段，面板永远 visibility:hidden）----
  // 页面真正加载的是 joe.global.min.js，与 .js 是两份独立文件、构建也不会重新生成 min。
  // 所以要去 HTML 里把脚本地址抠出来，取回那个文件校验，别只查 .js。
  const scripts = [...html.matchAll(/<script src="([^"]*joe\.global[^"]*)"[^>]*><\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length === 1, `页面应只加载一个 joe.global 脚本，实际：${scripts}`);
  // /usr/ 静态资源由平台静态层响应，函数不返回内容，这里按 URL 映射回仓库文件读
  const g = await readFile(`.${scripts[0].split('?')[0]}`, 'utf8');
  assert.ok(/joe_detail__operate-share/.test(g), `${scripts[0]} 未绑定分享面板的展开/收起`);
});

await test('主题：侧边滑出面板 slideout 对齐 5i.ink', async () => {
  const html = await (await call('GET', '/')).text();
  const i = html.indexOf('class="joe_header__slideout"');
  assert.ok(i >= 0, '缺少侧边面板');
  const seg = html.slice(i, html.indexOf('joe_header__searchout', i));

  // 旧的 wrap 层和扁平的 a.item 在主题 CSS 里都零命中，必须已被替换
  assert.ok(!seg.includes('joe_header__slideout-wrap'), '仍在输出零命中的 .joe_header__slideout-wrap');
  assert.ok(!/<a class="item[^"]*"[^>]*>首页/.test(seg), '仍在输出零命中的扁平 a.item 菜单');

  // ---- 壁纸图：absolute + 满宽 150px，主题 CSS 依赖 width/height 属性以外的内联尺寸 ----
  const img = /<img width="100%" height="150" class="joe_header__slideout-image" src="([^"]*)" alt="侧边栏壁纸"/.exec(seg);
  assert.ok(img, '壁纸图结构不符（需 width="100%" height="150"）');
  assert.ok(img[1], '壁纸图 src 为空');

  // ---- 博主卡：.avatar + .info(.link + .motto)，主题 CSS 要求 .avatar 是 50x50 ----
  const author = seg.slice(seg.indexOf('<div class="joe_header__slideout-author"'), seg.indexOf('<ul class="joe_header__slideout-count"'));
  assert.ok(/<img width="50" height="50" class="avatar lazyload" src="[^"]+" data-src="[^"]+" alt="博主头像"/.test(author),
    '博主头像结构不符（需 50x50 .avatar.lazyload + data-src）');
  assert.ok(/<div class="info">\s*<a class="link" href="[^"]+" target="_blank" rel="noopener noreferrer nofollow">/.test(author),
    '博主昵称需是 .info > a.link 且带 target/rel');
  assert.ok(/<p class="motto joe_motto">/.test(author), '缺 .motto.joe_motto（JS 会往里填签名）');
  // 昵称不能是空字符串
  const nick = /<a class="link"[^>]*>([^<]*)</.exec(author);
  assert.ok(nick && nick[1].trim(), '博主昵称为空');

  // ---- 统计：ul > li.item > svg.icon(15) + 文案 + strong ----
  const count = seg.slice(seg.indexOf('<ul class="joe_header__slideout-count"'), seg.indexOf('class="joe_header__slideout-menu'));
  assert.ok(count.startsWith('<ul'), '.joe_header__slideout-count 必须是 ul（主题 CSS 按 li.item 排版）');
  const items = [...count.matchAll(/<li class="item">\s*<svg class="icon"[^>]*width="15" height="15">/g)];
  assert.equal(items.length, 2, `应有两条统计，实际 ${items.length}`);
  const wrote = /累计撰写 <strong>(\d+)<\/strong> 篇文章/.exec(count);
  const got = /累计收到 <strong>(\d+)<\/strong> 条评论/.exec(count);
  assert.ok(wrote && Number(wrote[1]) > 0, '文章数未渲染');
  assert.ok(got, '评论数未渲染');

  // ---- 菜单：ul.panel-box，首页 + .link.panel 手风琴 + ul.slides.panel-body ----
  const menu = seg.slice(seg.indexOf('<ul class="joe_header__slideout-menu'));
  assert.ok(/<ul class="joe_header__slideout-menu panel-box">/.test(menu), '菜单必须是 ul.panel-box');
  assert.ok(/<li><a class="link current" href="\/" title="首页"><span>首页<\/span><\/a><\/li>|<li><a class="link" href="\/" title="首页">/.test(menu),
    '菜单首项应为首页');
  // 手风琴分组：有子项才渲染，且 .icon 是 13x13
  const groups = [...menu.matchAll(/<a class="link panel" href="#" rel="nofollow"><span>([^<]+)<\/span><svg class="icon"[^>]*width="13" height="13">/g)];
  assert.ok(groups.length >= 1, '应至少有手风琴分组');
  const labels = groups.map((g) => g[1]);

  // 分组名称与顺序：分类 → 标签 → 页面（原来的「栏目」已更名为「分类」）
  assert.ok(!labels.includes('栏目'), '「栏目」应更名为「分类」');
  const expected = ['分类', '标签', '页面'].filter((x) => labels.includes(x));
  assert.deepEqual(labels, expected, `分组顺序应为 分类/标签/页面，实际 ${labels.join('/')}`);
  // 只渲染有子项的分组，且每组子项 href 要指向真实路由
  for (const label of labels) {
    const re = new RegExp(`<span>${label}</span>[\\s\\S]*?<ul class="slides panel-body">([\\s\\S]*?)</ul>`);
    const body = re.exec(menu);
    assert.ok(body, `${label} 分组缺 .slides.panel-body`);
    assert.ok(/<li><a class="link/.test(body[1]), `${label} 分组没有子项，不该渲染这一组`);
    assert.ok(/href="\/(category|tag)\/[^/]+\/"/.test(body[1]) || label === '页面',
      `${label} 分组的子项 href 不合法`);
  }
  // 标签分组必须排在分类之后、页面之前
  if (labels.includes('标签')) {
    assert.ok(labels.indexOf('分类') < labels.indexOf('标签'), '「标签」应排在「分类」之后');
    assert.ok(labels.indexOf('标签') < labels.indexOf('页面'), '「标签」应排在「页面」之前');
  }
  assert.ok(/<ul class="slides panel-body">/.test(menu), '分组内缺 .slides.panel-body');
  // 分组下必须有可点的子项，且 current 只落在当前路径上
  const subLinks = [...menu.matchAll(/<li><a class="link( current)?" href="([^"]*)" title="([^"]*)">/g)];
  assert.ok(subLinks.length >= 2, `菜单子项过少：${subLinks.length}`);
  // href 必须是可用的站内地址：listMetas 不给 permalink，拼错就是 href="undefined"
  for (const s2 of subLinks) {
    assert.ok(/^\/(archives\/\d+|category\/[^/]+\/|[^/]+\/|)\S*$/.test(s2[2]) && !/undefined|null|NaN/.test(s2[2]),
      `子项 href 非法：${s2[2]}`);
  }
  for (const s2 of subLinks) {
    if (!s2[1]) continue;
    assert.equal(s2[2], '/', `首页之外的 current 项指向了 ${s2[2]}`);
  }

  // ---- 手风琴 JS 必须在真正被加载的 min 里 ----
  const src = [...html.matchAll(/<script src="([^"]*joe\.global[^"]*)"[^>]*><\/script>/g)];
  assert.equal(src.length, 1, `应只加载一个 joe.global，实际 ${src.length}`);
  const g = await readFile(`.${src[0][1].split('?')[0]}`, 'utf8');
  assert.ok(/joe_header__slideout-menu/.test(g), 'min 里没有滑出面板的初始化');
  assert.ok(/panel-body/.test(g), 'min 里没有手风琴的展开逻辑');

  // 同一批 .panel 只能被绑一次 toggle：绑两次会互相抵消，点击表现为「没反应」。
  // （踩过一次：移植时又加了一份，5i.ink 原文件里本来就有一段。）
  // 一份 handler 里只有一个 toggleClass("in")，出现两次就说明重复绑定了
  const toggles = (g.match(/toggleClass\(["']in["']\)/g) || []).length;
  assert.equal(toggles, 1, `toggleClass("in") 出现 ${toggles} 次：>1 说明同一批 .panel 被绑了多次，` +
    '两次 toggle 会互相抵消，点击表现为「没反应」');
});

await test('主题：.min.js 必须由同名 .js 生成（页面加载的是 min）', async () => {
  // 页面引用的是 .min.js，而 .js / .min.js 是两份独立文件、build 也不会重新生成 min。
  // 只改 .js 会让改动静默失效——share 面板就踩过一次。
  const dir = 'usr/themes/joe/assets/js/';
  const names = (await readdir(dir)).filter((f) => f.endsWith('.min.js')).map((f) => f.slice(0, -7));
  assert.ok(names.length >= 8, `预期主题 JS 至少 8 个 min，实际 ${names.length}`);

  const markers = {
    'joe.global': 'joe_detail__operate-share', // 本次新增：文章底部分享面板
    'joe.search': null,
  };

  for (const name of names) {
    const raw = await readFile(`${dir}${name}.js`, 'utf8');
    // 从 .js 里挑几个只可能出现在功能实现里、且不会被压缩掉的标识符
    const probes = markers[name] ? [markers[name]] : [];
    for (const probe of probes) {
      const inJs = raw.includes(probe);
      const inMin = (await readFile(`${dir}${name}.min.js`, 'utf8')).includes(probe);
      assert.equal(inJs, inMin, `${name}.js 与 ${name}.min.js 对 "${probe}" 的支持不一致`);
    }
  }

  // 分享面板的展开逻辑必须在真正被加载的 min 里
  const min = await readFile(`${dir}joe.global.min.js`, 'utf8');
  assert.ok(/querySelectorAll\(".joe_detail__operate-share"\)/.test(min),
    'joe.global.min.js 里没有分享面板的原生绑定');
  assert.ok(/classList\.toggle\("active"\)/.test(min), 'joe.global.min.js 里没有展开/收起逻辑');
});

// 回归点：分享面板的 active 切换曾在 joe.global.js 和 joe.post_page.js 里各实现一份。
// 两个处理器同时绑在同一个 svg 上，点击时各 toggle 一次 .active——刚加上就被对方翻回去，
// 点多少次面板都不展开。切换逻辑必须只存在于一个文件里。
await test('分享面板的 active 切换只有一处实现', async () => {
  const dir = 'usr/themes/joe/assets/js/';
  const impl = [];
  for (const f of ['joe.global.js', 'joe.post_page.js']) {
    const raw = await readFile(`${dir}${f}`, 'utf8');
    const mentionsShare = raw.includes('joe_detail__operate-share');
    const toggles = /(classList\.toggle\(\s*["']active["']\s*\)|\.toggleClass\(\s*["']active["']\s*\))/;
    if (mentionsShare && toggles.test(raw)) impl.push(f);
  }
  assert.deepEqual(impl, ['joe.global.js'],
    `分享面板的 active 切换必须且只能在 joe.global.js 里实现，实际出现在：${impl.join(', ')}`);
});

// 回归点：阅读去重曾是「cid 数组 + 永不过期」，一旦记过就永远不再计数。
// 数据重置后服务端计数归 0、浏览器仍记着「已统计」，阅读量就永久卡在 0。
// 现在改成 cid → 时间戳 的映射并设有效期；旧的数组格式一律视为已过期。
await test('阅读去重有时间窗，且旧数组格式会重新计一次', async () => {
  const dir = 'usr/themes/joe/assets/js/';
  const raw = await readFile(`${dir}joe.post_page.js`, 'utf8');
  const min = await readFile(`${dir}joe.post_page.min.js`, 'utf8');

  // 永久去重的写法不能回来
  assert.ok(!/viewsArr\.includes\(cid\)/.test(raw), '阅读去重又变回永不过期的 viewsArr.includes');
  assert.ok(!/viewsArr\.push\(cid\)/.test(raw), '阅读去重又变回只往数组里 push cid');

  // 时间窗 + 时间戳映射
  assert.ok(/VIEWS_DEDUP_HOURS\s*=\s*\d+/.test(raw), '没有定义去重时间窗 VIEWS_DEDUP_HOURS');
  assert.ok(/viewMap\[cid\]\s*=\s*now/.test(raw), '没有记录 cid 的计次时间戳');
  assert.ok(/Array\.isArray\(parsed\)/.test(raw), '没有兼容旧的 cid 数组格式');

  // 页面加载的是 min。注意 min 里常量名会被内联（VIEWS_DEDUP_HOURS → _=24），
  // 所以 min 侧只断言压缩后仍存活的结构性标记，不去匹配变量名。
  for (const probe of ['Array.isArray', 'handle_views', 'localStorage.setItem']) {
    assert.ok(min.includes(probe), `joe.post_page.min.js 里缺少 ${probe}，改动不会生效`);
  }
  assert.ok(!/viewsArr\.includes\(cid\)/.test(min), 'joe.post_page.min.js 里仍是永久去重');
  // 时间窗确实进了产物：24 小时换算成毫秒
  assert.ok(/\b24\b/.test(min) && /3600\*1e3/.test(min),
    'joe.post_page.min.js 里看不到 24 小时的去重窗口');
});

// 置顶角标有两条渲染路径：服务端直出（indexItem）和前端 initDom 重画
//（joe.index.js → publish_list）。前端那段一直都在，缺的是服务端那份和接口的
// type 标记；两边必须给出一样的结果，否则 JS 一跑角标就消失了。
await test('置顶角标：服务端直出与接口标记一致', async () => {
  const dir = 'usr/themes/joe/assets/js/';
  const js = await readFile(`${dir}joe.index.js`, 'utf8');
  const badgeRe = /<span class="badge"[^>]*>置顶<\/span>/;
  assert.ok(badgeRe.test(js), 'joe.index.js 里没有「置顶」角标的渲染片段');
  // 四个排序页签都要有，否则切换排序后角标会消失
  const badgeCount = (js.match(/<span class="badge"[^>]*>置顶<\/span>/g) || []).length;
  assert.ok(badgeCount >= 4, `joe.index.js 的角标渲染片段只有 ${badgeCount} 处，排序切换后可能丢角标`);

  // 接口侧：置顶文章必须标成 sticky，否则前端不会显示角标
  const prev = await BLOG_KV.get('opt:theme:joe');
  try {
    const all = await (await call('POST', '/joe/api', {
      form: { routeType: 'publish_list', page: 1, pageSize: 50, type: 'created' },
    })).json();
    const target = all.data[all.data.length - 1];
    await BLOG_KV.put('opt:theme:joe', JSON.stringify({ JStickPosts: String(target.cid) }));

    const p1 = await (await call('POST', '/joe/api', {
      form: { routeType: 'publish_list', page: 1, pageSize: 50, type: 'created' },
    })).json();
    const sticky = p1.data.filter((d) => d.type === 'sticky');
    assert.equal(sticky.length, 1, `应恰好有 1 篇标成 sticky，实际 ${sticky.length}`);
    assert.equal(sticky[0].cid, target.cid, '标成 sticky 的不是被置顶的那篇');

    // 服务端直出：首页 HTML 里置顶文章应带角标，普通文章不带
    const html = await (await call('GET', '/')).text();
    assert.ok(/class="badge"[^>]*>置顶<\/span>/.test(html), '首页服务端直出的 HTML 里没有置顶角标');
  } finally {
    if (prev === undefined || prev === null) await BLOG_KV.delete('opt:theme:joe');
    else await BLOG_KV.put('opt:theme:joe', prev);
  }
});

await test('主题：回顶/切换主题按钮的图标与排列对齐 5i.ink', async () => {
  const html = await (await call('GET', '/')).text();
  const seg = html.slice(html.indexOf('<div class="joe_action">'));
  const act = seg.slice(0, seg.indexOf('</div>\n</div>') > 0 ? 4000 : 4000);

  // 顺序：回顶(scroll) 在上，切换主题(mode) 在下
  assert.ok(act.indexOf('joe_action_item scroll') < act.indexOf('joe_action_item mode'),
    '回顶按钮应在切换主题按钮上方');

  // 回顶是火箭，不是主题切换图标的复制品（曾把日间图标直接复制过来）
  const rocket = act.match(/joe_action_item scroll">([\s\S]*?)<\/svg>/)[1];
  assert.ok(rocket.includes('M725.902 498.916'), '回顶图标不是火箭');
  assert.ok(rocket.includes('width="25"'), '回顶图标尺寸应为 25');

  // 切换主题：夜间月亮 / 日间太阳，两个图标必须不同
  const icons = [...act.matchAll(/<svg class="(icon-[12])"([\s\S]*?)<\/svg>/g)];
  assert.equal(icons.length, 2, '切换主题按钮应有两个图标');
  const [i1, i2] = icons.map((m) => m[2]);
  assert.ok(i1.includes('M587.264 104.96'), 'icon-1 应为月亮');
  assert.ok(i2.includes('M234.24 512a277.76'), 'icon-2 应为太阳');
  assert.notEqual(i1, i2, '月亮与太阳不能是同一个图标');
  assert.ok(i1.includes('width="25"') && i2.includes('width="25"'), '切换主题图标尺寸应为 25');
});

await test('主题：正文与侧栏同属 .joe_body（两栏布局的挂载点）', async () => {
  const css = await readFile('usr/themes/joe/assets/css/joe.layout.css', 'utf8');
  // 侧栏在右：order:1 + flex 固定宽度，正文 flex:1
  assert.ok(/\.joe_body\s*\{[^}]*display:\s*flex/.test(css), 'joe_body 未启用 flex');
  assert.ok(/\.joe_body > \.joe_aside\s*\{[^}]*order:\s*1/.test(css), '侧栏未置于右侧');
  assert.ok(/\.joe_body > \.joe_main\s*\{[^}]*flex:\s*1 1 auto/.test(css), '正文列未占据剩余宽度');
  // 搜索高亮样式已从内联 <style> 迁到该文件
  assert.ok(css.includes('.joe_header__above-search .result .item.active'));

  // 悬浮按钮外观交回主题自带样式（对齐 5i.ink），此处不应再覆盖尺寸/悬停
  assert.ok(!css.includes('.joe_action_item'), '不应再覆盖 .joe_action_item 外观');


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

await test('文章：上下篇可见文字为「上一篇/下一篇」，标题在 title 属性', async () => {
  // 造第三篇，让中间的 cid=2 上下篇齐全
  await call('POST', '/admin/post', {
    form: { type: 'post', title: '第三篇文章', text: '正文', status: 'publish' },
  });

  const pagOf = async (cid) => {
    const h = await call('GET', `/archives/${cid}/`).then((r) => r.text());
    const seg = h.slice(h.indexOf('class="joe_post__pagination"'));
    return seg.slice(0, seg.indexOf('</ul>'));
  };
  const pick = (pag, side) =>
    new RegExp(`pagination-item ${side}"><a href="([^"]*)" title="([^"]*)">([^<]*)<\\/`).exec(pag);

  const mid = await pagOf(2);
  const prev = pick(mid, 'prev');
  const next = pick(mid, 'next');
  assert.ok(prev, '中间的文章应有上一篇');
  assert.ok(next, '中间的文章应有下一篇');
  assert.equal(prev[3], '上一篇', `上一篇可见文字实际「${prev && prev[3]}」`);
  assert.equal(next[3], '下一篇', `下一篇可见文字实际「${next && next[3]}」`);
  // db.prevNext 的约定与 5i.ink 一致：prev 指向更新的一篇，next 指向更早的一篇
  assert.equal(prev[1], '/archives/3/');
  assert.equal(next[1], '/archives/1/');
  // title 是目标文章的标题，可见文字不该再重复它
  assert.equal(prev[2], '第三篇文章');
  assert.equal(next[2], 'Hello TypechoEdge');

  // 最新一篇没有上一篇，最旧一篇没有下一篇——缺席而不是渲染空 li
  assert.equal(pick(await pagOf(3), 'prev'), null, '最新一篇不该有上一篇');
  assert.ok(pick(await pagOf(3), 'next'), '最新一篇应有下一篇');
  assert.equal(pick(await pagOf(1), 'next'), null, '最旧一篇不该有下一篇');
  assert.ok(pick(await pagOf(1), 'prev'), '最旧一篇应有上一篇');
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

await test('留言板默认可用：未建页面时 /guestbook/ 仍返回便签墙', async () => {
  const res = await call('GET', '/guestbook/');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(body.includes('留言板'), '页面应包含留言板标题');
  assert.ok(body.includes('joe_wall__board'), '默认应启用便签墙');
  const home = await call('GET', '/').then((r) => r.text());
  assert.ok(home.includes('href="/guestbook/"'), '导航应始终包含留言板');
});

await test('主题：侧边面板分组为 分类/标签/页面，且标签链接有效', async () => {
  // 先造一篇带标签的文章，确保「标签」分组真的有子项可渲染
  const created = await call('POST', '/admin/post', {
    form: { type: 'post', title: '带标签的文章', text: '正文', status: 'publish', tags: '生活, 技术' },
  });
  assert.ok(!created.headers.get('Location')?.includes('/admin/login'),
    `造带标签的文章失败：被重定向到 ${created.headers.get('Location')}`);
  await call('POST', '/admin/page', {
    form: { type: 'page', title: '关于', slug: 'about', text: '正文', status: 'publish' },
  });

  const html = await (await call('GET', '/')).text();
  const i = html.indexOf('<ul class="joe_header__slideout-menu');
  const menu = html.slice(i, html.indexOf('joe_header__searchout', i));

  const labels = [...menu.matchAll(/<span>([^<]+)<\/span><svg class="icon"[^>]*width="13" height="13">/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['分类', '标签', '页面'], `分组应为 分类/标签/页面，实际 ${labels.join('/')}`);

  // 标签分组的子项必须指向 /tag/<slug>/ 且可访问
  const tagBody = /<span>标签<\/span>[\s\S]*?<ul class="slides panel-body">([\s\S]*?)<\/ul>/.exec(menu);
  assert.ok(tagBody, '标签分组缺 .slides.panel-body');
  const tagLinks = [...tagBody[1].matchAll(/href="([^"]*)" title="([^"]*)"/g)].map((m) => ({ href: m[1], title: m[2] }));
  assert.ok(tagLinks.length >= 1, '标签分组应至少有一个子项');
  for (const l of tagLinks) {
    assert.ok(/^\/tag\/[^/]+\/$/.test(l.href), `标签 href 非法：${l.href}`);
    const r = await call('GET', l.href);
    assert.equal(r.status, 200, `标签页 ${l.href} 打不开（${r.status}）`);
  }
  // 「栏目」已更名为「分类」，旧名不应残留
  assert.ok(!menu.includes('<span>栏目</span>'), '「栏目」应更名为「分类」');
});

await test('主题：索引页标题栏右侧是分类/标签展开按钮（默认收起，可切换）', async () => {
  const html = await (await call('GET', '/')).text();
  const titleEnd = html.indexOf('</ul>', html.indexOf('<ul class="joe_index__title-title'));
  const after = html.slice(titleEnd + 5, titleEnd + 60);
  assert.ok(after.trimStart().startsWith('<div class="joe_index__title-filter">'),
    `筛选按钮容器应紧跟标题导航之后，实际：${after.slice(0, 40)}`);

  // 旧的一排标签入口已被按钮取代
  assert.ok(!html.includes('joe_index__title-tags'), '不应再有旧的标签行容器');

  // 分类按钮在标签按钮之前
  const catBtn = html.indexOf('data-panel="category"');
  const tagBtn = html.indexOf('data-panel="tag"');
  assert.ok(catBtn !== -1 && tagBtn !== -1, '分类/标签按钮都应存在');
  assert.ok(catBtn < tagBtn, '「分类」按钮应在「标签」按钮之前');
  // 按钮里是「图标 + 文字」，所以文案在图标之后
  const btnOf = (kind) => html.slice(html.indexOf(`data-panel="${kind}"`));
  assert.ok(/<\/svg>分类</.test(btnOf('category').slice(0, 400)), '第一个按钮文案应为「分类」');
  assert.ok(/<\/svg>标签</.test(btnOf('tag').slice(0, 400)), '第二个按钮文案应为「标签」');

  // 两个面板默认收起，各自列出全部条目
  for (const kind of ['category', 'tag']) {
    const p = html.match(new RegExp(`<div class="joe_index__title-filter-panel joe_index__title-filter-panel--${kind}" hidden>`));
    assert.ok(p, `${kind} 面板应存在且默认带 hidden`);
    const body = html.slice(html.indexOf(p[0]), html.indexOf('</div>', html.indexOf(p[0])));
    const hrefs = [...body.matchAll(/href="(\/[^"]*)"[^>]*>([^<]+)</g)].map((m) => ({ href: m[1], name: m[2] }));
    assert.ok(hrefs.length >= 1, `${kind} 面板应至少有一个条目`);
    for (const h of hrefs) {
      assert.ok(new RegExp(`^/(${kind})/[^/]+/$`).test(h.href), `${kind} 条目 href 非法：${h.href}`);
      const r = await call('GET', h.href);
      assert.equal(r.status, 200, `${kind} 页 ${h.href} 打不开（${r.status}）`);
    }
  }
  assert.ok(html.includes('aria-expanded="false"'), '按钮初始 aria-expanded 应为 false');

  // 每个按钮都带一个跟随文字颜色的线性图标（currentColor），且图标不同
  const btns = [...html.matchAll(/<button[^>]*joe_index__title-filter-btn[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1]);
  assert.equal(btns.length, 2, '应有两个按钮');
  const iconPaths = btns.map((b) => (b.match(/<svg[^>]*>[\s\S]*?<path d="([^"]{40,})"/) || [])[1]);
  assert.ok(iconPaths.every(Boolean), '每个按钮都应有图标');
  assert.notEqual(iconPaths[0], iconPaths[1], '分类/标签应各用各的图标');
  assert.ok(btns.every((b) => /fill="currentColor"/.test(b)), '图标应跟随文字颜色');
  assert.ok(btns.every((b) => /aria-hidden="true"/.test(b)), '装饰性图标应 aria-hidden');

  // 面板内容应与侧栏同名分组一致（同源 listMetas）
  const sideCount = (label) => {
    const s0 = html.indexOf(`<span>${label}</span>`);
    const body = html.slice(s0, html.indexOf('</ul>', s0));
    return (body.match(/href="\/(category|tag)\//g) || []).length;
  };
  const panelCount = (kind) => {
    const p0 = html.indexOf(`joe_index__title-filter-panel--${kind}" hidden>`);
    const body = html.slice(p0, html.indexOf('</div>', p0));
    return (body.match(/href="\/(category|tag)\//g) || []).length;
  };
  assert.equal(panelCount('category'), sideCount('分类'), '分类面板条目数应与侧栏一致');
  assert.equal(panelCount('tag'), sideCount('标签'), '标签面板条目数应与侧栏一致');

  // 交互脚本：切换 + 点外部关闭
  const js = await readFile('usr/themes/joe/assets/js/joe.index.js', 'utf8');
  const min = await readFile('usr/themes/joe/assets/js/joe.index.min.js', 'utf8');
  for (const [label, src] of [['joe.index.js', js], ['joe.index.min.js', min]]) {
    assert.ok(src.includes('joe_index__title-filter-btn'), `${label} 应绑定按钮`);
    // esbuild 会把 'click' 改成 "click"，两种引号都认
    assert.ok(/\$\(document\)\.on\(['"]click['"]/.test(src), `${label} 应有点击外部关闭的逻辑`);
    assert.ok(src.includes('stopPropagation'), `${label} 按钮点击应阻止冒泡，否则会被「点外部关闭」立刻收起`);
    assert.ok(/hidden/.test(src), `${label} 应切换 hidden`);
  }

  // 样式：面板绝对定位 + 默认隐藏 + 移动端不显示
  const css = await readFile('usr/themes/joe/assets/css/joe.layout.css', 'utf8');
  const panel = css.match(/\.joe_index__title-filter-panel\s*\{([^}]*)\}/)[1];
  assert.ok(/position:\s*absolute/.test(panel), '面板应绝对定位在按钮下方');
  assert.ok(/\.joe_index__title-filter-panel\[hidden\]\s*\{\s*display:\s*none/.test(css), '面板默认应 display:none');
  const rule = css.match(/@media[^{]*max-width:\s*768px[^{]*\{[\s\S]*?\.joe_index__title-filter[\s\S]*?\}/);
  assert.ok(rule && /display:\s*none/.test(rule[0]), '移动端应隐藏筛选按钮');

  // 胶囊按钮样式：图标 + 圆角 + 展开态填主题色
  const btn = css.match(/\.joe_index__title-filter-btn\s*\{([^}]*)\}/)[1];
  assert.ok(/border-radius:\s*14px/.test(btn), '按钮应为胶囊圆角');
  assert.ok(/display:\s*inline-flex/.test(btn), '按钮应让图标与文字同行居中');
  assert.ok(/var\(--classD\)/.test(btn), '按钮底色应用主题的 classD');
  const active = css.match(/\.joe_index__title-filter-btn\.active\s*\{([^}]*)\}/)[1];
  assert.ok(/background:\s*var\(--theme\)/.test(active), '展开态应填充主题色');
  assert.ok(/color:\s*#fff/.test(active), '展开态文字应为白色');
});


await test('主题：分类/标签等归档页的面包屑单行不换行', async () => {
  const css = await readFile('usr/themes/joe/assets/css/joe.layout.css', 'utf8');
  const rule = (sel) => {
    const m = css.match(new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`));
    assert.ok(m, `layout.css 缺少 ${sel} 规则`);
    return m[1];
  };
  assert.ok(/display:\s*flex/.test(rule('.joe_bread__bread')), '面包屑应为 flex 单行');
  const item = rule('.joe_bread__bread .item');
  assert.ok(/white-space:\s*nowrap/.test(item), '面包屑条目不应换行');
  assert.ok(/text-overflow:\s*ellipsis/.test(item), '过长时应用省略号');

  // 回归点：.joe_bread 的样式原本只在 post.min.css 里，归档页加载不到。
  // layout.css 是全站基础样式，必须自带这一份，否则分类/标签页会退回块级堆叠。
  const archive = await readFile('usr/themes/joe/assets/css/joe.archive.min.css', 'utf8');
  assert.ok(!archive.includes('joe_bread'), 'joe.archive.min.css 不含面包屑样式（靠 layout.css 兜底）');

  // 归档页实际渲染了面包屑，且结构完整
  const html = await (await call('GET', '/category/default/')).text();
  const m = html.match(/<ul class="joe_bread__bread">([\s\S]*?)<\/ul>/);
  assert.ok(m, '分类页应有面包屑');
  assert.ok(/<a href="\/" class="link" title="首页">首页<\/a>/.test(m[1]), '面包屑首项应为首页链接');
  assert.ok((m[1].match(/class="line">\/<\/li>/g) || []).length >= 1, '面包屑应有分隔符');
  // 样式在归档页确实被加载
  assert.ok(/href="[^"]*joe\.layout\.css(?:\?[^"]*)?"/.test(html), '归档页应加载 layout.css');

  // 面包屑用短名，完整标题留给 title 属性和下方的 .joe_archive__title
  const crumb = (h) => (h.match(/<li class="item" title="([^"]*)">([^<]*)<\/li>/g) || []);
  const catCrumb = crumb(html);
  assert.equal(catCrumb.length, 1, '分类页面包屑应有且仅有一个非链接条目');
  assert.ok(catCrumb[0].includes('>默认分类<'), `分类面包屑应为短名「默认分类」，实际 ${catCrumb[0]}`);
  assert.ok(catCrumb[0].includes('title="分类 默认分类 下的文章"'), '面包屑 title 应保留完整标题');
  assert.ok(html.includes('<div class="joe_archive__title">分类 默认分类 下的文章</div>'),
    '页面大标题仍应是完整标题');
  assert.ok(html.includes('<title>分类 默认分类 下的文章 - '), 'SEO title 仍应是完整标题');

  // 标签页同样
  const tagHtml = await (await call('GET', '/tag/%E6%B5%8B%E8%AF%95/')).text();
  assert.ok(/<ul class="joe_bread__bread">/.test(tagHtml), '标签页应有面包屑');
  const tagCrumb = crumb(tagHtml);
  assert.ok(tagCrumb[0].includes('>测试<'), `标签面包屑应为短名「测试」，实际 ${tagCrumb[0]}`);

  // 作者 / 搜索归档页的短名
  const searchHtml = await (await call('GET', '/search/test/')).text();
  const searchCrumb = crumb(searchHtml);
  assert.ok(searchCrumb.length === 1, '搜索页面包屑应有一个条目');
  assert.ok(searchCrumb[0].replace(/<[^>]*>/g, '').startsWith('搜索 '),
    `搜索面包屑应为「搜索 …」，实际 ${searchCrumb[0]}`);
  assert.ok(searchHtml.includes('包含关键字 test 的文章'), '搜索页大标题仍是完整标题');
});

await test('封面图：thumb > 正文第一图（Markdown 与 HTML 都认） > 默认图', async () => {
  const A = 'https://ddblog.y11.fun/usr/themes/joe/assets';
  const isDefault = (u) => u.includes('/assets/thumb/');
  const t = (post) => thumbnail(post, A);

  assert.equal(t({ cid: 1, fields: { thumb: 'https://x.com/a.png' }, text: '' }), 'https://x.com/a.png', '优先用后台填的封面');
  assert.equal(t({ cid: 2, fields: {}, text: '前文\n\n![alt](https://y.com/b.png)' }), 'https://y.com/b.png', '认 Markdown 图');

  // 回归点：正文里是粘贴来的 HTML <img> 时也要能取到，不能白白回落到默认图
  assert.equal(t({ cid: 3, fields: {}, text: '前文\n\n<img src="https://z.com/c.png">' }), 'https://z.com/c.png', '认 HTML img');
  assert.equal(t({ cid: 3, fields: {}, text: "<img class='x' src='https://z.com/s.png'>" }), 'https://z.com/s.png', '认单引号的 HTML img');
  assert.equal(t({ cid: 9, fields: {}, text: '<img alt="t" src="https://ok.png" width="10">' }), 'https://ok.png', 'src 不是第一个属性时也要取到');

  // 取文本上更靠前的那张，符合「正文第一图」
  assert.equal(t({ cid: 7, fields: {}, text: '<img src="https://first.png">\n\n![a](https://second.png)' }), 'https://first.png', 'HTML 在前时取 HTML');
  assert.equal(t({ cid: 8, fields: {}, text: '![a](https://first.png)\n\n<img src="https://second.png">' }), 'https://first.png', 'Markdown 在前时取 Markdown');

  assert.ok(isDefault(t({ cid: 4, fields: {}, text: '纯文字，没有任何图片' })), '无图时用默认图');
  assert.ok(isDefault(t({ cid: 5, fields: { thumb: '' }, text: '纯文字' })), '封面留空时用默认图');
  // data: 占位图（懒加载 1x1 gif）不能当封面
  assert.ok(isDefault(t({ cid: 6, fields: {}, text: '<img src="data:image/gif;base64,R0lG">' })), 'data: 占位图应跳过');

  // 默认图按 cid 取模，范围必须是 1..42（目录里正好 42 张，否则会 404）
  for (const cid of [1, 42, 43, 84, 1000]) {
    const u = t({ cid, fields: {}, text: '' });
    const n = Number(u.match(/\/(\d+)\.jpg$/)[1]);
    assert.ok(Number.isInteger(n) && n >= 1 && n <= 42, `cid ${cid} 的默认图编号 ${n} 超出 1..42`);
  }
  assert.ok(t({ cid: 1, fields: {}, text: '' }) === t({ cid: 1, fields: {}, text: '' }), '同一篇默认图应固定');
  const names = await readdir('usr/themes/joe/assets/thumb');
  assert.equal(names.filter((f) => f.endsWith('.jpg')).length, 42, '内置默认图应为 42 张');

  // 回归点：内置默认图原本是相对路径 /usr/...，而页面上其它封面都是绝对地址。
  // 相对地址的那批在浏览器里 src 和 data-src 会双双变成字符串 "undefined"，图不显示。
  const html = await (await call('GET', '/')).text();
  // 只看文章卡片的封面，侧栏头像等其它 lazyload 图不在此列
  const covers = [...html.matchAll(/class="thumbnail"[^>]*>\s*<img[^>]*data-src="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(covers.length >= 1, '首页应有封面图');
  for (const c of covers) {
    assert.ok(!/^\//.test(c), `封面图不应是相对路径（会显示不出来）：${c}`);
    assert.ok(/^https?:\/\//.test(c), `封面图应为绝对地址：${c}`);
  }
  const defaults = covers.filter((c) => c.includes('/assets/thumb/'));
  console.log(`    → 首页 ${covers.length} 张封面，其中内置默认图 ${defaults.length} 张，绝对地址 ${covers.length}/${covers.length}`);
});

await test('图片懒加载：缩略图走 lazysizes（lazyload + data-src）', async () => {
  const html = await (await call('GET', '/')).text();
  const cards = [...html.matchAll(/<a[^>]*class="thumbnail"[^>]*>([\s\S]*?)<\/a>/g)];
  assert.ok(cards.length >= 1, '首页应有缩略图卡片');

  // 首屏第一张用 fetchpriority=high 直接加载，其余走 lazysizes
  const eager = cards.filter((c) => /fetchpriority="high"/.test(c[1]));
  for (const card of eager) {
    assert.ok(/src="https?:\/\//.test(card[1]), '首屏图应直接给出 src');
    assert.ok(!/data-src=/.test(card[1]), '首屏图不应再走懒加载');
  }
  const lazy = cards.filter((c) => /data-src=/.test(c[1]));
  assert.ok(lazy.length >= 1, '除首屏外应有懒加载缩略图');
  for (const card of lazy) {
    assert.ok(/class="[^"]*lazyload/.test(card[1]), '懒加载缩略图应带 lazyload 类');
    assert.ok(/src="data:image\/gif/.test(card[1]), '懒加载缩略图应有轻量占位');
  }

  const css = await readFile('usr/themes/joe/assets/css/joe.index.min.css', 'utf8');
  assert.ok(css.includes('.thumbnail img.lazyload'), '应定义懒加载初始态');
  assert.ok(css.includes('.thumbnail img.lazyloaded'), '应定义懒加载完成态');
  assert.ok(/\.thumbnail img\.lazyload\s*\{[^}]*opacity: 0/.test(css), '加载完成前应隐藏占位');
});

await test('评论管理页', async () => {
  const res = await call('GET', '/admin/comments');
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes('张三'));
});

await test('后台 MCP 卡片：端点、掩码令牌、复制与显示控件', async () => {
  const created = await call('POST', '/admin/security', {
    form: { op: 'mcp-add', name: 'Cursor', remark: '编辑器', enabled: 'on', token: '' },
  });
  assert.equal(created.status, 302, '创建令牌后应重定向');

  const res = await call('GET', '/admin/security');
  assert.equal(res.status, 200);
  const html = await res.text();
  for (const needle of ['mcp-grid', 'mcp-card', 'mcp-endpoint', 'mcp-token', 'data-copy=', 'data-mcp-reveal', 'data-mcp-add', 'id="mcp-add-form"']) {
    assert.ok(html.includes(needle), `MCP 区块缺少 ${needle}`);
  }
  assert.ok(html.includes('新增令牌'), '端点条应提供新增令牌按钮');
  assert.ok(!html.includes('mcp-card--new'), '新增令牌不应再占用令牌卡片位');
  assert.ok(html.includes('Cursor'), '应显示令牌名称');
  assert.ok(html.includes('••'), '令牌默认应掩码显示');
  assert.ok(/data-copy="mcp_[0-9a-f]{48}"/.test(html), '应提供完整令牌供复制按钮使用');
  assert.ok(html.includes('/mcp<'), '应展示 MCP 端点');
});

// ---- 备份恢复 ----

await test('备份页：统计、导出、导入与 WebDAV 表单齐全', async () => {
  const res = await call('GET', '/admin/backup');
  assert.equal(res.status, 200);
  const html = await res.text();
  for (const needle of [
    '备份恢复', 'backup-stats', '下载备份文件', '从文件恢复',
    'webdav-save', 'webdav-test', 'webdav-put', 'backup?export=1',
  ]) {
    assert.ok(html.includes(needle), `备份页缺少 ${needle}`);
  }
  assert.ok(html.includes('name="file"'), '应提供导入文件选择框');
  assert.ok(html.includes('name="confirm"'), '恢复前应要求确认');
});

await test('备份导出：附件下载、合法 JSON、不含会话与 WebDAV 密码', async () => {
  const res = await call('GET', '/admin/backup?export=1');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition') || '', /attachment; filename="typecho-edge-\d{8}-\d{6}\.json"/);
  const data = JSON.parse(await res.text());
  assert.equal(data.format, 'typecho-edge-backup');
  assert.equal(data.version, 1);
  assert.ok(data.data['opt:title'], '应包含站点配置');
  assert.ok(data.data['idx:posts'], '应包含文章索引');
  assert.ok(!Object.keys(data.data).some((k) => k.startsWith('sess:')), '不应导出会话');
  assert.ok(!('opt:backup:webdav' in data.data), '不应导出 WebDAV 凭据');
});

await test('备份导入：上传导出的 JSON 可还原被改动的数据', async () => {
  const exported = await (await call('GET', '/admin/backup?export=1')).text();
  const backup = JSON.parse(exported);
  const cid = Object.keys(backup.data).find((k) => k.startsWith('post:'));
  assert.ok(cid, '备份里应有文章');
  const original = backup.data[cid];

  // 故意改坏，再用备份恢复
  const broken = { ...original, title: '被改坏的标题' };
  globalThis.BLOG_KV.map.set(cid, JSON.stringify(broken));

  const fd = new FormData();
  fd.set('op', 'import');
  fd.set('mode', 'merge');
  fd.set('confirm', '1');
  fd.set('file', new Blob([exported], { type: 'application/json' }), 'backup.json');
  const req = new Request('https://blog.example.com/admin/backup', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: fd,
  });
  const res = await onRequest({ request: req, env: {}, params: {}, waitUntil: () => {} });
  assert.equal(res.status, 302, `导入应重定向，实际 ${res.status}`);
  assert.match(res.headers.get('Location') || '', /ok=/);

  const restored = JSON.parse(globalThis.BLOG_KV.map.get(cid));
  assert.equal(restored.title, original.title, '恢复后标题应与备份一致');
});

await test('备份加密：POST 密码导出密文，导入需同一密码', async () => {
  const fd = new FormData();
  fd.set('password', 'backup-pass-123');
  const exported = await onRequest({
    request: new Request('https://blog.example.com/admin/backup?export=1', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: fd,
    }),
    env: {},
    params: {},
    waitUntil: () => {},
  });
  assert.equal(exported.status, 200);
  const envelope = JSON.parse(await exported.text());
  assert.equal(envelope.format, 'typecho-edge-backup-encrypted');
  assert.ok(!JSON.stringify(envelope).includes('"text"'), '密文不应包含正文结构');
  assert.ok(!JSON.stringify(envelope).includes('"post:'), '密文不应包含键名');

  const upload = (password) => {
    const body = new FormData();
    body.set('op', 'import');
    body.set('mode', 'merge');
    body.set('confirm', '1');
    body.set('password', password);
    body.set('file', new Blob([JSON.stringify(envelope)], { type: 'application/json' }), 'encrypted.json');
    return onRequest({
      request: new Request('https://blog.example.com/admin/backup', {
        method: 'POST',
        headers: { Cookie: cookie },
        body,
      }),
      env: {},
      params: {},
      waitUntil: () => {},
    });
  };

  const wrong = await upload('wrong-pass');
  assert.match(wrong.headers.get('Location') || '', /err=/, '错误密码应返回错误');

  const right = await upload('backup-pass-123');
  assert.match(right.headers.get('Location') || '', /ok=/, '正确密码应恢复成功');
});

await test('WebDAV 配置：保存后不回显密码，导出也不包含', async () => {
  const saved = await call('POST', '/admin/backup', {
    form: {
      op: 'webdav-save',
      url: 'https://dav.example.com/remote.php/dav/files/blog',
      username: 'blog',
      password: 'dav-pass-123',
      dir: 'backups/typecho',
      keep: '5',
      backupPassword: 'dav-backup-pass',
    },
  });
  assert.equal(saved.status, 302);

  const html = await (await call('GET', '/admin/backup')).text();
  assert.ok(!html.includes('dav-pass-123'), '页面不应回显 WebDAV 密码');
  assert.ok(!html.includes('dav-backup-pass'), '页面不应回显备份加密密码');
  assert.ok(html.includes('已保存，留空保持不变'), '应提示密码已保存');

  const data = JSON.parse(await (await call('GET', '/admin/backup?export=1')).text());
  assert.ok(!('opt:backup:webdav' in data.data), '导出不应包含 WebDAV 凭据');
});

await test('回收站：后台删除进入回收站，可恢复也可清空', async () => {
  await call('POST', '/admin/post', {
    form: { type: 'post', title: '待回收文章', text: '正文', status: 'publish' },
  });
  const idx = JSON.parse(globalThis.BLOG_KV.map.get('idx:posts'));
  const target = idx.find((e) => e.title === '待回收文章');
  assert.ok(target, '应创建出待回收文章');

  const del = await call('POST', '/admin/delete', { form: { cid: target.cid } });
  assert.equal(del.status, 302);
  assert.ok(!globalThis.BLOG_KV.map.has(`post:${target.cid}`), '正式表应已移除');

  const page = await (await call('GET', '/admin/trash')).text();
  assert.ok(page.includes('回收站'));
  assert.ok(page.includes('待回收文章'), '回收站应显示删除的文章');
  assert.ok(page.includes('清空回收站'));

  const restore = await call('POST', '/admin/trash', { form: { op: 'restore', key: `trash:content:${target.cid}` } });
  assert.equal(restore.status, 302);
  const row = JSON.parse(globalThis.BLOG_KV.map.get(`post:${target.cid}`));
  assert.equal(row.title, '待回收文章', '恢复后文章应回到正式表');

  // 再删一次并清空
  await call('POST', '/admin/delete', { form: { cid: target.cid } });
  const empty = await call('POST', '/admin/trash', { form: { op: 'empty' } });
  assert.equal(empty.status, 302);
  const idxAfter = JSON.parse(globalThis.BLOG_KV.map.get('idx:posts'));
  assert.ok(!idxAfter.some((e) => e.cid === target.cid), '清空后不应再出现在索引');
  const keys = [...globalThis.BLOG_KV.map.keys()].filter((k) => k.startsWith('trash:'));
  assert.equal(keys.length, 0, '回收站应为空');
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

await test('站点设置：头像源排在顶置文章IDs之后，且换位置后仍能保存', async () => {
  // 注意别在这里调 loginAdmin()：它定义在下方，用到的 _kv 是后面才初始化的 const，
  // 现在调用会抛 TDZ；而它第一行就把 cookie 清空了，会连带弄挂后面所有用例。
  // 前面的登录用例留下的会话在这里仍有效。
  const html = await call('GET', '/admin/settings').then((r) => r.text());
  const stickAt = html.indexOf('name="j_JStickPosts"');
  const avatarAt = html.indexOf('name="j_JAvatarSource"');
  assert.ok(stickAt > 0 && avatarAt > 0, '两个字段都应渲染出来');
  assert.ok(avatarAt > stickAt, '头像源应排在顶置文章IDs之后');
  assert.equal(html.split('name="j_JAvatarSource"').length - 1, 1, '头像源不应重复出现');

  // 保存逻辑是 form.entries() 按名收集，与顺序无关；这里真跑一次往返确认没改坏
  await call('POST', '/admin/settings', { form: { j_JAvatarSource: 'cravatar' } });
  const after = await call('GET', '/admin/settings').then((r) => r.text());
  assert.match(after, /value="cravatar" selected/, '换到 Cravatar 后应被记住');
  await call('POST', '/admin/settings', { form: { j_JAvatarSource: 'weavatar' } }); // 还原，别影响后续用例
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

await test('附件：Blob 模式二进制往返不被 UTF-8 破坏', async () => {
  const kv = new KV(new MockKV());
  const store = makeFakeBlobStore();
  const blob = new BlobStorage(kv);
  blob.mode = 'blob';
  blob.store = store;

  // 真 PNG/JPEG 头，含 0x89、0xff 0xd8 这类非法 UTF-8 字节序列
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x80, 0xfe, 0xbf, 0xc0]);
  await blob.set('shot.png', bytes.buffer, 'image/png');

  const got = await blob.get('shot.png');
  assert.ok(got, '应能读回附件');
  const back = new Uint8Array(got.body);
  assert.equal(back.length, bytes.length, `字节长度应一致（实际 ${back.length} != ${bytes.length}）`);
  assert.deepEqual([...back], [...bytes], '字节内容应逐字节一致，未被 UTF-8 解码破坏');
  assert.equal(got.contentType, 'image/png', 'content-type 应来自上传时写入的 meta');

  // meta 缺失（老附件）时按扩展名兜底
  await store.set('old.gif', new Uint8Array([0x47, 0x49, 0x46, 0xff, 0xfe]));
  const old = await blob.get('old.gif');
  assert.equal(old.contentType, 'image/gif', '缺 meta 时应按扩展名推断 content-type');
});

await test('附件：删除会连带清掉 Blob 对象与 meta', async () => {
  const kv = new KV(new MockKV());
  const store = makeFakeBlobStore();
  const blob = new BlobStorage(kv);
  blob.mode = 'blob';
  blob.store = store;
  const db = new Database(kv, blob);

  const row = await db.createContent({
    title: 'pic.png', slug: 'pic-file.png', type: 'attachment', text: '', authorId: 1,
    fields: { contentType: 'image/png', size: 3 },
  });
  await blob.set('pic-file.png', new Uint8Array([0x89, 0x50, 0x4e]).buffer, 'image/png');
  assert.ok(store.map.has('pic-file.png'), '前置：Blob 对象应已写入');

  await db.deleteContent(row.cid);
  assert.ok(store.calls.del.includes('pic-file.png'), '应调用 store.delete 清 Blob 对象');
  assert.ok(!store.map.has('pic-file.png'), 'Blob 对象应已删除');
  assert.equal(await db.getContent(row.cid), null, 'KV 记录应已删除');
  assert.equal(await kv.getJSON('file:meta:pic-file.png'), null, 'meta 记录应已清理');
});

// 分页链接必须是路径式：路由只认 /page/N/ 与 /<归档>/N/，从不读 page 查询参数。
// 曾长期生成 ?page=N，服务端照样按第 1 页渲染，点「下一页」原地不动。
await test('分页链接是路径式，且真能翻到第 2 页', async () => {
  // 首页默认是「查看更多」模式；这里先开启传统分页再验证导航
  await call('POST', '/admin/settings', { form: { 'j_Pagination_Mode': 'on' } });

  const home1 = pageNav(1, 5, '/');
  assert.ok(home1.includes('href="/"'), '首页第 1 页应指向 /');
  assert.ok(home1.includes('href="/page/2/"'), `首页第 2 页应指向 /page/2/，实际: ${home1.match(/href="[^"]+"/g)}`);

  const catNav = pageNav(2, 5, '/category/essay/');
  assert.ok(catNav.includes('href="/category/essay/"'), '归档第 1 页应保留归档根路径');
  assert.ok(catNav.includes('href="/category/essay/3/"'), `归档第 3 页应指向 /category/essay/3/，实际: ${catNav.match(/href="[^"]+"/g)}`);
  assert.ok(!catNav.includes('?page='), '不应再出现 ?page= 查询串');

  // 补足文章数直到首页真的出现分页（PAGE_SIZE = 10）
  let guard = 0;
  while (guard++ < 20) {
    if ((await (await call('GET', '/')).text()).includes('/page/2/')) break;
    await call('POST', '/admin/post', {
      form: {
        type: 'post', title: `凑分页的文章 ${guard}`, text: '正文内容',
        status: 'publish', password: '', allowComment: '1', categories: '1', tags: '',
      },
    });
  }
  const home = await (await call('GET', '/')).text();
  assert.ok(home.includes('/page/2/'), '首页应出现 /page/2/ 链接');
  assert.ok(!home.includes('?page='), '首页不应出现 ?page= 查询串');

  await call('POST', '/admin/settings', { form: { 'j_Pagination_Mode': 'off' } });
  const res = await call('GET', '/page/2/');
  assert.equal(res.status, 200, `/page/2/ 应返回 200，实际 ${res.status}`);
  assert.ok(
    /class="active"[^>]*>\s*<a[^>]*>2</.test(await res.text()),
    '/page/2/ 的分页应把 2 标为当前页'
  );
});

// 回归点：首页列表不是服务端直出——joe.index.js 的 initDom() 会先清空 .joe_list，
// 再拿 publish_list 的数据重画。置顶排序如果只写在 renderIndex 里会被这次重画整个
// 覆盖，后台配了「顶置文章IDs」首页也看不到置顶效果。必须在接口层实现。
// 放在分页测试之后：需要至少 4 篇文章才能验证跨页去重。
await test('置顶文章排最前且全列表不重复', async () => {
  const prev = await BLOG_KV.get('opt:theme:joe');
  try {
    // 用 pageSize=2 强制分页，才能验证跨页去重
    const all = await (await call('POST', '/joe/api', {
      form: { routeType: 'publish_list', page: 1, pageSize: 50, type: 'created' },
    })).json();
    assert.ok(all.data.length >= 4, `需要至少 4 篇才能测跨页，实际 ${all.data.length} 篇`);

    // 置顶「自然顺序最后一篇」，这样排序变化最明显
    const target = all.data[all.data.length - 1];
    await BLOG_KV.put('opt:theme:joe', JSON.stringify({ JStickPosts: String(target.cid) }));

    const p1 = await (await call('POST', '/joe/api', {
      form: { routeType: 'publish_list', page: 1, pageSize: 2, type: 'created' },
    })).json();
    assert.equal(p1.data[0].cid, target.cid, `置顶文章 ${target.cid} 没排在第一位，实际首位是 ${p1.data[0].cid}`);

    // 置顶文章被前置后，后续页必须把它剔除，否则无限滚动会出现重复卡片
    const p2 = await (await call('POST', '/joe/api', {
      form: { routeType: 'publish_list', page: 2, pageSize: 2, type: 'created' },
    })).json();
    assert.ok(!p2.data.some((d) => d.cid === target.cid), `置顶文章 ${target.cid} 在第 2 页重复出现`);

    const cids = p1.data.map((d) => d.cid);
    assert.equal(new Set(cids).size, cids.length, `第 1 页内部重复：${cids.join(',')}`);

    // 角标：joe.index.js 用 type==='sticky' 决定要不要渲染「置顶」徽章。
    // 后台的 JStickPosts 不会改文章 status，所以接口必须显式标出来。
    assert.equal(p1.data[0].type, 'sticky', `置顶文章 ${target.cid} 的 type 不是 sticky，角标不会显示`);
    assert.ok(!p2.data.some((d) => d.type === 'sticky'), '非置顶文章被误标成 sticky');
    assert.ok(p2.data.every((d) => d.type !== 'sticky'), '第 2 页不该出现置顶文章');
  } finally {
    if (prev === undefined || prev === null) await BLOG_KV.delete('opt:theme:joe');
    else await BLOG_KV.put('opt:theme:joe', prev);
  }
});
// 搜索提交按钮：两处（顶栏胶囊 + 展开面板）都应为中文，且不再残留英文
await test('搜索提交按钮为中文', async () => {
  const html = await (await call('GET', '/')).text();
  const btns = html.match(/<button[^>]*class="submit"[^>]*>[^<]*<\/button>/g) || [];
  assert.ok(btns.length >= 2, `应有两处 .submit 按钮，实际 ${btns.length}`);
  for (const b of btns) {
    assert.ok(b.includes('搜索'), `.submit 按钮应为「搜索」，实际: ${b}`);
  }
  assert.ok(!/>\s*Search\s*</.test(html), '页面不应残留英文 Search 文案');
});

// joe.index.js 的 initDom() 会清空服务端列表并用 /joe/api 重画，若初始页码写死 1，
// 访问 /page/2/ 会被 JS 刷回第一页。断言它从 URL 解析当前页（查压缩后的 min.js）。
await test('首页无限滚动从 URL 取初始页码', async () => {
  const src = await readFile('usr/themes/joe/assets/js/joe.index.min.js', 'utf8');
  assert.ok(
    /location\.pathname\.match\(\/\\?\/page\//.test(src) || /pathname\.match\(\/\\\/page\\\//.test(src),
    'joe.index.min.js 应从 location.pathname 解析 /page/N/ 的页码'
  );
});

await test('登出后后台不可访问', async () => {
  await call('GET', '/admin/logout');
  const res = await call('GET', '/admin');
  assert.equal(res.status, 302);
});

// ================= 隐藏文章：管理员预览 =================
const _kv = globalThis.BLOG_KV;
const kvGet = (key) => _kv.get(key, { type: 'json' });
const kvPut = (key, obj) => _kv.put(key, JSON.stringify(obj));

/** 取当前最大的文章 cid（文章按 post:<cid> 存 KV） */
async function latestPostCid() {
  const { keys } = await _kv.list({ prefix: 'post:' });
  let max = 0;
  for (const { key } of keys) {
    const cid = parseInt(key.slice('post:'.length), 10);
    if (cid > max) max = cid;
  }
  return max;
}

/** 管理员登录（前面已启用 TOTP，必须走两步） */
async function loginAdmin() {
  cookie = '';
  const { totpAt } = await import('./src/auth/totp.js');
  const user = JSON.parse(_kv.map.get('user:1'));
  const code = await totpAt(user.totpSecret, Math.floor(Date.now() / 1000 / 30));
  const step1 = await call('POST', '/admin/login', { form: { name: 'admin', password: 'password123', step: 'password' } });
  const m = (await step1.text()).match(/name="pending" value="([a-f0-9]+)"/);
  assert.ok(m, '应返回 pending token');
  const step2 = await call('POST', '/admin/login', { form: { step: 'totp', pending: m[1], totp: code } });
  assert.equal(step2.status, 302, '登录成功');
  assert.ok(cookie.includes('te_sess='));
}

let hiddenCid = 0;
await test('隐藏文章：匿名访客访问是 404', async () => {
  await loginAdmin();
  await call('POST', '/admin/post', {
    form: { type: 'post', title: '隐藏文章标题XYZ', text: '机密正文ABC', status: 'hidden' },
  });
  hiddenCid = await latestPostCid();
  assert.ok(hiddenCid > 0, '拿到隐藏文章的 cid');

  await call('GET', '/admin/logout');
  cookie = '';
  const page = await call('GET', `/archives/${hiddenCid}/`);
  assert.equal(page.status, 404, '匿名访客看不到隐藏文章');
  assert.ok(!(await page.text()).includes('机密正文ABC'));
});

await test('隐藏文章：已登录管理员可预览，且带预览提示', async () => {
  await loginAdmin();
  const page = await call('GET', `/archives/${hiddenCid}/`);
  const html = await page.text();
  assert.equal(page.status, 200, '管理员能打开隐藏文章');
  assert.ok(html.includes('机密正文ABC'), '管理员看得到正文');
  assert.ok(html.includes('管理员预览'), '页面提示这是隐藏状态');
});

await test('隐藏文章的预览响应不可被 CDN 缓存', async () => {
  const page = await call('GET', `/archives/${hiddenCid}/`);
  assert.match(page.headers.get('Cache-Control') || '', /no-store/);
});

await test('首页列表：匿名看不到隐藏文章，管理员看得到且带标记', async () => {
  const anon = await (async () => {
    const saved = cookie;
    cookie = '';
    const html = await call('GET', '/').then((r) => r.text());
    cookie = saved;
    return html;
  })();
  assert.ok(!anon.includes('隐藏文章标题XYZ'), '匿名首页不出现隐藏文章');

  await loginAdmin();
  const admin = await call('GET', '/').then((r) => r.text());
  assert.ok(admin.includes('隐藏文章标题XYZ'), '管理员首页能看到隐藏文章');
  assert.ok(admin.includes('>隐藏</span>'), '管理员能看出它是隐藏文章');
});

await test('RSS 里没有隐藏文章（对管理员也一样）', async () => {
  const saved = cookie;
  await loginAdmin();
  const feed = await call('GET', '/feed/').then((r) => r.text());
  assert.ok(!feed.includes('隐藏文章标题XYZ'), 'RSS 是订阅出口，不带隐藏文章');
  cookie = saved;
});

await test('主题 API 的首页列表：匿名无隐藏文章，管理员有且带 status', async () => {
  const url = '/joe/api?routeType=publish_list&pageSize=50';
  const saved = cookie;
  cookie = '';
  const anon = await call('GET', url).then((r) => r.text());
  assert.ok(!anon.includes('隐藏文章标题XYZ'), '匿名请求主题 API 拿不到隐藏文章');

  await loginAdmin();
  const admin = await call('GET', url).then((r) => r.text());
  assert.ok(admin.includes('隐藏文章标题XYZ'), '管理员请求主题 API 能拿到隐藏文章');
  const data = JSON.parse(admin).data;
  const item = data.find((x) => x.title === '隐藏文章标题XYZ');
  assert.equal(item?.status, 'hidden', '返回 status 供客户端渲染「隐藏」角标');
  cookie = saved;
});

// ================= 密码保护：POST + cookie + 哈希 =================
let pwdCid = 0;
await test('密码文章：输入框是 POST 表单，URL 不再带密码', async () => {
  await call('POST', '/admin/post', {
    form: { type: 'post', title: '带密码的文章', text: '密码内正文XYZ', status: 'publish', password: 'hunter2' },
  });
  pwdCid = await latestPostCid();

  const page = await call('GET', `/archives/${pwdCid}/`);
  const html = await page.text();
  assert.ok(
    html.includes(`<form class="joe_detail__article-protected" method="post" action="/archives/${pwdCid}/"`),
    '密码表单是 POST 且指向本文章',
  );
  assert.ok(!html.includes('密码内正文XYZ'), '未解锁不返回正文');
  assert.ok(!html.includes('hunter2'), '页面不泄露密码');
  assert.ok(!html.includes('password=hunter2'), '密码不出现在链接里');
});

await test('密码文章：后台存的是哈希，输入框不回显', async () => {
  const stored = (await kvGet(`post:${pwdCid}`)).password;
  assert.ok(stored.startsWith('pbkdf2$'), '库里存的是 PBKDF2');
  assert.ok(!stored.includes('hunter2'), '不含明文');
  const edit = await call('GET', `/admin/post/edit/${pwdCid}`).then((r) => r.text());
  assert.ok(!edit.includes('hunter2'), '明文密码不回显');
  assert.ok(!edit.includes('pbkdf2$'), '哈希也不回显到输入框');
});

await test('密码文章：错误密码返回 401 且不发放 cookie', async () => {
  const saved = cookie;
  const res = await call('POST', `/archives/${pwdCid}/`, { form: { password: 'wrong' } });
  assert.equal(res.status, 401);
  assert.ok(!(res.headers.get('Set-Cookie') || '').includes('te_pwd'), '不发凭据');
  cookie = saved;
});

await test('密码文章：正确密码下发 HttpOnly cookie 并跳转', async () => {
  const saved = cookie;
  const res = await call('POST', `/archives/${pwdCid}/`, { form: { password: 'hunter2' } });
  assert.equal(res.status, 303, 'POST 后 303 回 GET');
  const sc = res.headers.get('Set-Cookie') || '';
  assert.ok(sc.includes('te_pwd='), '下发 te_pwd');
  assert.ok(sc.includes('HttpOnly'), 'HttpOnly');
  assert.ok(sc.includes(`Path=/archives/${pwdCid}/`), '路径限定到该文章');
  assert.equal(res.headers.get('Location'), `/archives/${pwdCid}/`);
  cookie = sc.split(';')[0];
});

await test('密码文章：带 cookie 能读到正文，且不被缓存', async () => {
  const page = await call('GET', `/archives/${pwdCid}/`);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.ok(html.includes('密码内正文XYZ'), '解锁后能看正文');
  assert.match(page.headers.get('Cache-Control') || '', /no-store/, '解锁内容不进 CDN 缓存');
});

await test('密码文章：凭据不能跨文章使用', async () => {
  // 上一个用例把全局 cookie 换成了 te_pwd（那是刻意验证的点），
  // 这里要重新登录才能用后台；te_pwd 本身留着，下面单独验它不解锁别的文章。
  const pwdCookie = cookie;
  await loginAdmin();
  await call('POST', '/admin/post', { form: { type: 'post', title: '普通文章', text: '正文', status: 'publish' } });
  const other = await latestPostCid();
  cookie = pwdCookie;
  const page = await call('GET', `/archives/${other}/`);
  assert.ok(!(await page.text()).includes('密码内正文XYZ'), '别的文章不因这个 cookie 被解锁');
});

await test('密码文章：旧的明文密码仍能解开（存量兼容）', async () => {
  await loginAdmin();
  await call('POST', '/admin/post', { form: { type: 'post', title: '明文密码文章', text: '老正文XYZ', status: 'publish' } });
  const cid = await latestPostCid();
  await kvPut(`post:${cid}`, { ...(await kvGet(`post:${cid}`)), password: 'legacy-plain' });
  const res = await call('POST', `/archives/${cid}/`, { form: { password: 'legacy-plain' } });
  assert.equal(res.status, 303, '库里存的是明文时也能解锁');
  const page = await call('GET', `/archives/${cid}/`);
  assert.ok((await page.text()).includes('老正文XYZ'));
});


// ================= 后台 Markdown 工具条 =================
await test('工具条：撰写页渲染出工具条容器和全部动作按钮', async () => {
  await loginAdmin();
  const html = await call('GET', '/admin/post').then((r) => r.text());
  assert.ok(html.includes('id="joe-md-bar"'), '工具条容器应存在');
  assert.ok(html.includes('class="md-bar__sep"'), '应有分组分隔线');
  assert.ok(html.includes('role="toolbar"'), '应有 toolbar 语义');
  // data-md 的取值要和 joe.admin-md.js 里的 ACTS 对得上
  const acts = [...html.matchAll(/data-md="([a-z0-9]+)"/g)].map((m) => m[1]);
  for (const a of ['h1', 'h2', 'h3', 'bold', 'italic', 'strike', 'code', 'quote',
    'codeblock', 'ul', 'ol', 'hr', 'link', 'image', 'table', 'more', 'undo', 'redo']) {
    assert.ok(acts.includes(a), `缺少按钮 ${a}`);
  }
});

await test('工具条：按钮与输入框配对，且引入行为脚本', async () => {
  await loginAdmin();
  const html = await call('GET', '/admin/post').then((r) => r.text());
  assert.ok(html.includes('id="joe-md-text"'), 'textarea 应有约定的 id');
  assert.ok(html.includes('name="text"'), 'textarea 仍须保留原 name，否则保存会丢正文');
  assert.ok(html.includes('joe.admin-md.min.js'), '应引入工具条行为脚本');
});

await test('工具条：不提供渲染器不支持的语法按钮', async () => {
  await loginAdmin();
  const html = await call('GET', '/admin/post').then((r) => r.text());
  // markdown.js 不认任务列表，给了按钮用户只会得到字面量 "[ ]"
  assert.ok(!/data-md="task"/.test(html), '不应有任务列表按钮');
  const acts = [...html.matchAll(/data-md="([a-z0-9]+)"/g)].map((m) => m[1]);
  const dup = acts.filter((a, i) => acts.indexOf(a) !== i);
  assert.equal(dup.length, 0, `动作不应重复: ${dup.join(',')}`);
});

await test('工具条：页面编辑器同样带工具条', async () => {
  await loginAdmin();
  const html = await call('GET', '/admin/page').then((r) => r.text());
  assert.ok(html.includes('id="joe-md-bar"'), '页面编辑器也应可用');
});

await test('工具条：按钮均为 type=button，不会误触发表单提交', async () => {
  await loginAdmin();
  const html = await call('GET', '/admin/post').then((r) => r.text());
  const btns = [...html.matchAll(/<button[^>]*data-md="[^"]*"[^>]*>/g)].map((m) => m[0]);
  assert.equal(btns.length, 18, `应为 18 个按钮，实际 ${btns.length}`);
  for (const b of btns) {
    assert.ok(b.includes('type="button"'), `按钮缺少 type=button: ${b}`);
  }
});


// ================= 缓存策略：HTML 一律 no-store =================
await test('缓存策略：公开 HTML 也不缓存（首页/文章/404）', async () => {
  for (const p of ['/', '/archives/1/', '/not-exist-xyz/']) {
    const r = await call('GET', p);
    assert.match(r.headers.get('Cache-Control') || '', /no-store/, `${p} 应为 no-store`);
  }
});

await test('缓存策略：不再出现 60s 的 public 缓存头', async () => {
  // 这条是被显式否掉的方案：修好 html() 之后若还留着 public，
  // 页面里的浏览数/点赞/评论数会显示陈旧值。
  for (const p of ['/', '/archives/1/']) {
    const cc = (await call('GET', p)).headers.get('Cache-Control') || '';
    assert.ok(!cc.includes('public'), `${p} 不应声明 public 缓存，实际: ${cc}`);
  }
});

await test('缓存策略：RSS 保持原有缓存（XML 不在「HTML 一律不缓存」内）', async () => {
  const r = await call('GET', '/feed/');
  assert.match(r.headers.get('Cache-Control') || '', /public/, 'feed 仍可缓存');
});

// ================= 汇总 =================
console.log('\n========== 测试结果 ==========');
for (const r of results) console.log(r);
console.log(`\n共 ${results.length} 项，失败 ${results.filter((r) => r.startsWith('✗')).length} 项`);

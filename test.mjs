/**
 * 本地集成测试：模拟 EdgeOne Edge Function 运行时
 * - 用内存 Map 模拟 KV 绑定
 * - 直接 import 打包前的源码（src/main.js）验证安装→发文→浏览→评论→TOTP 全流程
 *
 * 运行：node test.mjs
 */
import assert from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';

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
  assert.ok(html.includes('class="submit">Search</button>'), '缺少 .submit 按钮');
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
  const scripts = [...html.matchAll(/<script src="([^"]*joe\.global[^"]*)"><\/script>/g)].map((m) => m[1]);
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
  const src = [...html.matchAll(/<script src="([^"]*joe\.global[^"]*)"><\/script>/g)];
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
  // 侧栏在左：order:-1 + flex 固定宽度，正文 flex:1
  assert.ok(/\.joe_body\s*\{[^}]*display:\s*flex/.test(css), 'joe_body 未启用 flex');
  assert.ok(/\.joe_body > \.joe_aside\s*\{[^}]*order:\s*-1/.test(css), '侧栏未置于左侧');
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

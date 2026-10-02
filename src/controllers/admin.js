/**
 * 后台管理 —— /admin
 * 包含：登录（密码 + TOTP 两步验证）、仪表盘、文章/页面管理、
 *       分类/标签、评论管理、附件上传（Blob）、站点与主题设置、安全设置（TOTP）
 */
import { verifyPassword } from '../auth/password.js';
import { currentUser, sessionCookie, clearSessionCookie, parseCookies, sameOrigin } from '../auth/session.js';
import { CONFIG } from '../config.js';
import { escapeHtml as esc, renderMarkdown, plainExcerpt } from '../render/markdown.js';
import { generateTotpSecret, verifyTotp, otpauthUri, totpQrSvg } from '../auth/totp.js';
import { JOE_DEFAULTS } from '../render/theme-joe.js';

/**
 * 登录失败限流 —— 按「用户名 + 客户端 IP」维度计数。
 * 连续失败达到阈值后锁定一段时间，防止在线爆破。
 */
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function clientIp(request) {
  const cf = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')
    || request.headers.get('x-real-ip');
  if (cf) return String(cf).split(',')[0].trim();
  return 'unknown';
}

async function loginThrottleKey(db, request, name) {
  const ip = clientIp(request);
  const raw = `${name || ''}|${ip}`;
  // 简单哈希，避免把原始 IP 作为 KV key 暴露
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
  return `login_fail:${h.toString(16)}`;
}

async function checkLoginLocked(db, request, name) {
  const key = await loginThrottleKey(db, request, name);
  const rec = await db.kv.getJSON(key);
  if (!rec || !rec.count) return { locked: false, key };
  if (Date.now() - (rec.at || 0) > LOGIN_WINDOW_MS) {
    await db.kv.delete(key);
    return { locked: false, key };
  }
  return { locked: rec.count >= LOGIN_MAX_ATTEMPTS, key, count: rec.count };
}

async function recordLoginFailure(db, key) {
  const rec = (await db.kv.getJSON(key)) || { count: 0, at: Date.now() };
  if (Date.now() - (rec.at || 0) > LOGIN_WINDOW_MS) {
    rec.count = 0;
    rec.at = Date.now();
  }
  rec.count = (rec.count || 0) + 1;
  rec.at = Date.now();
  await db.kv.putJSON(key, rec);
  return rec.count;
}

async function clearLoginFailures(db, key) {
  await db.kv.delete(key);
}

export async function handleAdmin(ctx) {
  const { db, request, url, path } = ctx;
  const sub = path.slice('/admin'.length).replace(/^\/+|\/+$/g, '') || '';

  // ---- 未安装 ----
  if (!(await db.isInstalled())) {
    return Response.redirect(new URL('/install', url).href, 302);
  }

  // ---- 登录/登出 ----
  if (sub === 'login' || sub === 'login/') {
    if (request.method === 'POST') return doLogin(ctx);
    return loginPage(ctx);
  }
  if (sub === 'logout') {
    const auth = await currentUser(db, request);
    if (auth) await db.deleteSession(auth.token);
    return new Response(null, { status: 302, headers: { Location: '/admin/login', 'Set-Cookie': clearSessionCookie() } });
  }

  // ---- 以下均需登录 ----
  const auth = await currentUser(db, request);
  if (!auth) {
    return Response.redirect(new URL('/admin/login', url).href, 302);
  }
  const user = auth.user;
  ctx.user = user;

  if (request.method === 'POST') {
    if (!sameOrigin(request)) return json({ ok: 0, msg: '非法来源' }, 403);
    if (sub === 'post' || sub === 'post/') return savePost(ctx);
    if (sub === 'delete') return deletePost(ctx);
    if (sub === 'meta') return saveMeta(ctx);
    if (sub === 'meta-delete') return deleteMeta(ctx);
    if (sub === 'comment') return commentAction(ctx);
    if (sub === 'upload') return uploadFile(ctx);
    if (sub === 'settings') return saveSettings(ctx);
    if (sub === 'security') return securityAction(ctx);
  }

  switch (true) {
    case sub === '': return dashboard(ctx);
    case sub === 'posts': return postsList(ctx);
    case sub === 'post': return postEditor(ctx, 'post');
    case sub === 'pages': return pagesList(ctx);
    case sub === 'page': return postEditor(ctx, 'page');
    case sub === 'metas': return metasPage(ctx);
    case sub === 'comments': return commentsPage(ctx);
    case sub === 'uploads': return uploadsPage(ctx);
    case sub === 'settings': return settingsPage(ctx);
    case sub === 'security': return securityPage(ctx);
    default: return Response.redirect(new URL('/admin', url).href, 302);
  }
}

/* ==================== 登录 ==================== */

function loginPage(ctx, { error = '', totp = false, pendingToken = '', name = '' } = {}) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>登录 - ${esc(ctx.options.title)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}body{font-family:'PingFang SC','Microsoft YaHei',sans-serif;background:#f4f5f7;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#fff;border-radius:12px;box-shadow:0 2px 20px rgba(0,0,0,.08);max-width:400px;width:100%;padding:40px}
    h1{font-size:20px;color:#24292f;margin-bottom:24px;text-align:center}
    .item{margin-bottom:14px}
    label{display:block;font-size:13px;color:#24292f;margin-bottom:6px;font-weight:600}
    input{width:100%;padding:10px 12px;border:1px solid #d0d7de;border-radius:6px;font-size:14px;outline:none}
    input:focus{border-color:#0969da;box-shadow:0 0 0 3px rgba(9,105,218,.15)}
    button{width:100%;padding:12px;background:#1a1f24;color:#fff;border:0;border-radius:6px;font-size:15px;cursor:pointer;margin-top:8px}
    button:hover{background:#30363d}
    .err{background:#ffebe9;color:#cf222e;border:1px solid #ffcecb;border-radius:6px;padding:10px 12px;font-size:13px;margin-bottom:16px}
    .tip{font-size:12px;color:#8b949e;margin-top:14px;text-align:center}
  </style></head><body>
  <div class="card">
    <h1>${esc(ctx.options.title)}</h1>
    ${error ? `<div class="err">${esc(error)}</div>` : ''}
    ${totp ? `<form method="post" action="/admin/login">
      <input type="hidden" name="pending" value="${esc(pendingToken)}">
      <div class="item"><label>两步验证码（TOTP）</label>
      <input type="text" name="totp" placeholder="6 位动态码" autocomplete="one-time-code" autofocus required pattern="\\d{6}"></div>
      <button type="submit" name="step" value="totp">验证</button>
    </form>` : `<form method="post" action="/admin/login">
      <div class="item"><label>用户名</label><input type="text" name="name" value="${esc(name)}" required autofocus></div>
      <div class="item"><label>密码</label><input type="password" name="password" required></div>
      <button type="submit" name="step" value="password">登录</button>
    </form>`}
    <div class="tip">TypechoEdge on EdgeOne · 安全登录</div>
  </div></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function doLogin(ctx) {
  const { db, request, url } = ctx;
  const form = await request.formData();
  const step = form.get('step');

  if (step === 'totp') {
    // 第二步：验证 TOTP
    const pending = String(form.get('pending') || '');
    const code = String(form.get('totp') || '');
    const p = await db.kv.getJSON(`pending:${pending}`);
    if (!p || p.exp < Date.now()) return loginPage(ctx, { error: '会话已过期，请重新登录' });
    const user = await db.getUser(p.uid);
    if (!user || !user.totpEnabled) return loginPage(ctx, { error: '两步验证未启用' });
    if (!(await verifyTotp(user.totpSecret, code))) {
      return loginPage(ctx, { error: '验证码错误，请重试', totp: true, pendingToken: pending });
    }
    await db.kv.delete(`pending:${pending}`);
    const token = await db.createSession(user.uid, CONFIG.SESSION_TTL);
    await db.updateUser(user.uid, { logged: Math.floor(Date.now() / 1000) });
    return new Response(null, {
      status: 302,
      headers: { Location: '/admin', 'Set-Cookie': sessionCookie(token) },
    });
  }

  // 第一步：密码
  const name = String(form.get('name') || '').trim();
  const password = String(form.get('password') || '');

  // 限流检查：失败过多时拒绝本次尝试
  const throttle = await checkLoginLocked(db, request, name);
  if (throttle.locked) {
    const mins = Math.ceil(LOGIN_LOCK_MS / 60000);
    return loginPage(ctx, { error: `尝试次数过多，请 ${mins} 分钟后再试`, name });
  }

  const user = (await db.getUserByName(name)) || (await db.getUserByMail(name));
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    const n = await recordLoginFailure(db, throttle.key);
    const left = Math.max(0, LOGIN_MAX_ATTEMPTS - n);
    const extra = left > 0 ? `（还可尝试 ${left} 次）` : '';
    return loginPage(ctx, { error: `用户名或密码错误${extra}`, name });
  }
  // 登录成功，清除失败计数
  await clearLoginFailures(db, throttle.key);
  if (user.totpEnabled && user.totpSecret) {
    // 进入 TOTP 二次验证
    const { randomHex } = await import('../auth/password.js');
    const pending = randomHex(24);
    await db.kv.putJSON(`pending:${pending}`, { uid: user.uid, exp: Date.now() + 5 * 60 * 1000 });
    return loginPage(ctx, { totp: true, pendingToken: pending });
  }
  const token = await db.createSession(user.uid, CONFIG.SESSION_TTL);
  await db.updateUser(user.uid, { logged: Math.floor(Date.now() / 1000) });
  return new Response(null, {
    status: 302,
    headers: { Location: '/admin', 'Set-Cookie': sessionCookie(token) },
  });
}

/* ==================== 布局 ==================== */

function adminLayout(ctx, { title, active = '', body = '' }) {
  const menus = [
    ['', '仪表盘', 'fa-home'],
    ['posts', '管理文章', 'fa-file-text'],
    ['post?type=post', '撰写文章', 'fa-pencil'],
    ['pages', '管理页面', 'fa-files-o'],
    ['page', '创建页面', 'fa-plus'],
    ['metas', '分类/标签', 'fa-folder'],
    ['comments', '评论管理', 'fa-comments'],
    ['uploads', '附件管理', 'fa-image'],
    ['settings', '站点设置', 'fa-cog'],
    ['security', '安全设置', 'fa-shield'],
    ['login', '查看站点', 'fa-external-link'],
    ['logout', '退出登录', 'fa-sign-out'],
  ];
  const menu = menus
    .map(([slug, label, icon]) => {
      const href = slug === 'login' ? '/' : `/admin/${slug}`;
      const cls = active === slug ? ' class="active"' : '';
      return `<a${cls} href="${href}"><i class="fa ${icon}" aria-hidden="true"></i>${label}</a>`;
    })
    .join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - ${esc(ctx.options.title)}</title>
  <link rel="stylesheet" href="/usr/themes/joe/assets/lib/font-awesome@4.7.0/font-awesome.min.css">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'PingFang SC','Microsoft YaHei',sans-serif;background:#f4f5f7;color:#24292f}
    .layout{display:flex;min-height:100vh}
    .side{width:220px;background:#1a1f24;color:#c9d1d9;padding:20px 0;flex-shrink:0}
    .side .brand{padding:0 20px 20px;font-size:16px;font-weight:700;color:#fff;border-bottom:1px solid #30363d;margin-bottom:12px}
    .side .brand small{display:block;font-size:11px;color:#8b949e;font-weight:400;margin-top:4px}
    .side a{display:block;padding:11px 20px;color:#c9d1d9;text-decoration:none;font-size:14px}
    .side a:hover{background:#30363d;color:#fff}
    .side a.active{background:#0969da;color:#fff}
    .side a i{width:22px;margin-right:8px}
    .main{flex:1;padding:28px 36px;max-width:1200px}
    h2{font-size:20px;margin-bottom:20px}
    .card{background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.06);padding:24px;margin-bottom:20px}
    table{width:100%;border-collapse:collapse;font-size:14px}
    th{text-align:left;padding:10px 12px;border-bottom:2px solid #eaeef2;color:#57606a;font-size:13px}
    td{padding:10px 12px;border-bottom:1px solid #eaeef2}
    tr:hover td{background:#f6f8fa}
    .btn{display:inline-block;padding:8px 16px;background:#1a1f24;color:#fff;border-radius:6px;text-decoration:none;font-size:13px;border:0;cursor:pointer}
    .btn:hover{background:#30363d}
    .btn.primary{background:#0969da}.btn.primary:hover{background:#0860c4}
    .btn.danger{background:#cf222e}.btn.danger:hover{background:#a40e26}
    .btn.sm{padding:4px 10px;font-size:12px}
    .item{margin-bottom:16px}
    label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}
    input[type=text],input[type=password],input[type=email],input[type=number],input[type=file],select,textarea{width:100%;max-width:520px;padding:9px 12px;border:1px solid #d0d7de;border-radius:6px;font-size:14px;outline:none;font-family:inherit}
    textarea{min-height:120px;resize:vertical}
    input:focus,textarea:focus,select:focus{border-color:#0969da;box-shadow:0 0 0 3px rgba(9,105,218,.12)}
    .row{display:flex;gap:14px;flex-wrap:wrap}
    .row .item{flex:1;min-width:220px}
    .hint{font-size:12px;color:#8b949e;margin-top:6px}
    .msg{padding:12px 16px;border-radius:6px;margin-bottom:18px;font-size:14px}
    .msg.ok{background:#dafbe1;color:#116329;border:1px solid #4ac26b}
    .msg.err{background:#ffebe9;color:#cf222e;border:1px solid #ffcecb}
    .stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px;margin-bottom:20px}
    .stat{background:#fff;border-radius:10px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.06)}
    .stat .num{font-size:26px;font-weight:700}
    .stat .label{font-size:12px;color:#57606a;margin-top:4px}
    .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;background:#eaeef2;color:#57606a}
    .badge.green{background:#dafbe1;color:#116329}.badge.yellow{background:#fff8c5;color:#4d2d00}
    a{color:#0969da}
  </style></head><body>
  <div class="layout">
    <nav class="side">
      <div class="brand">${esc(ctx.options.title)}<small>TypechoEdge v${CONFIG.VERSION}</small></div>
      ${menu}
    </nav>
    <main class="main">${body}</main>
  </div></body></html>`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const MSG = (ctx) => {
  const t = ctx.url.searchParams.get('msg');
  if (t === 'ok') return `<div class="msg ok">操作成功</div>`;
  if (t === 'err') return `<div class="msg err">操作失败</div>`;
  if (t === 'saved') return `<div class="msg ok">已保存</div>`;
  return '';
};

/* ==================== 仪表盘 ==================== */

async function dashboard(ctx) {
  const { db, user } = ctx;
  const posts = await db.listContents({ type: 'post', pageSize: 1, allStatus: true });
  const pages = await db.listContents({ type: 'page', pageSize: 1, allStatus: true });
  const comments = await db.listAllComments({ pageSize: 1 });
  const waiting = await db.listAllComments({ status: 'waiting', pageSize: 1 });
  const cats = await db.listMetas('category');
  const tags = await db.listMetas('tag');
  const body = `${MSG(ctx)}
  <h2>仪表盘</h2>
  <div class="stats">
    <div class="stat"><div class="num">${posts.total}</div><div class="label">文章</div></div>
    <div class="stat"><div class="num">${pages.total}</div><div class="label">页面</div></div>
    <div class="stat"><div class="num">${comments.total}</div><div class="label">评论</div></div>
    <div class="stat"><div class="num">${waiting.total}</div><div class="label">待审评论</div></div>
    <div class="stat"><div class="num">${cats.length}</div><div class="label">分类</div></div>
    <div class="stat"><div class="num">${tags.length}</div><div class="label">标签</div></div>
  </div>
  <div class="card">
    <h2 style="font-size:16px;margin-bottom:14px">快捷操作</h2>
    <p style="font-size:14px;line-height:2.2">
      <a class="btn primary" href="/admin/post?type=post">撰写新文章</a>
      <a class="btn" href="/admin/page">创建新页面</a>
      <a class="btn" href="/admin/uploads">上传附件</a>
      <a class="btn" href="/admin/settings">站点设置</a>
      <a class="btn" href="/admin/security">两步验证 ${user.totpEnabled ? '<span class="badge green">已开启</span>' : '<span class="badge yellow">未开启</span>'}</a>
      <a class="btn" href="/" target="_blank">查看站点</a>
    </p>
  </div>`;
  return html(adminLayout(ctx, { title: '仪表盘', active: '', body }));
}

/* ==================== 文章/页面 ==================== */

async function postsList(ctx) {
  const { db, url } = ctx;
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const list = await db.listContents({ type: 'post', page, pageSize: 20, allStatus: true });
  const rows = list.items
    .map(
      (p) => `<tr>
    <td>${p.cid}</td>
    <td><a href="/archives/${p.cid}/" target="_blank">${esc(p.title)}</a></td>
    <td><span class="badge ${p.status === 'publish' ? 'green' : p.status === 'hidden' ? 'yellow' : ''}">${p.status === 'publish' ? '公开' : p.status === 'hidden' ? '隐藏' : p.status}</span></td>
    <td>${p.commentsNum || 0}</td>
    <td>${new Date(p.created * 1000).toLocaleString('zh-CN')}</td>
    <td>
      <a class="btn sm" href="/admin/post?cid=${p.cid}">编辑</a>
      <form method="post" action="/admin/delete" style="display:inline" onsubmit="return confirm('确定删除该文章？')">
        <input type="hidden" name="cid" value="${p.cid}">
        <button class="btn sm danger" type="submit">删除</button>
      </form>
    </td>
  </tr>`
    )
    .join('');
  const pager = list.pages > 1
    ? `<p class="hint">第 ${list.page} / ${list.pages} 页
      ${list.page > 1 ? `<a href="?page=${list.page - 1}">上一页</a>` : ''}
      ${list.page < list.pages ? `<a href="?page=${list.page + 1}">下一页</a>` : ''}</p>`
    : '';
  const body = `${MSG(ctx)}
  <h2>管理文章（${list.total}）</h2>
  <div class="card">
    <table><thead><tr><th>ID</th><th>标题</th><th>状态</th><th>评论</th><th>发布时间</th><th>操作</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6">暂无文章</td></tr>'}</tbody></table>
    ${pager}
  </div>`;
  return html(adminLayout(ctx, { title: '管理文章', active: 'posts', body }));
}

async function pagesList(ctx) {
  const { db } = ctx;
  const list = await db.listContents({ type: 'page', pageSize: 100, allStatus: true });
  const rows = list.items
    .map(
      (p) => `<tr>
    <td>${p.cid}</td>
    <td><a href="/${p.slug}/" target="_blank">${esc(p.title)}</a></td>
    <td><code>/${p.slug}/</code></td>
    <td><span class="badge ${p.status === 'publish' ? 'green' : ''}">${p.status === 'publish' ? '公开' : p.status}</span></td>
    <td>
      <a class="btn sm" href="/admin/page?cid=${p.cid}">编辑</a>
      <form method="post" action="/admin/delete" style="display:inline" onsubmit="return confirm('确定删除该页面？')">
        <input type="hidden" name="cid" value="${p.cid}">
        <button class="btn sm danger" type="submit">删除</button>
      </form>
    </td>
  </tr>`
    )
    .join('');
  const body = `${MSG(ctx)}
  <h2>管理页面（${list.total}）</h2>
  <div class="card">
    <table><thead><tr><th>ID</th><th>标题</th><th>路径</th><th>状态</th><th>操作</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5">暂无页面</td></tr>'}</tbody></table>
  </div>`;
  return html(adminLayout(ctx, { title: '管理页面', active: 'pages', body }));
}

async function postEditor(ctx, kind) {
  const { db, url, user } = ctx;
  const cid = parseInt(url.searchParams.get('cid') || '0', 10);
  let post = null;
  if (cid) post = await db.getContent(cid);
  const isNew = !post;
  const isPage = kind === 'page' || post?.type === 'page';
  const cats = await db.listMetas('category');
  const tags = await db.listMetas('tag');
  const postTagNames = post
    ? await Promise.all((post.tags || []).map(async (mid) => (await db.getMeta(mid))?.name).filter(Boolean)).then((a) => a.join(','))
    : '';

  const catChecks = cats
    .map(
      (c) => `<label style="font-weight:400;display:inline-flex;align-items:center;margin-right:14px;gap:4px">
      <input type="checkbox" name="categories" value="${c.mid}" ${post?.categories?.includes(c.mid) ? 'checked' : ''}> ${esc(c.name)}</label>`
    )
    .join('');

  const body = `${MSG(ctx)}
  <h2>${isNew ? (isPage ? '创建页面' : '撰写文章') : `编辑：${esc(post.title)}`}</h2>
  <div class="card">
  <form method="post" action="/admin/post">
    ${cid ? `<input type="hidden" name="cid" value="${cid}">` : ''}
    <input type="hidden" name="type" value="${isPage ? 'page' : 'post'}">
    <div class="item"><label>标题</label><input type="text" name="title" value="${esc(post?.title || '')}" required></div>
    ${isPage
      ? `<div class="item"><label>缩略名（URL 路径）</label><input type="text" name="slug" value="${esc(post?.slug || '')}" placeholder="about" pattern="[a-zA-Z0-9_-]+"><div class="hint">访问路径 /缩略名/，留空自动生成</div></div>`
      : ''}
    <div class="item"><label>内容（支持 Markdown，<!--more--> 之前为摘要）</label>
      <textarea name="text" style="min-height:320px;font-family:Consolas,monospace">${esc(post?.text || '')}</textarea></div>
    <div class="row">
      <div class="item"><label>状态</label>
        <select name="status">
          <option value="publish" ${post?.status !== 'hidden' ? 'selected' : ''}>公开</option>
          <option value="hidden" ${post?.status === 'hidden' ? 'selected' : ''}>隐藏</option>
        </select></div>
      ${isPage ? '' : `<div class="item"><label>访问密码（可选）</label><input type="text" name="password" value="${esc(post?.password || '')}" placeholder="留空不加密"></div>`}
      <div class="item"><label>允许评论</label>
        <select name="allowComment">
          <option value="1" ${post?.allowComment !== false ? 'selected' : ''}>允许</option>
          <option value="0" ${post?.allowComment === false ? 'selected' : ''}>禁止</option>
        </select></div>
    </div>
    ${isPage ? '' : `<div class="item"><label>所属分类</label><div>${catChecks || '<span class="hint">暂无分类，可先在「分类/标签」中创建</span>'}</div></div>
    <div class="item"><label>标签（逗号分隔，自动创建）</label><input type="text" name="tags" value="${esc(postTagNames)}" placeholder="生活, 技术"></div>`}
    <div class="item"><label>自定义字段</label>
      <div class="row">
        <div class="item"><input type="text" name="field_thumb" value="${esc(post?.fields?.thumb || '')}" placeholder="缩略图 URL（thumb）"></div>
        <div class="item"><input type="text" name="field_abstract" value="${esc(post?.fields?.abstract || '')}" placeholder="摘要（abstract）"></div>
        <div class="item"><input type="text" name="field_mode" value="${esc(post?.fields?.mode || '')}" placeholder="特殊模式（mode，如 links）"></div>
      </div>
      <div class="hint">Joe 主题扩展字段：thumb=封面图、abstract=列表摘要、keywords/description=SEO、mode=links 时正文渲染为友链页</div>
    </div>
    <button class="btn primary" type="submit">${isNew ? '发布' : '保存修改'}</button>
    <a class="btn" href="/admin/${isPage ? 'pages' : 'posts'}">返回列表</a>
  </form>
  </div>`;
  return html(adminLayout(ctx, { title: isNew ? '撰写' : '编辑', active: isPage ? 'page' : 'post', body }));
}

async function savePost(ctx) {
  const { db, user, url } = ctx;
  const form = await ctx.request.formData();
  const cid = parseInt(form.get('cid') || '0', 10);
  const type = form.get('type') === 'page' ? 'page' : 'post';
  const title = String(form.get('title') || '').trim() || '未命名';
  const text = String(form.get('text') || '');
  let slug = String(form.get('slug') || '').trim();
  if (type === 'page' && !slug) slug = 'page-' + Date.now().toString(36);

  // 处理分类
  const categories = form.getAll('categories').map(Number).filter(Boolean);
  // 处理标签（按名创建/查找）
  const tags = [];
  for (const rawName of String(form.get('tags') || '').split(/[,，]/)) {
    const name = rawName.trim();
    if (!name) continue;
    let tag = (await db.listMetas('tag')).find((t) => t.name === name);
    if (!tag) tag = await db.createMeta({ name, slug: name, type: 'tag' });
    tags.push(tag.mid);
  }

  const fields = { ...(cid ? (await db.getContent(cid))?.fields || {} : {}) };
  for (const k of ['thumb', 'abstract', 'mode']) {
    const v = String(form.get('field_' + k) || '').trim();
    if (v) fields[k] = v;
    else delete fields[k];
  }

  const data = {
    title,
    slug,
    text,
    type,
    status: form.get('status') === 'hidden' ? 'hidden' : 'publish',
    password: String(form.get('password') || ''),
    allowComment: form.get('allowComment') === '1',
    categories,
    tags,
    fields,
    authorId: user.uid,
  };

  if (cid) {
    await db.updateContent(cid, data);
  } else {
    await db.createContent(data);
  }
  return Response.redirect(new URL(`/admin/${type === 'page' ? 'pages' : 'posts'}?msg=saved`, url).href, 302);
}

async function deletePost(ctx) {
  const { db, url } = ctx;
  const form = await ctx.request.formData();
  const cid = parseInt(form.get('cid') || '0', 10);
  if (cid) await db.deleteContent(cid);
  return Response.redirect(new URL('/admin/posts?msg=ok', url).href, 302);
}

/* ==================== 分类/标签 ==================== */

async function metasPage(ctx) {
  const { db } = ctx;
  const cats = await db.listMetas('category');
  const tags = await db.listMetas('tag');
  const metaTable = (list, type) => `<table><thead><tr><th>名称</th><th>缩略名</th><th>文章数</th><th>操作</th></tr></thead><tbody>
    ${list.map((m) => `<tr>
      <td>${esc(m.name)}</td><td><code>${esc(m.slug)}</code></td><td>${m.count}</td>
      <td>
        <form method="post" action="/admin/meta" style="display:flex;gap:6px">
          <input type="hidden" name="mid" value="${m.mid}">
          <input type="hidden" name="type" value="${type}">
          <input type="text" name="name" value="${esc(m.name)}" style="max-width:140px;padding:5px 8px">
          <button class="btn sm" type="submit">改名</button>
        </form>
        <form method="post" action="/admin/meta-delete" style="display:inline;margin-top:4px" onsubmit="return confirm('确定删除？文章将解除关联')">
          <input type="hidden" name="mid" value="${m.mid}">
          <button class="btn sm danger" type="submit">删除</button>
        </form>
      </td>
    </tr>`).join('') || `<tr><td colspan="4">暂无</td></tr>`}
  </tbody></table>`;

  const body = `${MSG(ctx)}
  <h2>分类 / 标签</h2>
  <div class="row">
    <div class="card" style="flex:1;min-width:340px">
      <h2 style="font-size:16px;margin-bottom:14px">新建</h2>
      <form method="post" action="/admin/meta">
        <div class="row">
          <div class="item"><label>类型</label><select name="type"><option value="category">分类</option><option value="tag">标签</option></select></div>
          <div class="item"><label>名称</label><input type="text" name="name" required></div>
          <div class="item"><label>缩略名（可选）</label><input type="text" name="slug"></div>
        </div>
        <button class="btn primary" type="submit">创建</button>
      </form>
    </div>
    <div class="card" style="flex:1;min-width:340px">
      <h2 style="font-size:16px;margin-bottom:14px">分类（${cats.length}）</h2>
      ${metaTable(cats, 'category')}
    </div>
    <div class="card" style="flex:1;min-width:340px">
      <h2 style="font-size:16px;margin-bottom:14px">标签（${tags.length}）</h2>
      ${metaTable(tags, 'tag')}
    </div>
  </div>`;
  return html(adminLayout(ctx, { title: '分类标签', active: 'metas', body }));
}

async function saveMeta(ctx) {
  const { db, url } = ctx;
  const form = await ctx.request.formData();
  const mid = parseInt(form.get('mid') || '0', 10);
  const name = String(form.get('name') || '').trim();
  const type = form.get('type') === 'tag' ? 'tag' : 'category';
  if (!name) return Response.redirect(new URL('/admin/metas?msg=err', url).href, 302);
  if (mid) {
    await db.updateMeta(mid, { name });
  } else {
    const slug = String(form.get('slug') || '').trim() || name;
    await db.createMeta({ name, slug, type });
  }
  return Response.redirect(new URL('/admin/metas?msg=saved', url).href, 302);
}

async function deleteMeta(ctx) {
  const { db, url } = ctx;
  const form = await ctx.request.formData();
  const mid = parseInt(form.get('mid') || '0', 10);
  if (mid) await db.deleteMeta(mid);
  return Response.redirect(new URL('/admin/metas?msg=ok', url).href, 302);
}

/* ==================== 评论管理 ==================== */

async function commentsPage(ctx) {
  const { db, url } = ctx;
  const status = url.searchParams.get('status') || '';
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const list = await db.listAllComments({ status: status || undefined, page, pageSize: 30 });
  const tabs = `<p style="margin-bottom:14px;font-size:14px">
    <a href="/admin/comments" ${!status ? 'style="font-weight:700"' : ''}>全部</a> ·
    <a href="/admin/comments?status=approved" ${status === 'approved' ? 'style="font-weight:700"' : ''}>已通过</a> ·
    <a href="/admin/comments?status=waiting" ${status === 'waiting' ? 'style="font-weight:700"' : ''}>待审核</a></p>`;
  const rows = list.items
    .map(
      (c) => `<tr>
    <td>${c.coid}</td>
    <td>${esc(c.author)}<br><span class="hint">${esc(c.mail)}</span></td>
    <td style="max-width:420px">${esc(plainExcerpt(c.text, 80))}</td>
    <td><a href="/archives/${c.cid}/#comment-${c.coid}" target="_blank">#${c.cid}</a></td>
    <td><span class="badge ${c.status === 'approved' ? 'green' : 'yellow'}">${c.status === 'approved' ? '已通过' : '待审核'}</span></td>
    <td>${new Date(c.created * 1000).toLocaleString('zh-CN')}</td>
    <td>
      ${c.status === 'waiting' ? `<form method="post" action="/admin/comment" style="display:inline"><input type="hidden" name="coid" value="${c.coid}"><input type="hidden" name="op" value="approve"><button class="btn sm" type="submit">通过</button></form>` : `<form method="post" action="/admin/comment" style="display:inline"><input type="hidden" name="coid" value="${c.coid}"><input type="hidden" name="op" value="waiting"><button class="btn sm" type="submit">转为待审</button></form>`}
      <form method="post" action="/admin/comment" style="display:inline" onsubmit="return confirm('确定删除该评论？')"><input type="hidden" name="coid" value="${c.coid}"><input type="hidden" name="op" value="delete"><button class="btn sm danger" type="submit">删除</button></form>
    </td>
  </tr>`
    )
    .join('');
  const body = `${MSG(ctx)}
  <h2>评论管理（${list.total}）</h2>
  <div class="card">${tabs}
    <table><thead><tr><th>ID</th><th>作者</th><th>内容</th><th>文章</th><th>状态</th><th>时间</th><th>操作</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7">暂无评论</td></tr>'}</tbody></table>
  </div>`;
  return html(adminLayout(ctx, { title: '评论管理', active: 'comments', body }));
}

async function commentAction(ctx) {
  const { db, url } = ctx;
  const form = await ctx.request.formData();
  const coid = parseInt(form.get('coid') || '0', 10);
  const op = form.get('op');
  if (!coid) return Response.redirect(new URL('/admin/comments?msg=err', url).href, 302);
  if (op === 'approve') await db.updateComment(coid, { status: 'approved' });
  else if (op === 'waiting') await db.updateComment(coid, { status: 'waiting' });
  else if (op === 'delete') await db.deleteComment(coid);
  return Response.redirect(new URL('/admin/comments?msg=ok', url).href, 302);
}

/* ==================== 附件 ==================== */

async function uploadsPage(ctx) {
  const { db } = ctx;
  const files = (await db.listContents({ type: 'attachment', pageSize: 200, allStatus: true })).items;
  const rows = files
    .map(
      (f) => `<tr>
    <td>${f.cid}</td>
    <td>${f.fields?.contentType || 'file'}</td>
    <td><a href="/upload/${encodeURIComponent(f.slug)}" target="_blank">${esc(f.slug)}</a></td>
    <td>${(f.fields?.size / 1024 || 0).toFixed(1)} KB</td>
    <td>${new Date(f.created * 1000).toLocaleString('zh-CN')}</td>
    <td><code>/upload/${esc(f.slug)}</code></td>
    <td>
      <form method="post" action="/admin/delete" onsubmit="return confirm('删除附件？')">
        <input type="hidden" name="cid" value="${f.cid}">
        <button class="btn sm danger" type="submit">删除</button>
      </form>
    </td>
  </tr>`
    )
    .join('');
  const body = `${MSG(ctx)}
  <h2>附件管理（${files.length}）</h2>
  <div class="card">
    <form method="post" action="/admin/upload" enctype="multipart/form-data" style="display:flex;gap:12px;align-items:flex-end;margin-bottom:18px">
      <div class="item" style="flex:1"><label>上传文件（存入 Blob 存储）</label><input type="file" name="file" required></div>
      <button class="btn primary" type="submit">上传</button>
    </form>
    <table><thead><tr><th>ID</th><th>类型</th><th>文件名</th><th>大小</th><th>时间</th><th>引用地址</th><th>操作</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7">暂无附件</td></tr>'}</tbody></table>
    <p class="hint">Markdown 中引用：\`![图片](/upload/xxx.png)\`</p>
  </div>`;
  return html(adminLayout(ctx, { title: '附件管理', active: 'uploads', body }));
}

async function uploadFile(ctx) {
  const { db, url } = ctx;
  const form = await ctx.request.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return Response.redirect(new URL('/admin/uploads?msg=err', url).href, 302);
  }
  const name = `${Date.now().toString(36)}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
  const buf = await file.arrayBuffer();
  if (buf.byteLength > 5 * 1024 * 1024) {
    return Response.redirect(new URL('/admin/uploads?msg=err', url).href, 302);
  }
  await db.blob.set(name, buf, file.type);
  const row = await db.createContent({
    title: file.name,
    slug: name,
    type: 'attachment',
    text: '',
    authorId: ctx.user.uid,
    fields: { contentType: file.type, size: buf.byteLength },
  });
  return Response.redirect(new URL('/admin/uploads?msg=ok', url).href, 302);
}

/* ==================== 站点设置 ==================== */

async function settingsPage(ctx) {
  const { db } = ctx;
  const o = ctx.options;
  const theme = o.joe || JOE_DEFAULTS;
  const body = `${MSG(ctx)}
  <h2>站点设置</h2>
  <div class="card">
  <form method="post" action="/admin/settings">
    <div class="row">
      <div class="item"><label>站点名称</label><input type="text" name="title" value="${esc(o.title || '')}"></div>
      <div class="item"><label>站点描述</label><input type="text" name="description" value="${esc(o.description || '')}"></div>
      <div class="item"><label>SEO 关键词</label><input type="text" name="keywords" value="${esc(o.keywords || '')}"></div>
    </div>
    <div class="row">
      <div class="item"><label>每页文章数</label><input type="number" name="pageSize" value="${o.pageSize || 10}" min="1" max="50"></div>
      <div class="item"><label>评论默认状态</label><select name="commentStatus">
        <option value="approved" ${o.commentStatus !== 'waiting' ? 'selected' : ''}>直接发布</option>
        <option value="waiting" ${o.commentStatus === 'waiting' ? 'selected' : ''}>先审核后发布</option>
      </select></div>
    </div>
    <h2 style="font-size:16px;margin:10px 0 14px">Joe 主题设置</h2>
    <div class="row">
      <div class="item"><label>Logo 图片 URL</label><input type="text" name="j_JLogo" value="${esc(theme.JLogo || '')}"></div>
      <div class="item"><label>Favicon URL</label><input type="text" name="j_JFavicon" value="${esc(theme.JFavicon || '')}"></div>
      <div class="item"><label>建站日期（运行时间）</label><input type="text" name="j_JBirthDay" value="${esc(theme.JBirthDay || '')}" placeholder="2024/01/01 00:00:00"></div>
    </div>
    <div class="row">
      <div class="item"><label>侧栏博主昵称</label><input type="text" name="j_JAside_Author_Nick" value="${esc(theme.JAside_Author_Nick || '')}"></div>
      <div class="item"><label>侧栏博主头像 URL</label><input type="text" name="j_JAside_Author_Avatar" value="${esc(theme.JAside_Author_Avatar || '')}"></div>
      <div class="item"><label>侧栏博主链接</label><input type="text" name="j_JAside_Author_Link" value="${esc(theme.JAside_Author_Link || '')}"></div>
    </div>
    <div class="row">
      <div class="item"><label>博主栏背景图 URL</label><input type="text" name="j_JAside_Author_Image" value="${esc(theme.JAside_Author_Image || '')}"></div>
      <div class="item"><label>博主格言（Motto）</label><input type="text" name="j_JAside_Author_Motto" value="${esc(theme.JAside_Author_Motto || '')}"></div>
      <div class="item"><label>热门文章侧栏数量</label><input type="number" name="j_JAside_Hot_Num" value="${esc(theme.JAside_Hot_Num || '5')}" min="0" max="10"></div>
    </div>
    <div class="row">
      <div class="item"><label>最新回复侧栏</label><select name="j_JAside_Newreply_Status"><option value="on" ${theme.JAside_Newreply_Status !== 'off' ? 'selected' : ''}>开启</option><option value="off" ${theme.JAside_Newreply_Status === 'off' ? 'selected' : ''}>关闭</option></select></div>
      <div class="item"><label>人生倒计时侧栏</label><select name="j_JAside_Timelife_Status"><option value="on" ${theme.JAside_Timelife_Status !== 'off' ? 'selected' : ''}>开启</option><option value="off" ${theme.JAside_Timelife_Status === 'off' ? 'selected' : ''}>关闭</option></select></div>
      <div class="item"><label>评论功能</label><select name="j_JCommentStatus"><option value="on" ${theme.JCommentStatus !== 'off' ? 'selected' : ''}>开启</option><option value="off" ${theme.JCommentStatus === 'off' ? 'selected' : ''}>关闭</option></select></div>
    </div>
    <div class="row">
      <div class="item"><label>导航最多显示页面数</label><input type="number" name="j_JNavMaxNum" value="${esc(theme.JNavMaxNum || '6')}" min="1" max="20"></div>
      <div class="item"><label>ICP 备案号</label><input type="text" name="j_JICP" value="${esc(theme.JICP || '')}"></div>
      <div class="item"><label>页脚自定义内容</label><input type="text" name="j_JFooter_Custom" value="${esc(theme.JFooter_Custom || '')}"></div>
    </div>
    <button class="btn primary" type="submit">保存设置</button>
  </form>
  </div>`;
  return html(adminLayout(ctx, { title: '站点设置', active: 'settings', body }));
}

async function saveSettings(ctx) {
  const { db, url } = ctx;
  const form = await ctx.request.formData();
  const siteKeys = ['title', 'description', 'keywords', 'commentStatus'];
  for (const k of siteKeys) {
    if (form.has(k)) await db.setOption(k, String(form.get(k)));
  }
  if (form.has('pageSize')) await db.setOption('pageSize', Math.max(1, parseInt(form.get('pageSize'), 10) || 10));

  // Joe 主题配置合并
  const theme = { ...((await db.getOption('theme:joe')) || JOE_DEFAULTS) };
  for (const [key, val] of form.entries()) {
    if (key.startsWith('j_')) theme[key.slice(2)] = String(val);
  }
  await db.setOption('theme:joe', theme);
  return Response.redirect(new URL('/admin/settings?msg=saved', url).href, 302);
}

/* ==================== 安全设置（TOTP） ==================== */

async function securityPage(ctx) {
  const { db, user, url } = ctx;
  const step = url.searchParams.get('step');

  let totpSection;
  if (user.totpEnabled) {
    totpSection = `<div class="msg ok">两步验证已开启</div>
    <form method="post" action="/admin/security">
      <input type="hidden" name="op" value="disable">
      <div class="item"><label>输入当前动态码以关闭两步验证</label><input type="text" name="totp" pattern="\\d{6}" required></div>
      <button class="btn danger" type="submit">关闭两步验证</button>
    </form>`;
  } else if (step === 'bind') {
    // 生成新密钥并展示二维码
    const secret = generateTotpSecret();
    await db.setOption(`totpPending:${user.uid}`, secret);
    const uri = otpauthUri(secret, user.mail || user.name, ctx.options.title || 'TypechoEdge');
    const qr = totpQrSvg(uri);
    totpSection = `<h2 style="font-size:16px;margin-bottom:14px">第一步：扫描二维码</h2>
    <div style="text-align:center;margin-bottom:18px"><div style="display:inline-block;background:#fff;padding:12px;border-radius:8px">${qr.replace('<svg', '<svg width="220" height="220"')}</div>
    <p class="hint" style="margin-top:10px">使用 Google Authenticator / Microsoft Authenticator / 微信小程序「腾讯身份验证器」等扫描</p>
    <p class="hint">无法扫码？手动输入密钥：<code style="user-select:all;font-size:15px">${secret}</code></p></div>
    <h2 style="font-size:16px;margin-bottom:14px">第二步：输入动态码确认绑定</h2>
    <form method="post" action="/admin/security">
      <input type="hidden" name="op" value="enable">
      <div class="item"><label>6 位动态码</label><input type="text" name="totp" pattern="\\d{6}" required autofocus autocomplete="one-time-code"></div>
      <button class="btn primary" type="submit">确认开启</button>
    </form>`;
  } else {
    totpSection = `<p style="font-size:14px;color:#57606a;line-height:1.8;margin-bottom:16px">
      开启后，登录时除密码外还需输入动态验证码（TOTP，RFC 6238），<br>即使密码泄露也无法登录后台。</p>
    <a class="btn primary" href="/admin/security?step=bind">开启两步验证</a>`;
  }

  const body = `${MSG(ctx)}
  <h2>安全设置</h2>
  <div class="card">
    ${totpSection}
  </div>
  <div class="card">
    <h2 style="font-size:16px;margin-bottom:14px">修改密码</h2>
    <form method="post" action="/admin/security">
      <input type="hidden" name="op" value="password">
      <div class="row">
        <div class="item"><label>当前密码</label><input type="password" name="old" required></div>
        <div class="item"><label>新密码（至少 8 位）</label><input type="password" name="password" required minlength="8"></div>
        <div class="item"><label>确认新密码</label><input type="password" name="password2" required minlength="8"></div>
      </div>
      <button class="btn" type="submit">修改密码</button>
    </form>
  </div>`;
  return html(adminLayout(ctx, { title: '安全设置', active: 'security', body }));
}

async function securityAction(ctx) {
  const { db, url, user } = ctx;
  const form = await ctx.request.formData();
  const op = form.get('op');

  if (op === 'enable') {
    const secret = await db.getOption(`totpPending:${user.uid}`);
    const code = String(form.get('totp') || '');
    if (!secret || !(await verifyTotp(secret, code))) {
      return Response.redirect(new URL('/admin/security?step=bind&msg=err', url).href, 302);
    }
    await db.updateUser(user.uid, { totpEnabled: true, totpSecret: secret });
    await db.setOption(`totpPending:${user.uid}`, null);
    return Response.redirect(new URL('/admin/security?msg=saved', url).href, 302);
  }

  if (op === 'disable') {
    const code = String(form.get('totp') || '');
    if (!(await verifyTotp(user.totpSecret, code))) {
      return Response.redirect(new URL('/admin/security?msg=err', url).href, 302);
    }
    await db.updateUser(user.uid, { totpEnabled: false, totpSecret: null });
    return Response.redirect(new URL('/admin/security?msg=ok', url).href, 302);
  }

  if (op === 'password') {
    const old = String(form.get('old') || '');
    const p1 = String(form.get('password') || '');
    const p2 = String(form.get('password2') || '');
    if (!(await verifyPassword(old, user.passwordHash)) || p1.length < 8 || p1 !== p2) {
      return Response.redirect(new URL('/admin/security?msg=err', url).href, 302);
    }
    const { hashPassword } = await import('../auth/password.js');
    await db.updateUser(user.uid, { passwordHash: await hashPassword(p1) });
    return Response.redirect(new URL('/admin/security?msg=saved', url).href, 302);
  }

  return Response.redirect(new URL('/admin/security', url).href, 302);
}

function html(body, init = {}) {
  return new Response(body, {
    ...init,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...(init.headers || {}) },
  });
}

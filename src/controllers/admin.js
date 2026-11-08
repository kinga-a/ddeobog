/**
 * 后台管理 —— /admin
 * 包含：登录（密码 + TOTP 两步验证）、仪表盘、文章/页面管理、
 *       分类/标签、评论管理、附件上传（Blob）、站点与主题设置、安全设置（TOTP）
 */
import { verifyPassword, hashPassword, randomHex } from '../auth/password.js';
import { currentUser, sessionCookie, clearSessionCookie, sameOrigin } from '../auth/session.js';
import { CONFIG } from '../config.js';
import { escapeHtml as esc, plainExcerpt } from '../render/markdown.js';
import { generateTotpSecret, verifyTotp, otpauthUri, totpQrSvg } from '../auth/totp.js';
import { JOE_DEFAULTS, normalizeBirthday } from '../render/theme-joe.js';
import { mcpClientExample, loadMcpServers, saveMcpServers } from '../mcp.js';

/**
 * 登录失败限流 —— 按「用户名 + 客户端 IP」维度计数。
 * 连续失败达到阈值后锁定一段时间，防止在线爆破。
 */
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** 密码通过后进入 TOTP 二次验证的待办会话有效期 */
const PENDING_TOTP_TTL_MS = 5 * 60 * 1000;
/** 上传文件大小上限（平台请求体上限 1MB，本地按 5MB 兜底） */
const MAX_UPLOAD_BYTES = 950 * 1024; // Edge Functions 请求体上限 1MB，留出 multipart 余量
const ADMIN_LIST_PAGE_SIZE = 20;
const ADMIN_COMMENT_PAGE_SIZE = 30;
const ADMIN_ATTACHMENT_PAGE_SIZE = 200;
const MIN_PASSWORD_LENGTH = 8;

function clientIp(request) {
  const cf = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')
    || request.headers.get('x-real-ip');
  if (cf) return String(cf).split(',')[0].trim();
  return 'unknown';
}

function loginThrottleKey(request, name) {
  const ip = clientIp(request);
  const raw = `${name || ''}|${ip}`;
  // 简单哈希，避免把原始 IP 作为 KV key 暴露
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
  return `login_fail:${h.toString(16)}`;
}

async function checkLoginLocked(db, request, name) {
  const key = loginThrottleKey(request, name);
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

/** 302 重定向；query 合并到 URL 查询参数 */
function redirect(url, path, query = {}) {
  const target = new URL(path, url);
  for (const [k, v] of Object.entries(query)) target.searchParams.set(k, v);
  return Response.redirect(target.href, 302);
}

/** 登录成功：建会话、记录最后登录时间、下发 Cookie */
async function loginSuccess(db, user) {
  const token = await db.createSession(user.uid, CONFIG.SESSION_TTL);
  await db.updateUser(user.uid, { logged: Math.floor(Date.now() / 1000) });
  return new Response(null, {
    status: 302,
    headers: { Location: '/admin', 'Set-Cookie': sessionCookie(token) },
  });
}

const ADMIN_POST_ROUTES = new Map([
  ['post', savePost],
  ['delete', deletePost],
  ['meta', saveMeta],
  ['meta-delete', deleteMeta],
  ['comment', commentAction],
  ['upload', uploadFile],
  ['settings', saveSettings],
  ['security', securityAction],
]);

const ADMIN_GET_ROUTES = new Map([
  ['', dashboard],
  ['posts', postsList],
  ['post', (ctx) => postEditor(ctx, 'post')],
  ['pages', pagesList],
  ['page', (ctx) => postEditor(ctx, 'page')],
  ['metas', metasPage],
  ['comments', commentsPage],
  ['uploads', uploadsPage],
  ['settings', settingsPage],
  ['security', securityPage],
]);

export async function handleAdmin(ctx) {
  const { db, request, url, path } = ctx;
  const sub = path.slice('/admin'.length).replace(/^\/+|\/+$/g, '') || '';

  // ---- 未安装 ----
  if (!(await db.isInstalled())) {
    return redirect(url, '/install');
  }

  // ---- 登录/登出 ----
  if (sub === 'login') {
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
    return redirect(url, '/admin/login');
  }
  const user = auth.user;
  ctx.user = user;

  if (request.method === 'POST') {
    if (!sameOrigin(request)) return json({ ok: 0, msg: '非法来源' }, 403);
    const handler = ADMIN_POST_ROUTES.get(sub);
    if (handler) return handler(ctx);
  }

  const view = ADMIN_GET_ROUTES.get(sub);
  if (view) return view(ctx);
  return redirect(url, '/admin');
}

/* ==================== 登录 ==================== */

function loginPage(ctx, { error = '', totp = false, pendingToken = '', name = '' } = {}) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>登录 - ${esc(ctx.options.title)}</title>
  <link rel="stylesheet" href="/usr/themes/joe/assets/css/admin.css">
  <meta name="color-scheme" content="light dark">
</head><body class="auth">
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
  const form = await ctx.request.formData();
  if (form.get('step') === 'totp') return completeTotpLogin(ctx, form);
  return startPasswordLogin(ctx, form);
}

/** 第二步：校验 TOTP 动态码 */
async function completeTotpLogin(ctx, form) {
  const { db } = ctx;
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
  return loginSuccess(db, user);
}

/** 第一步：用户名 + 密码（失败限流，成功后按需进入 TOTP） */
async function startPasswordLogin(ctx, form) {
  const { db, request } = ctx;
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
    await db.kv.putJSON(`pending:${pending}`, { uid: user.uid, exp: Date.now() + PENDING_TOTP_TTL_MS });
    return loginPage(ctx, { totp: true, pendingToken: pending });
  }
  return loginSuccess(db, user);
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
  <link rel="stylesheet" href="/usr/themes/joe/assets/css/admin.css">
  <meta name="color-scheme" content="light dark">
</head><body>
  <button class="burger" type="button" aria-label="切换导航" aria-expanded="false" aria-controls="admin-side">
    <i class="fa fa-bars" aria-hidden="true"></i>
  </button>
  <div class="scrim"></div>
  <div class="layout">
    <nav class="side" id="admin-side">
      <div class="brand">${esc(ctx.options.title)}<small>TypechoEdge v${CONFIG.VERSION}</small></div>
      ${menu}
    </nav>
    <main class="main">${body}</main>
  </div>
  <script>
  (function(){
    var side=document.getElementById('admin-side'),scrim=document.querySelector('.scrim'),
        burger=document.querySelector('.burger');
    function setOpen(on){
      if(!side||!burger) return;
      side.classList.toggle('is-open',on);
      scrim.classList.toggle('is-open',on);
      burger.setAttribute('aria-expanded',on?'true':'false');
    }
    if(side&&burger){
      burger.addEventListener('click',function(){setOpen(!side.classList.contains('is-open'));});
      scrim.addEventListener('click',function(){setOpen(false);});
      document.addEventListener('keydown',function(e){if(e.key==='Escape')setOpen(false);});
      side.addEventListener('click',function(e){if(e.target.closest('a'))setOpen(false);});
    }

    var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var main=document.querySelector('.main');
    var layoutEl=document.querySelector('.layout');
    var progress=document.createElement('div');
    progress.className='nav-progress';
    document.body.appendChild(progress);

    function enhance(){
      if(reduce||!main) return;
      var items=main.querySelectorAll(':scope > h2, :scope > .msg, :scope > .card, :scope > .dash-hero, .dash-stats > .stat, .dash-grid > *');
      for(var i=0;i<items.length;i++) items[i].style.setProperty('--enter-delay',(i*45)+'ms');
      var bars=main.querySelectorAll('.dash-bar__track i');
      for(var b=0;b<bars.length;b++) bars[b].style.setProperty('--enter-delay',(150+b*70)+'ms');
      var nums=main.querySelectorAll('.stat .num');
      for(var n=0;n<nums.length;n++) (function(el){
        var target=parseInt(el.textContent.replace(/[^0-9]/g,''),10);
        if(!isFinite(target)||target<=0) return;
        var start=performance.now();
        el.textContent='0';
        requestAnimationFrame(function tick(now){
          var p=Math.min(1,(now-start)/520);
          var eased=1-Math.pow(1-p,3);
          el.textContent=Math.round(target*eased);
          if(p<1) requestAnimationFrame(tick);
        });
      })(nums[n]);
    }
    enhance();

    function isAdminHref(href){
      return !!href && href.charAt(0)==='/' && href.indexOf('//')!==0
        && href.indexOf('/admin')===0
        && href.indexOf('/admin/login')!==0
        && href.indexOf('/admin/logout')!==0;
    }

    function syncSide(doc){
      var next=doc.querySelector('#admin-side');
      if(!next||!side) return;
      var links=side.querySelectorAll('a'),nextLinks=next.querySelectorAll('a');
      for(var i=0;i<links.length;i++){
        if(nextLinks[i]) links[i].classList.toggle('active',nextLinks[i].classList.contains('active'));
      }
    }

    // 局部替换后重新执行页面内的脚本（如 Markdown 工具栏）
    function runScripts(container){
      // 清掉上次导航注入的脚本标签，避免反复进入编辑页时重复初始化
      var stale=document.querySelectorAll('script[data-spa-script]');
      for(var s=0;s<stale.length;s++) stale[s].remove();
      var scripts=container.querySelectorAll('script');
      for(var i=0;i<scripts.length;i++){
        var old=scripts[i],el=document.createElement('script');
        for(var j=0;j<old.attributes.length;j++) el.setAttribute(old.attributes[j].name,old.attributes[j].value);
        el.async=false;
        el.setAttribute('data-spa-script','1');
        el.text=old.textContent;
        document.body.appendChild(el);
      }
    }

    function navigate(href,push){
      if(!main){ location.href=href; return; }
      var skeleton=document.createElement('div');
      skeleton.className='admin-skeleton';
      skeleton.innerHTML='<div class="sk sk-title"></div><div class="sk-grid"><div class="sk sk-card"></div><div class="sk sk-card"></div><div class="sk sk-card"></div><div class="sk sk-card"></div></div><div class="sk-list"><div class="sk sk-line" style="width:94%"></div><div class="sk sk-line" style="width:78%"></div><div class="sk sk-line" style="width:88%"></div><div class="sk sk-line" style="width:66%"></div><div class="sk sk-line" style="width:82%"></div><div class="sk sk-line" style="width:74%"></div></div>';
      main.appendChild(skeleton);
      var skTimer=setTimeout(function(){skeleton.classList.add('is-visible');},120);
      layoutEl.classList.add('is-loading');
      progress.classList.add('is-active');
      fetch(href,{headers:{'X-Requested-With':'admin-nav'},credentials:'same-origin'})
        .then(function(res){
          if(res.redirected&&res.url.indexOf('/admin/login')>=0){location.href=res.url;throw new Error('login');}
          if(!res.ok) throw new Error('HTTP '+res.status);
          return res.text();
        })
        .then(function(html){
          var doc=new DOMParser().parseFromString(html,'text/html');
          var next=doc.querySelector('.main');
          if(!next) throw new Error('no main');
          clearTimeout(skTimer);
          main.innerHTML=next.innerHTML;
          runScripts(next);
          document.title=doc.title;
          syncSide(doc);
          if(push) history.pushState({admin:1},'',href);
          if(reduce) window.scrollTo(0,0); else window.scrollTo({top:0,behavior:'smooth'});
          enhance();
        })
        .catch(function(){ clearTimeout(skTimer); location.href=href; })
        .finally(function(){
          clearTimeout(skTimer);
          layoutEl.classList.remove('is-loading');
          progress.classList.remove('is-active');
        });
    }

    document.addEventListener('click',function(e){
      if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey) return;
      var a=e.target.closest('a');
      if(!a||a.target==='_blank'||a.hasAttribute('download')) return;
      var href=a.getAttribute('href');
      if(!isAdminHref(href)) return;
      if(href===location.pathname+location.search){e.preventDefault();return;}
      e.preventDefault();
      if(a.closest('.side')) setOpen(false);
      navigate(href,true);
    });
    window.addEventListener('popstate',function(){navigate(location.pathname+location.search,false);});
    history.replaceState({admin:1},'');
  })();
  </script></body></html>`;
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
  if (t === 'token') return `<div class="msg ok">已生成新令牌</div>`;
  return '';
};

/* ==================== 仪表盘 ==================== */

async function dashboard(ctx) {
  const { db, user } = ctx;
  const [posts, pages, attachments, comments, waiting, cats, tags] = await Promise.all([
    db.listContentsIndex({ type: 'post', pageSize: 1, allStatus: true }),
    db.listContentsIndex({ type: 'page', pageSize: 1, allStatus: true }),
    db.listContentsIndex({ type: 'attachment', pageSize: 1, allStatus: true }),
    db.listAllComments({ pageSize: 1 }),
    db.listAllComments({ status: 'waiting', pageSize: 1 }),
    db.listMetas('category'),
    db.listMetas('tag'),
  ]);

  const [recentPosts, hotPosts, recentComments, waitingComments] = await Promise.all([
    db.listContentsIndex({ type: 'post', pageSize: 5, allStatus: true }),
    db.listContentsIndex({ type: 'post', pageSize: 5, order: 'views' }),
    db.listAllComments({ pageSize: 5 }),
    db.listAllComments({ status: 'waiting', pageSize: 5 }),
  ]);

  const cids = [...new Set([...recentPosts.items, ...hotPosts.items].map((p) => p.cid))];
  const statsMap = cids.length ? await db.getStatsBatch(cids) : new Map();
  const [viewTotal, agreeTotal, mcpServers] = await Promise.all([
    db.sumStat('views'),
    db.sumStat('agree'),
    loadMcpServers(db),
  ]);
  const mcpEnabledCount = mcpServers.filter((server) => server.enabled !== false).length;

  const birthday = normalizeBirthday(ctx.options.joe?.JBirthDay);
  const runDays = birthday ? Math.max(0, Math.floor((Date.now() - new Date(birthday).getTime()) / 86400000)) : 0;
  const fmt = (ts) => new Date(ts * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const statusBadge = (status) =>
    status === 'publish'
      ? '<span class="badge green">公开</span>'
      : status === 'hidden'
        ? '<span class="badge yellow">隐藏</span>'
        : `<span class="badge">${esc(status)}</span>`;
  const commentBadge = (status) =>
    status === 'approved'
      ? '<span class="badge green">已通过</span>'
      : status === 'waiting'
        ? '<span class="badge yellow">待审核</span>'
        : `<span class="badge">${esc(status)}</span>`;
  const editUrl = (p) => (p.type === 'page' ? `/admin/page?cid=${p.cid}` : `/admin/post?cid=${p.cid}`);
  const viewsOf = (p) => statsMap.get(p.cid)?.views || 0;
  const empty = (text) => `<p class="dash-empty">${text}</p>`;

  const statCard = (href, icon, label, num, meta) => `<a class="stat" href="${href}">
      <div class="stat__top"><span class="stat__icon"><i class="fa ${icon}" aria-hidden="true"></i></span><span class="stat__label">${label}</span></div>
      <div class="num">${num}</div>
      <div class="stat__meta">${meta}</div>
    </a>`;

  const recentPostRows = recentPosts.items
    .map(
      (p) => `<li class="dash-list__item">
      <div class="dash-list__body">
        <a class="dash-list__title" href="${editUrl(p)}">${esc(p.title)}</a>
        <div class="dash-list__meta">${statusBadge(p.status)}<span>${p.commentsNum || 0} 评论</span><span>${viewsOf(p)} 阅读</span></div>
      </div>
      <time class="dash-list__time">${fmt(p.created)}</time>
    </li>`
    )
    .join('');

  const hotRows = hotPosts.items
    .map(
      (p, i) => `<li class="dash-hot">
      <i class="dash-hot__rank">${i + 1}</i>
      <a class="dash-hot__title" href="${editUrl(p)}">${esc(p.title)}</a>
      <span class="dash-hot__views">${viewsOf(p)} 阅读</span>
    </li>`
    )
    .join('');

  const commentRow = (c) => `<li class="dash-list__item">
      <div class="dash-list__body">
        <div class="dash-list__meta"><strong>${esc(c.author)}</strong><span>评论于</span><a href="/archives/${c.cid}/#comment-${c.coid}" target="_blank">文章 #${c.cid}</a>${commentBadge(c.status)}</div>
        <a class="dash-quote" href="/archives/${c.cid}/#comment-${c.coid}" target="_blank">${esc(plainExcerpt(c.text, 70))}</a>
      </div>
      <time class="dash-list__time">${fmt(c.created)}</time>
    </li>`;

  const waitingRows = waitingComments.items
    .map(
      (c) => `<li class="dash-list__item">
      <div class="dash-list__body">
        <div class="dash-list__meta"><strong>${esc(c.author)}</strong><a href="/archives/${c.cid}/#comment-${c.coid}" target="_blank">文章 #${c.cid}</a></div>
        <p class="dash-quote">${esc(plainExcerpt(c.text, 90))}</p>
      </div>
      <div class="dash-actions">
        <form method="post" action="/admin/comment"><input type="hidden" name="op" value="approve"><input type="hidden" name="coid" value="${c.coid}"><button class="btn mini" type="submit">通过</button></form>
        <form method="post" action="/admin/comment" onsubmit="return confirm('删除这条评论？')"><input type="hidden" name="op" value="delete"><input type="hidden" name="coid" value="${c.coid}"><button class="btn mini danger" type="submit">删除</button></form>
      </div>
    </li>`
    )
    .join('');

  const maxCat = Math.max(1, ...cats.map((c) => c.count || 0));
  const catBars = cats
    .map(
      (c) => `<div class="dash-bar">
      <span class="dash-bar__name">${esc(c.name)}</span>
      <span class="dash-bar__track"><i style="width:${Math.round(((c.count || 0) / maxCat) * 100)}%"></i></span>
      <span class="dash-bar__num">${c.count || 0}</span>
    </div>`
    )
    .join('');

  const overview = `<dl class="dash-overview">
      <div><dt>站点主题</dt><dd>Joe</dd></div>
      <div><dt>建站时长</dt><dd>${runDays} 天</dd></div>
      <div><dt>两步验证</dt><dd>${user.totpEnabled ? '<span class="badge green">已开启</span>' : '<span class="badge yellow">未开启</span>'}</dd></div>
      <div><dt>MCP 服务</dt><dd>${mcpEnabledCount ? `<span class="badge green">${mcpEnabledCount} 个已开启</span>` : '<span class="badge yellow">未开启</span>'}</dd></div>
      <div><dt>存储</dt><dd>KV + Blob</dd></div>
      <div><dt>运行环境</dt><dd>EdgeOne 边缘函数</dd></div>
    </dl>`;

  const body = `${MSG(ctx)}
  <div class="dash-hero">
    <div class="dash-hero__main">
      <h2>欢迎回来，${esc(user.screenName || user.name)}</h2>
      <p>${esc(ctx.options.title)} · 已运行 ${runDays} 天 · 今天是 ${new Date().toLocaleDateString('zh-CN')}</p>
    </div>
    <div class="dash-hero__actions">
      <a class="btn primary" href="/admin/post?type=post"><i class="fa fa-pencil" aria-hidden="true"></i> 写文章</a>
      <a class="btn" href="/admin/settings"><i class="fa fa-cog" aria-hidden="true"></i> 站点设置</a>
      <a class="btn" href="/" target="_blank"><i class="fa fa-external-link" aria-hidden="true"></i> 查看站点</a>
    </div>
  </div>

  <div class="dash-stats">
    ${statCard('/admin/posts', 'fa-file-text', '文章', posts.total, '公开内容总数')}
    ${statCard('/admin/pages', 'fa-files-o', '页面', pages.total, '独立页面')}
    ${statCard('/admin/comments', 'fa-comments', '评论', comments.total, `待审核 ${waiting.total} 条`)}
    ${statCard('/admin/uploads', 'fa-image', '附件', attachments.total, '图片与文件')}
    ${statCard('/admin/metas', 'fa-folder', '分类', cats.length, '内容分类')}
    ${statCard('/admin/metas', 'fa-tags', '标签', tags.length, '内容标签')}
    ${statCard('/admin/posts', 'fa-eye', '总阅读', viewTotal, '全站累计')}
    ${statCard('/admin/posts', 'fa-thumbs-up', '总点赞', agreeTotal, '全站累计')}
  </div>

  <div class="card dash-quickbar">
    <div class="dash-card__head"><h3>快捷操作</h3><span class="dash-more">常用入口</span></div>
    <div class="dash-quick">
      <a class="dash-quick__item" href="/admin/post?type=post"><i class="fa fa-pencil" aria-hidden="true"></i><span>撰写文章</span></a>
      <a class="dash-quick__item" href="/admin/page"><i class="fa fa-plus" aria-hidden="true"></i><span>创建页面</span></a>
      <a class="dash-quick__item" href="/admin/metas"><i class="fa fa-folder" aria-hidden="true"></i><span>分类标签</span></a>
      <a class="dash-quick__item" href="/admin/comments"><i class="fa fa-comments" aria-hidden="true"></i><span>评论管理</span>${waiting.total ? `<em>${waiting.total}</em>` : ''}</a>
      <a class="dash-quick__item" href="/admin/uploads"><i class="fa fa-upload" aria-hidden="true"></i><span>上传附件</span></a>
      <a class="dash-quick__item" href="/admin/security"><i class="fa fa-shield" aria-hidden="true"></i><span>安全设置</span></a>
    </div>
  </div>

  <div class="dash-grid">
    <div class="dash-col-8">
      <div class="card dash-card">
        <div class="dash-card__head"><h3>最近文章</h3><a class="dash-more" href="/admin/posts">查看全部 →</a></div>
        ${recentPosts.items.length ? `<ul class="dash-list">${recentPostRows}</ul>` : empty('还没有文章，去写第一篇吧。')}
      </div>
    </div>
    <div class="dash-col-4">
      <div class="card dash-card">
        <div class="dash-card__head"><h3>站点概览</h3></div>
        ${overview}
      </div>
    </div>

    <div class="dash-col-6">
      <div class="card dash-card">
        <div class="dash-card__head"><h3>待审核评论 ${waiting.total ? `<span class="badge yellow">${waiting.total}</span>` : ''}</h3><a class="dash-more" href="/admin/comments">全部 →</a></div>
        ${waitingComments.items.length ? `<ul class="dash-list">${waitingRows}</ul>` : empty('没有待审核评论，很好。')}
        ${waitingComments.items.length ? `<div class="dash-card__foot">待审 ${waiting.total} 条 · 通过或删除后自动从列表移除</div>` : ''}
      </div>
    </div>
    <div class="dash-col-6">
      <div class="card dash-card">
        <div class="dash-card__head"><h3>热门文章</h3><a class="dash-more" href="/admin/posts">全部 →</a></div>
        ${hotPosts.items.length ? `<ol class="dash-hot-list">${hotRows}</ol>` : empty('暂无阅读数据。')}
      </div>
    </div>

    <div class="dash-col-7">
      <div class="card dash-card">
        <div class="dash-card__head"><h3>最新评论</h3><a class="dash-more" href="/admin/comments">全部 →</a></div>
        ${recentComments.items.length ? `<ul class="dash-list">${recentComments.items.map(commentRow).join('')}</ul>` : empty('还没有评论。')}
      </div>
    </div>
    <div class="dash-col-5">
      <div class="card dash-card">
        <div class="dash-card__head"><h3>分类分布</h3><a class="dash-more" href="/admin/metas">管理 →</a></div>
        ${cats.length ? `<div class="dash-bars">${catBars}</div>` : empty('还没有分类。')}
      </div>
    </div>
  </div>`;
  return html(adminLayout(ctx, { title: '仪表盘', active: '', body }));
}

/* ==================== 文章/页面 ==================== */

async function postsList(ctx) {
  const { db, url } = ctx;
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const list = await db.listContents({ type: 'post', page, pageSize: ADMIN_LIST_PAGE_SIZE, allStatus: true });
  const rows = list.items
    .map(
      (p) => `<tr>
    <td data-label="ID">${p.cid}</td>
    <td data-label="标题"><a href="/archives/${p.cid}/" target="_blank">${esc(p.title)}</a></td>
    <td data-label="状态"><span class="badge ${p.status === 'publish' ? 'green' : p.status === 'hidden' ? 'yellow' : ''}">${p.status === 'publish' ? '公开' : p.status === 'hidden' ? '隐藏' : p.status}</span></td>
    <td data-label="评论">${p.commentsNum || 0}</td>
    <td data-label="时间">${new Date(p.created * 1000).toLocaleString('zh-CN')}</td>
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
    <td data-label="ID">${p.cid}</td>
    <td data-label="标题"><a href="/${p.slug}/" target="_blank">${esc(p.title)}</a></td>
    <td data-label="路径"><code>/${p.slug}/</code></td>
    <td data-label="状态"><span class="badge ${p.status === 'publish' ? 'green' : ''}">${p.status === 'publish' ? '公开' : p.status}</span></td>
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

/**
 * Markdown 工具条按钮表。data-md 的取值必须和
 * usr/themes/joe/assets/js/joe.admin-md.js 里的 ACTS 一一对应。
 *
 * 按钮由服务端渲染而不是前端拼，测试才能对着 HTML 断言具体动作。
 * 能放哪些动作以 src/render/markdown.js 实际支持什么为准：那里不支持的
 * 语法不放按钮，否则用户会得到一段原样显示的字符（比如任务列表
 * `- [ ]` 会渲染成 `<li>[ ] xxx</li>`）。'|' 是分组分隔线。
 */
const MD_ACTIONS = [
  ['h1', 'H1', '', '一级标题'],
  ['h2', 'H2', '', '二级标题'],
  ['h3', 'H3', '', '三级标题'],
  '|',
  ['bold', '', 'fa-bold', '加粗 · Ctrl+B'],
  ['italic', '', 'fa-italic', '斜体 · Ctrl+I'],
  ['strike', '', 'fa-strikethrough', '删除线'],
  ['code', '', 'fa-code', '行内代码'],
  '|',
  ['quote', '', 'fa-quote-left', '引用'],
  ['codeblock', '', 'fa-file-code-o', '代码块'],
  ['ul', '', 'fa-list-ul', '无序列表'],
  ['ol', '', 'fa-list-ol', '有序列表'],
  ['hr', '', 'fa-minus', '分隔线'],
  '|',
  ['link', '', 'fa-link', '链接 · Ctrl+K'],
  ['image', '', 'fa-picture-o', '图片'],
  ['table', '', 'fa-table', '表格'],
  ['more', '', 'fa-scissors', '插入摘要分隔 <!--more-->'],
  '|',
  ['undo', '', 'fa-undo', '撤销 · Ctrl+Z'],
  ['redo', '', 'fa-repeat', '重做 · Ctrl+Shift+Z'],
];

const mdToolbar = () => {
  const inner = MD_ACTIONS.map((row) => {
    if (row === '|') return '<span class="md-bar__sep" aria-hidden="true"></span>';
    const [act, label, icon, title] = row;
    const face = icon
      ? `<i class="fa ${icon}" aria-hidden="true"></i>`
      : `<span>${esc(label)}</span>`;
    return `<button type="button" class="md-bar__btn" data-md="${act}" title="${esc(title)}" aria-label="${esc(title)}">${face}</button>`;
  }).join('');
  return `<div class="md-bar" id="joe-md-bar" role="toolbar" aria-label="Markdown 快捷插入">${inner}<span class="md-bar__hint">支持 Markdown</span></div>`;
};

/** 标签输入框初始值：按文章 tags 的顺序取名称（缺失的 meta 渲染为空） */
async function postTagNames(db, post) {
  if (!post || !(post.tags || []).length) return '';
  const byMid = new Map((await db.getMetasBatch(post.tags)).map((m) => [m.mid, m]));
  return post.tags.map((mid) => byMid.get(mid)?.name).join(',');
}

/** 分类复选框列表 */
function categoryChecks(cats, selected = []) {
  return cats
    .map(
      (c) => `<label style="font-weight:400;display:inline-flex;align-items:center;margin-right:14px;gap:4px">
      <input type="checkbox" name="categories" value="${c.mid}" ${selected.includes(c.mid) ? 'checked' : ''}> ${esc(c.name)}</label>`
    )
    .join('');
}

async function postEditor(ctx, kind) {
  const { db, url, user } = ctx;
  const cid = parseInt(url.searchParams.get('cid') || '0', 10);
  let post = null;
  if (cid) post = await db.getContent(cid);
  const isNew = !post;
  const isPage = kind === 'page' || post?.type === 'page';
  const cats = await db.listMetas('category');
  const tagNames = await postTagNames(db, post);
  const catChecks = categoryChecks(cats, post?.categories || []);

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
      ${mdToolbar()}
      <textarea name="text" id="joe-md-text" class="md-textarea" style="min-height:320px">${esc(post?.text || '')}</textarea></div>
    <div class="row">
      <div class="item"><label>状态</label>
        <select name="status">
          <option value="publish" ${post?.status !== 'hidden' ? 'selected' : ''}>公开</option>
          <option value="hidden" ${post?.status === 'hidden' ? 'selected' : ''}>隐藏</option>
        </select></div>
      ${isPage ? '' : `<div class="item"><label>访问密码（可选）</label><input type="password" name="password" autocomplete="new-password" placeholder="${post?.password ? '已设置，留空表示不修改' : '留空表示不加密'}"></div>`}
      <div class="item"><label>允许评论</label>
        <select name="allowComment">
          <option value="1" ${post?.allowComment !== false ? 'selected' : ''}>允许</option>
          <option value="0" ${post?.allowComment === false ? 'selected' : ''}>禁止</option>
        </select></div>
    </div>
    ${isPage ? '' : `<div class="item"><label>所属分类</label><div>${catChecks || '<span class="hint">暂无分类，可先在「分类/标签」中创建</span>'}</div></div>
    <div class="item"><label>标签（逗号分隔，自动创建）</label><input type="text" name="tags" value="${esc(tagNames)}" placeholder="生活, 技术"></div>`}
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
  </div>
  <script src="/usr/themes/joe/assets/js/joe.admin-md.min.js" defer></script>`;
  return html(adminLayout(ctx, { title: isNew ? '撰写' : '编辑', active: isPage ? 'page' : 'post', body }));
}

/** 解析逗号分隔的标签名，按需创建，返回 mid 列表 */
async function resolveTagIds(db, rawTags) {
  const names = String(rawTags || '')
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!names.length) return [];
  const existing = new Map((await db.listMetas('tag')).map((t) => [t.name, t]));
  const ids = [];
  for (const name of names) {
    let tag = existing.get(name);
    if (!tag) {
      tag = await db.createMeta({ name, slug: name, type: 'tag' });
      existing.set(name, tag);
    }
    ids.push(tag.mid);
  }
  return ids;
}

/** 合并自定义字段：表单提供则覆盖，留空则删除 */
function parsePostFields(form, existing = {}) {
  const fields = { ...existing };
  for (const k of ['thumb', 'abstract', 'mode']) {
    const v = String(form.get(`field_${k}`) || '').trim();
    if (v) fields[k] = v;
    else delete fields[k];
  }
  return fields;
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

  const existing = cid ? await db.getContent(cid) : null;
  const categories = form.getAll('categories').map(Number).filter(Boolean);
  const tags = await resolveTagIds(db, form.get('tags'));
  const fields = parsePostFields(form, existing?.fields || {});

  // 访问密码不落明文。留空 = 不修改（编辑时沿用旧值）；改造前写下的明文，
  // 在这篇文章下次被保存时自动转成 PBKDF2。
  const rawPassword = String(form.get('password') || '');
  let password = '';
  if (rawPassword) {
    password = await hashPassword(rawPassword);
  } else if (existing) {
    password = existing.password || '';
  }

  const data = {
    title,
    slug,
    text,
    type,
    status: form.get('status') === 'hidden' ? 'hidden' : 'publish',
    password,
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
  return redirect(url, type === 'page' ? '/admin/pages' : '/admin/posts', { msg: 'saved' });
}

async function deletePost(ctx) {
  const { db, url } = ctx;
  const form = await ctx.request.formData();
  const cid = parseInt(form.get('cid') || '0', 10);
  // 附件和文章共用这个入口，删完要回各自的列表
  let back = '/admin/posts';
  if (cid) {
    const row = await db.getContent(cid);
    if (row && row.type === 'attachment') back = '/admin/uploads';
    await db.deleteContent(cid);
  }
  return redirect(url, back, { msg: 'ok' });
}

/* ==================== 分类/标签 ==================== */

async function metasPage(ctx) {
  const { db } = ctx;
  const cats = await db.listMetas('category');
  const tags = await db.listMetas('tag');
  const metaTable = (list, type) => `<table><thead><tr><th>名称</th><th>缩略名</th><th>文章数</th><th class="col-act">操作</th></tr></thead><tbody>
    ${list.map((m) => `<tr>
      <td class="cell-strong" data-label="名称">${esc(m.name)}</td><td data-label="缩略名"><code>${esc(m.slug)}</code></td><td data-label="文章数">${m.count}</td>
      <td>
        <div class="meta-ops">
          <form method="post" action="/admin/meta">
            <input type="hidden" name="mid" value="${m.mid}">
            <input type="hidden" name="type" value="${type}">
            <input class="meta-input" type="text" name="name" value="${esc(m.name)}" aria-label="改名">
            <button class="btn sm" type="submit">改名</button>
          </form>
          <form method="post" action="/admin/meta-delete" onsubmit="return confirm('确定删除？文章将解除关联')">
            <input type="hidden" name="mid" value="${m.mid}">
            <button class="btn sm danger" type="submit">删除</button>
          </form>
        </div>
      </td>
    </tr>`).join('') || `<tr><td colspan="4" class="empty-cell">暂无</td></tr>`}
  </tbody></table>`;

  const body = `${MSG(ctx)}
  <h2>分类 / 标签</h2>
  <div class="metas">
    <section class="card">
      <div class="metas__head"><h2>新建</h2></div>
      <div class="metas__body">
        <form class="meta-create" method="post" action="/admin/meta">
          <div class="item"><label>类型</label><select name="type"><option value="category">分类</option><option value="tag">标签</option></select></div>
          <div class="item"><label>名称</label><input type="text" name="name" required></div>
          <div class="item"><label>缩略名（可选）</label><input type="text" name="slug"></div>
          <button class="btn primary" type="submit">创建</button>
        </form>
      </div>
    </section>
    <section class="card">
      <div class="metas__head"><h2>分类</h2><span class="metas__count">${cats.length}</span></div>
      <div class="metas__scroll">${metaTable(cats, 'category')}</div>
    </section>
    <section class="card">
      <div class="metas__head"><h2>标签</h2><span class="metas__count">${tags.length}</span></div>
      <div class="metas__scroll">${metaTable(tags, 'tag')}</div>
    </section>
  </div>`;
  return html(adminLayout(ctx, { title: '分类标签', active: 'metas', body }));
}

async function saveMeta(ctx) {
  const { db, url } = ctx;
  const form = await ctx.request.formData();
  const mid = parseInt(form.get('mid') || '0', 10);
  const name = String(form.get('name') || '').trim();
  const type = form.get('type') === 'tag' ? 'tag' : 'category';
  if (!name) return redirect(url, '/admin/metas', { msg: 'err' });
  if (mid) {
    await db.updateMeta(mid, { name });
  } else {
    const slug = String(form.get('slug') || '').trim() || name;
    await db.createMeta({ name, slug, type });
  }
  return redirect(url, '/admin/metas', { msg: 'saved' });
}

async function deleteMeta(ctx) {
  const { db, url } = ctx;
  const form = await ctx.request.formData();
  const mid = parseInt(form.get('mid') || '0', 10);
  if (mid) await db.deleteMeta(mid);
  return redirect(url, '/admin/metas', { msg: 'ok' });
}

/* ==================== 评论管理 ==================== */

async function commentsPage(ctx) {
  const { db, url } = ctx;
  const status = url.searchParams.get('status') || '';
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const list = await db.listAllComments({ status: status || undefined, page, pageSize: ADMIN_COMMENT_PAGE_SIZE });
  const tabs = `<p style="margin-bottom:14px;font-size:14px">
    <a href="/admin/comments" ${!status ? 'style="font-weight:700"' : ''}>全部</a> ·
    <a href="/admin/comments?status=approved" ${status === 'approved' ? 'style="font-weight:700"' : ''}>已通过</a> ·
    <a href="/admin/comments?status=waiting" ${status === 'waiting' ? 'style="font-weight:700"' : ''}>待审核</a></p>`;
  const rows = list.items
    .map(
      (c) => `<tr>
    <td data-label="ID">${c.coid}</td>
    <td data-label="作者">${esc(c.author)}<br><span class="hint">${esc(c.mail)}</span></td>
    <td data-label="内容" style="max-width:420px">${esc(plainExcerpt(c.text, 80))}</td>
    <td data-label="文章"><a href="/archives/${c.cid}/#comment-${c.coid}" target="_blank">#${c.cid}</a></td>
    <td data-label="状态"><span class="badge ${c.status === 'approved' ? 'green' : 'yellow'}">${c.status === 'approved' ? '已通过' : '待审核'}</span></td>
    <td data-label="时间">${new Date(c.created * 1000).toLocaleString('zh-CN')}</td>
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
  if (!coid) return redirect(url, '/admin/comments', { msg: 'err' });
  if (op === 'approve') await db.updateComment(coid, { status: 'approved' });
  else if (op === 'waiting') await db.updateComment(coid, { status: 'waiting' });
  else if (op === 'delete') await db.deleteComment(coid);
  return redirect(url, '/admin/comments', { msg: 'ok' });
}

/* ==================== 附件 ==================== */

async function uploadsPage(ctx) {
  const { db } = ctx;
  const files = (await db.listContents({ type: 'attachment', pageSize: ADMIN_ATTACHMENT_PAGE_SIZE, allStatus: true })).items;
  const rows = files
    .map(
      (f) => `<tr>
    <td data-label="ID">${f.cid}</td>
    <td data-label="类型">${f.fields?.contentType || 'file'}</td>
    <td data-label="文件名"><a href="/upload/${encodeURIComponent(f.slug)}" target="_blank">${esc(f.slug)}</a></td>
    <td data-label="大小">${(f.fields?.size / 1024 || 0).toFixed(1)} KB</td>
    <td data-label="时间">${new Date(f.created * 1000).toLocaleString('zh-CN')}</td>
    <td data-label="地址"><code>/upload/${esc(f.slug)}</code></td>
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
    return redirect(url, '/admin/uploads', { msg: 'err' });
  }
  const originalName = String(file.name || '');
  if (/\.(svg|html?|xhtml)$/i.test(originalName) || /svg|html|xhtml/i.test(file.type || '')) {
    // SVG/HTML 可在本站源下执行脚本，直接拒绝
    return redirect(url, '/admin/uploads', { msg: 'err' });
  }
  const name = `${Date.now().toString(36)}-${originalName.replace(/[^\w.\-]+/g, '_')}`;
  const buf = await file.arrayBuffer();
  if (buf.byteLength > MAX_UPLOAD_BYTES) {
    return redirect(url, '/admin/uploads', { msg: 'err' });
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
  return redirect(url, '/admin/uploads', { msg: 'ok' });
}

/* ==================== 站点设置 ==================== */

/** 开关型下拉（开启/关闭），统一后台设置项的输出结构 */
function onOffSelect(name, value) {
  return `<select name="${name}"><option value="on" ${value !== 'off' ? 'selected' : ''}>开启</option><option value="off" ${value === 'off' ? 'selected' : ''}>关闭</option></select>`;
}

async function settingsPage(ctx) {
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
      <div class="item"><label>建站日期（运行时间）</label><input type="text" name="j_JBirthDay" value="${esc(theme.JBirthDay || '')}" placeholder="2024/01/01（可省略时间）"></div>
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
      <div class="item"><label>最新回复侧栏</label>${onOffSelect('j_JAside_Newreply_Status', theme.JAside_Newreply_Status)}</div>
      <div class="item"><label>人生倒计时侧栏</label>${onOffSelect('j_JAside_Timelife_Status', theme.JAside_Timelife_Status)}</div>
      <div class="item"><label>评论功能</label>${onOffSelect('j_JCommentStatus', theme.JCommentStatus)}</div>
    </div>
    <div class="row">
      <div class="item"><label>便签留言墙（需先建页面“guestbook”）</label>${onOffSelect('j_JGuestbook_Wall', theme.JGuestbook_Wall)}</div>
      <div class="item"><label>舔狗日记侧栏</label>${onOffSelect('j_JAside_Flatterer', theme.JAside_Flatterer)}</div>
      <div class="item"><label>顶置文章IDs（逗号分隔）</label><input type="text" name="j_JStickPosts" value="${esc(theme.JStickPosts || '')}" placeholder="例如：1,2,3"></div>
    </div>
    <div class="row">
      <div class="item"><label>头像源</label><select name="j_JAvatarSource">
        <option value="weavatar" ${theme.JAvatarSource === 'weavatar' ? 'selected' : ''}>WeAvatar (weavatar.com)</option>
        <option value="cravatar" ${theme.JAvatarSource === 'cravatar' ? 'selected' : ''}>Cravatar (cravatar.cn)</option>
        <option value="gravatar" ${theme.JAvatarSource === 'gravatar' ? 'selected' : ''}>Gravatar (gravatar.com)</option>
      </select></div>
      <div class="item"><label>导航最多显示页面数</label><input type="number" name="j_JNavMaxNum" value="${esc(theme.JNavMaxNum || '6')}" min="1" max="20"></div>
      <div class="item"><label>ICP 备案号</label><input type="text" name="j_JICP" value="${esc(theme.JICP || '')}"></div>
    </div>
    <div class="row">
      <div class="item"><label>页脚自定义内容</label><input type="text" name="j_JFooter_Custom" value="${esc(theme.JFooter_Custom || '')}"></div>
    </div>
    <h2 style="font-size:16px;margin:20px 0 14px">首页模块</h2>
    <div class="row">
      <div class="item"><label>首页轮播</label>${onOffSelect('j_JIndex_Carousel_Status', theme.JIndex_Carousel_Status)}</div>
      <div class="item"><label>首页广告</label>${onOffSelect('j_JIndex_Ad_Status', theme.JIndex_Ad_Status)}</div>
    </div>
    <div class="item">
      <label>轮播图数据</label>
      <textarea name="j_JIndex_Carousel" rows="7" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d9d9d9;border-radius:4px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.7" placeholder="https://example.com/1.jpg || https://baidu.com || 百度一下">${esc(theme.JIndex_Carousel || '')}</textarea>
      <p class="hint">用于显示首页轮播图，请务必填写正确的格式<br>格式：图片地址 || 跳转链接 || 标题（中间使用两个竖杠分隔）<br>其他：一行一个，一行代表一个轮播图<br>例如：<br>https://puui.qpic.cn/media_img/lena/PICykqaoi_580_1680/0 || https://baidu.com || 百度一下<br>https://puui.qpic.cn/tv/0/1223447268_1580580/0 || https://v.qq.com || 腾讯视频</p>
    </div>
    <div class="item">
      <label>广告位数据</label>
      <textarea name="j_JIndex_Ad" rows="6" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d9d9d9;border-radius:4px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.7" placeholder="https://example.com/ad.jpg || https://baidu.com">${esc(theme.JIndex_Ad || '')}</textarea>
      <p class="hint">请务必填写正确的格式<br>格式：广告图片 || 广告链接（中间使用两个竖杠分隔）<br>其他：一行一个，最多 8 个；桌面一排最多 4 个，手机一排 2 个<br>例如：<br>https://puui.qpic.cn/media_img/lena/PICykqaoi_580_1680/0 || https://baidu.com<br>https://puui.qpic.cn/tv/0/1223447268_1580580/0 || https://v.qq.com</p>
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
    if (!key.startsWith('j_')) continue;
    const name = key.slice(2);
    if (name === 'JBirthDay') {
      // 建站日期允许省略时间，保存时统一成前端脚本认识的格式
      theme[name] = normalizeBirthday(String(val));
    } else if (name === 'JIndex_Carousel' || name === 'JIndex_Ad') {
      // 多行配置统一换行，保留一行一条
      theme[name] = String(val).replace(/\r\n?/g, '\n').trim();
    } else {
      theme[name] = String(val);
    }
  }
  await db.setOption('theme:joe', theme);
  return redirect(url, '/admin/settings', { msg: 'saved' });
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
      <div class="item"><label>输入当前动态码以关闭两步验证</label><input type="text" name="totp" pattern="\\d{6}" required autocomplete="one-time-code"></div>
      <div class="form-actions">
        <button class="btn danger" type="submit">关闭两步验证</button>
      </div>
    </form>`;
  } else if (step === 'bind') {
    // 生成新密钥并展示二维码
    const secret = generateTotpSecret();
    await db.setOption(`totpPending:${user.uid}`, secret);
    const uri = otpauthUri(secret, user.mail || user.name, ctx.options.title || 'TypechoEdge');
    const qr = totpQrSvg(uri);
    totpSection = `<h2 class="card__title">第一步：扫描二维码</h2>
    <div class="qr-box">${qr.replace('<svg', '<svg width="200" height="200"')}</div>
    <p class="hint qr-hint">使用 Google Authenticator / Microsoft Authenticator / 微信小程序「腾讯身份验证器」等扫描</p>
    <p class="hint qr-hint">无法扫码？手动输入密钥：<code class="qr-secret">${secret}</code></p>
    <h2 class="card__title qr-title">第二步：输入动态码确认绑定</h2>
    <form method="post" action="/admin/security">
      <input type="hidden" name="op" value="enable">
      <div class="item"><label>6 位动态码</label><input type="text" name="totp" pattern="\\d{6}" required autofocus autocomplete="one-time-code"></div>
      <div class="form-actions">
        <button class="btn primary" type="submit">确认开启</button>
      </div>
    </form>`;
  } else {
    totpSection = `<p class="card__intro">
      开启后，登录时除密码外还需输入动态验证码（TOTP，RFC 6238），<br>即使密码泄露也无法登录后台。</p>
    <div class="form-actions form-actions--start">
      <a class="btn primary" href="/admin/security?step=bind">开启两步验证</a>
    </div>`;
  }

  const mcpServers = await loadMcpServers(db);
  const mcpEndpoint = `${url.protocol}//${url.host}`;
  const serverCard = (server) => `<div class="mcp-item">
    <div class="mcp-item__head">
      <strong>${esc(server.name || 'MCP 服务')}</strong>
      ${server.enabled === false ? '<span class="badge yellow">已停用</span>' : '<span class="badge green">已启用</span>'}
      ${server.id === 'legacy' ? '<span class="badge">旧版迁移</span>' : ''}
    </div>
    <p class="mcp-item__remark">${esc(server.remark || '未填写备注')}</p>
    <form method="post" action="/admin/security">
      <input type="hidden" name="op" value="mcp-update">
      <input type="hidden" name="id" value="${esc(server.id)}">
      <div class="row">
        <div class="item"><label>名称</label><input type="text" name="name" value="${esc(server.name || '')}" maxlength="40"></div>
        <div class="item"><label>备注</label><input type="text" name="remark" value="${esc(server.remark || '')}" maxlength="80" placeholder="例如：给 Cursor 用"></div>
        <div class="item"><label>状态</label>${onOffSelect('enabled', server.enabled === false ? 'off' : 'on')}</div>
      </div>
      <div class="item"><label>访问令牌</label><input type="text" name="token" value="${esc(server.token || '')}" autocomplete="off"></div>
      <div class="form-actions form-actions--start"><button class="btn primary" type="submit">保存</button></div>
    </form>
    <div class="form-actions form-actions--start" style="margin-top:10px">
      <form method="post" action="/admin/security"><input type="hidden" name="op" value="mcp-generate"><input type="hidden" name="id" value="${esc(server.id)}"><button class="btn" type="submit">重新生成令牌</button></form>
      <form method="post" action="/admin/security" onsubmit="return confirm('确定删除这个 MCP 令牌？')"><input type="hidden" name="op" value="mcp-delete"><input type="hidden" name="id" value="${esc(server.id)}"><button class="btn danger" type="submit">删除</button></form>
    </div>
    <p class="hint">${server.createdAt ? `创建于 ${new Date(server.createdAt * 1000).toLocaleString('zh-CN')}` : '旧版令牌'}</p>
  </div>`;
  const addCard = `<div class="mcp-item mcp-item--new">
    <div class="mcp-item__head"><strong>新增 MCP</strong></div>
    <form method="post" action="/admin/security">
      <input type="hidden" name="op" value="mcp-add">
      <div class="row">
        <div class="item"><label>名称</label><input type="text" name="name" maxlength="40" placeholder="例如：Claude Desktop"></div>
        <div class="item"><label>备注</label><input type="text" name="remark" maxlength="80" placeholder="用途说明"></div>
        <div class="item"><label>状态</label>${onOffSelect('enabled', 'on')}</div>
      </div>
      <div class="item"><label>令牌（留空自动生成）</label><input type="text" name="token" autocomplete="off" placeholder="留空生成 mcp_..."></div>
      <div class="form-actions form-actions--start"><button class="btn primary" type="submit">创建 MCP</button></div>
    </form>
  </div>`;
  const mcpSection = `<div class="card">
    <h2 class="card__title">MCP 服务</h2>
    <p class="card__intro">可创建多个 MCP 令牌，并分别填写名称/备注区分用途。任一启用令牌都可调用同一 <code>/mcp</code> 端点。</p>
    <div class="mcp-list">${mcpServers.map(serverCard).join('') || '<p class="hint">还没有 MCP 令牌，先创建一个。</p>'}</div>
    ${addCard}
    <p class="hint" style="margin-top:14px">MCP 端点：<code>${esc(mcpEndpoint)}/mcp</code></p>
    <pre style="margin:10px 0 0;padding:12px;background:#f6f8fa;border-radius:6px;font-size:12px;line-height:1.6;overflow:auto;white-space:pre-wrap;word-break:break-all">${esc(mcpClientExample(mcpEndpoint))}</pre>
  </div>`;

  const body = `${MSG(ctx)}
  <h2>安全设置</h2>
  <div class="card">
    ${totpSection}
  </div>
  <div class="card">
    <h2 class="card__title">修改密码</h2>
    <form method="post" action="/admin/security">
      <input type="hidden" name="op" value="password">
      <div class="pwd-grid">
        <div class="item"><label>当前密码</label><input type="password" name="old" required autocomplete="current-password"></div>
        <div class="item"><label>新密码（至少 8 位）</label><input type="password" name="password" required minlength="8" autocomplete="new-password"></div>
        <div class="item"><label>确认新密码</label><input type="password" name="password2" required minlength="8" autocomplete="new-password"></div>
      </div>
      <div class="form-actions">
        <button class="btn primary" type="submit">修改密码</button>
      </div>
    </form>
  </div>
  ${mcpSection}`;
  return html(adminLayout(ctx, { title: '安全设置', active: 'security', body }));
}

async function enableTotp(ctx, form) {
  const { db, url, user } = ctx;
  const secret = await db.getOption(`totpPending:${user.uid}`);
  const code = String(form.get('totp') || '');
  if (!secret || !(await verifyTotp(secret, code))) {
    return redirect(url, '/admin/security', { step: 'bind', msg: 'err' });
  }
  await db.updateUser(user.uid, { totpEnabled: true, totpSecret: secret });
  await db.setOption(`totpPending:${user.uid}`, null);
  return redirect(url, '/admin/security', { msg: 'saved' });
}

async function disableTotp(ctx, form) {
  const { db, url, user } = ctx;
  const code = String(form.get('totp') || '');
  if (!(await verifyTotp(user.totpSecret, code))) {
    return redirect(url, '/admin/security', { msg: 'err' });
  }
  await db.updateUser(user.uid, { totpEnabled: false, totpSecret: null });
  return redirect(url, '/admin/security', { msg: 'ok' });
}

async function changePassword(ctx, form) {
  const { db, url, user } = ctx;
  const old = String(form.get('old') || '');
  const p1 = String(form.get('password') || '');
  const p2 = String(form.get('password2') || '');
  if (!(await verifyPassword(old, user.passwordHash)) || p1.length < MIN_PASSWORD_LENGTH || p1 !== p2) {
    return redirect(url, '/admin/security', { msg: 'err' });
  }
  const { hashPassword } = await import('../auth/password.js');
  await db.updateUser(user.uid, { passwordHash: await hashPassword(p1) });
  return redirect(url, '/admin/security', { msg: 'saved' });
}

const MCP_TOKEN_MIN_LENGTH = 24;
const isValidMcpToken = (token) => token.length >= MCP_TOKEN_MIN_LENGTH && new Set(token).size >= 8;
const newMcpToken = () => `mcp_${randomHex(24)}`;
const tokenTaken = (servers, token, exceptId = '') =>
  servers.some((server) => server.id !== exceptId && server.token === token);

async function addMcpServer(ctx, form) {
  const { db, url } = ctx;
  const servers = await loadMcpServers(db);
  let token = String(form.get('token') || '').trim();
  if (!token) token = newMcpToken();
  if (!isValidMcpToken(token) || tokenTaken(servers, token)) {
    return redirect(url, '/admin/security', { msg: 'err' });
  }
  servers.push({
    id: `mcp_${randomHex(6)}`,
    name: String(form.get('name') || '').trim() || `MCP ${servers.length + 1}`,
    remark: String(form.get('remark') || '').trim(),
    token,
    enabled: form.get('enabled') === 'on',
    createdAt: Math.floor(Date.now() / 1000),
  });
  await saveMcpServers(db, servers);
  return redirect(url, '/admin/security', { msg: 'saved' });
}

async function updateMcpServer(ctx, form) {
  const { db, url } = ctx;
  const id = String(form.get('id') || '');
  const servers = await loadMcpServers(db);
  const index = servers.findIndex((server) => server.id === id);
  if (index < 0) return redirect(url, '/admin/security', { msg: 'err' });
  const token = String(form.get('token') || '').trim() || servers[index].token;
  if (!isValidMcpToken(token) || tokenTaken(servers, token, id)) {
    return redirect(url, '/admin/security', { msg: 'err' });
  }
  servers[index] = {
    ...servers[index],
    name: String(form.get('name') || '').trim() || servers[index].name,
    remark: String(form.get('remark') || '').trim(),
    token,
    enabled: form.get('enabled') === 'on',
  };
  await saveMcpServers(db, servers);
  return redirect(url, '/admin/security', { msg: 'saved' });
}

async function deleteMcpServer(ctx, form) {
  const { db, url } = ctx;
  const id = String(form.get('id') || '');
  const servers = (await loadMcpServers(db)).filter((server) => server.id !== id);
  await saveMcpServers(db, servers);
  return redirect(url, '/admin/security', { msg: 'ok' });
}

async function generateMcpTokenFor(ctx, form) {
  const { db, url } = ctx;
  const id = String(form.get('id') || '');
  const servers = await loadMcpServers(db);
  const index = servers.findIndex((server) => server.id === id);
  if (index < 0) return redirect(url, '/admin/security', { msg: 'err' });
  let token = newMcpToken();
  while (tokenTaken(servers, token)) token = newMcpToken();
  servers[index] = { ...servers[index], token };
  await saveMcpServers(db, servers);
  return redirect(url, '/admin/security', { msg: 'token' });
}

const SECURITY_ACTIONS = new Map([
  ['enable', enableTotp],
  ['disable', disableTotp],
  ['password', changePassword],
  ['mcp-add', addMcpServer],
  ['mcp-update', updateMcpServer],
  ['mcp-generate', generateMcpTokenFor],
  ['mcp-delete', deleteMcpServer],
]);

async function securityAction(ctx) {
  const form = await ctx.request.formData();
  const handler = SECURITY_ACTIONS.get(form.get('op'));
  if (handler) return handler(ctx, form);
  return redirect(ctx.url, '/admin/security');
}

function html(body, init = {}) {
  return new Response(body, {
    ...init,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(init.headers || {}),
    },
  });
}

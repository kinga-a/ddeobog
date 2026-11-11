/**
 * 前台控制器 —— Typecho 默认路由兼容
 *   /                      首页
 *   /page/[page]/          首页分页
 *   /archives/[cid]/       文章
 *   /[slug]/               独立页面
 *   /category/[slug]/      分类
 *   /tag/[slug]/           标签
 *   /author/[uid]/         作者
 *   /search/[kw]/          搜索
 *   /feed/                 RSS/Atom
 *   /comment/[cid]         评论提交（POST）
 *   /joe/api               主题 API
 *   /action/xxx            扩展 action（插件）
 */
import { CONFIG } from '../config.js';
import { currentUser, parseCookies } from '../auth/session.js';
import { verifyPassword, randomHex } from '../auth/password.js';
import * as theme from '../render/theme-joe.js';
import { plainExcerpt } from '../render/markdown.js';
import { escapeHtml, parseStickIds } from '../render/html.js';
import { sameOrigin } from '../auth/session.js';
import { handleJoeApi } from './joe-api.js';
import { runHooks } from '../plugins.js';
import { IS_NODE, DEFAULT_PAGES, ensureDefaultPage } from '../default-pages.js';

/** 普通评论内容上限（字符） */
const MAX_COMMENT_LENGTH = 2000;
/** 画图评论上限（字符）：前端把 canvas 转成 data:image/webp;base64,... 后整体提交 */
const MAX_DRAW_COMMENT_LENGTH = 700 * 1024;
/** 画图评论的合法格式 */
const DRAW_COMMENT_RE = /^\{!\{data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+\}!\}$/;
const MAIL_RE = /^\w+([-+.]\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*$/;

/* ==================== 公开页快照缓存 ====================
 * 匿名访客的页面 HTML 渲染结果存 KV 复用 60 秒，省掉重复的整页渲染与
 * 十几次 KV 读取。响应头保持 html() 的 no-store 不变（浏览器/边缘仍不缓存，
 * 复用只发生在函数内）。正确性护栏：
 * - 登录用户（ctx.user）与带会话/文章密码 cookie 的请求一律绕开——管理员
 *   预览的隐藏文章、已解锁的密码文章既不能读也不能写快照；
 * - 一切内容/评论/分类/设置变更都会在 db 层自增 snap:ver 使快照整表换代
 *   （见 Database.#bumpSnap），只有浏览数这类容忍迟到的数字靠 60 秒 TTL 收敛。
 */
const SNAP_TTL_MS = 60_000;
const SNAP_MAX_BODY = 400_000; // KV 单值大小保险丝，过大页面不存

function snapEligible(ctx) {
  if (ctx.request.method !== 'GET' || ctx.user) return false;
  const { path } = ctx;
  if (path === '/joe/api' || path.startsWith('/comment/')) return false;
  if (path === '/feed' || path === '/feed/' || path === '/sitemap.xml' || path === '/robots.txt') return false;
  // 关于/留言板是自愈路由：页面被删后靠访问时 ensureDefaultPage 重建，
  // 给它们吃快照会把「已删除」状态冻住、重建永不触发，故排除。
  if (path === '/about' || path === '/about/' || path === '/guestbook' || path === '/guestbook/') return false;
  const cookies = parseCookies(ctx.request);
  if (cookies[CONFIG.SESSION_COOKIE] || cookies[CONFIG.POST_PWD_COOKIE]) return false;
  return true;
}

export async function handleFrontend(ctx) {
  if (!snapEligible(ctx)) return handleFrontendInner(ctx);
  const { db, url } = ctx;
  const ver = (await db.kv.getJSON('snap:ver')) || 1;
  const key = `snap:${ver}:${url.pathname}${url.search}`;
  const hit = await db.kv.getJSON(key).catch(() => null);
  if (hit && typeof hit.t === 'number' && Date.now() - hit.t < SNAP_TTL_MS && typeof hit.body === 'string') {
    return html(hit.body);
  }
  const res = await handleFrontendInner(ctx);
  if (res.status === 200 && (res.headers.get('Content-Type') || '').includes('text/html')) {
    try {
      const body = await res.clone().text();
      if (body.length <= SNAP_MAX_BODY) {
        await db.kv.putJSON(key, { t: Date.now(), body });
      }
    } catch { /* 存快照失败不影响本次响应 */ }
  }
  return res;
}

async function handleFrontendInner(ctx) {
  const { db, request, url, path } = ctx;
  const method = request.method;

  // ---- 主题开放 API ----
  if (path === '/joe/api') return handleJoeApi(ctx);

  // ---- 评论提交 ----
  if (path.startsWith('/comment/')) return handleCommentPost(ctx);

  // ---- RSS/Atom ----
  if (path === '/feed' || path === '/feed/' || path === '/feed/atom' || path === '/feed/rss')
    return handleFeed(ctx);

  // ---- SEO：站点地图与 robots ----
  if (path === '/sitemap.xml') return handleSitemap(ctx);
  if (path === '/robots.txt') return handleRobots(ctx);

  // ---- 归档页（导航「归档」）----
  if (path === '/archive' || path === '/archive/') return html(await theme.renderArchivePage(ctx));

  // ---- 留言板（便签墙模式，后台开关 JGuestbook_Wall）----
  if (path === '/guestbook' || path === '/guestbook/') {
    let page = await db.getContentBySlug('guestbook', 'page');
    if (!page && !IS_NODE) page = await ensureDefaultPage(db, 'guestbook');
    // 页面被删除 / Node 预览未创建时用内置文案兜底，避免导航链接 404
    page = page || DEFAULT_PAGES.guestbook;
    if (page.status === 'publish' && ctx.options.joe?.JGuestbook_Wall === 'on') {
      return html(await theme.renderGuestbookWall(ctx, page));
    }
  }

  // ---- 关于页（导航「关于本站」）：优先独立页面 slug=about；边缘端首次访问自动创建 ----
  if (path === '/about' || path === '/about/') {
    let page = await db.getContentBySlug('about', 'page');
    if (!page && !IS_NODE) page = await ensureDefaultPage(db, 'about');
    if (page && page.status === 'publish') return renderSingle(ctx, page);
    return html(await theme.renderAboutPage(ctx));
  }

  // ---- 搜索跳转 ----
  if (path === '/search' && method === 'GET' && url.searchParams.get('s')) {
    return Response.redirect(new URL(`/search/${encodeURIComponent(url.searchParams.get('s'))}/`, url).href, 302);
  }

  const m = (re) => path.match(re);

  // ---- 首页 & 分页 ----
  let page = 1;
  let pageMatch = m(/^\/page\/(\d+)\/?$/);
  let base = '/';
  if (pageMatch) {
    page = parseInt(pageMatch[1], 10);
  } else if (path !== '/' ) {
    // 其他路由往下走
    return await routeInner(ctx);
  }

  // allStatus：登录管理员在列表里也能看到隐藏文章（仍按发布时间排在原位）。
  // 匿名请求走默认的 status=publish，隐藏文章不会出现在任何列表里。
  const list = await db.listContentsIndex({
    type: 'post', page, pageSize: ctx.options.pageSize || CONFIG.PAGE_SIZE,
    allStatus: !!ctx.user,
    // 首页置顶在数据层分页前生效（见 db.listContentsIndex 的 stickIds 处理）
    stickIds: parseStickIds(ctx.options),
  });
  const listWithStats = await db.enrichWithStats(list);
  Object.assign(ctx, { list: listWithStats, page, pageSize: ctx.options.pageSize || CONFIG.PAGE_SIZE });
  return html(await theme.renderIndex(ctx));
}

async function routeInner(ctx) {
  const { db, path, url, request } = ctx;

  let match;

  // /archives/[cid]/ —— GET 看文章，POST 提交文章密码
  if ((match = path.match(/^\/archives\/(\d+)\/?$/))) {
    const cid = parseInt(match[1], 10);
    if (request.method === 'POST') return handlePostUnlock(ctx, cid);

    const post = await db.getContent(cid);
    if (post && post.type === 'post') {
      if (post.status === 'publish') return renderSingle(ctx, post);
      // 非 publish（hidden）只对已登录管理员开放预览，对外仍是 404。
      if (await currentUser(db, request)) {
        ctx.postPreview = true;
        return renderSingle(ctx, post);
      }
    }
    return notFound(ctx);
  }

/** 附件响应头：禁止 MIME 嗅探；SVG/HTML 等危险类型强制下载 */
function fileHeaders(contentType, name) {
  const type = contentType || 'application/octet-stream';
  const dangerous = /svg|html|xhtml/i.test(type);
  return {
    'Content-Type': dangerous ? 'application/octet-stream' : type,
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${dangerous ? 'attachment' : 'inline'}; filename="${encodeURIComponent(name || 'file')}"`,
  };
}

  // /attachment/[cid]/
  if ((match = path.match(/^\/attachment\/(\d+)\/?$/))) {
    const file = await db.getContent(parseInt(match[1], 10));
    if (file && file.type === 'attachment') {
      const blob = await db.blob.get(file.slug);
      if (blob) {
        return new Response(blob.body, { headers: fileHeaders(blob.contentType, file.slug) });
      }
    }
    return notFound(ctx);
  }

  // /category/[slug](/[page])
  if ((match = path.match(/^\/category\/([^/]+?)(?:\/(\d+))?\/?$/))) {
    return renderArchive(ctx, {
      type: 'category',
      slug: decodeURIComponent(match[1]),
      page: parseInt(match[2] || '1', 10),
      titleFor: (m) => `分类 ${m.name} 下的文章`,
      labelFor: (m) => m.name,
      baseUrlFor: (m) => `/category/${encodeURIComponent(m.slug)}/`,
    });
  }

  // /tag/[slug](/[page])
  if ((match = path.match(/^\/tag\/([^/]+?)(?:\/(\d+))?\/?$/))) {
    return renderArchive(ctx, {
      type: 'tag',
      slug: decodeURIComponent(match[1]),
      page: parseInt(match[2] || '1', 10),
      titleFor: (m) => `标签 ${m.name} 下的文章`,
      labelFor: (m) => m.name,
      baseUrlFor: (m) => `/tag/${encodeURIComponent(m.slug)}/`,
    });
  }

  // /author/[uid](/[page])
  if ((match = path.match(/^\/author\/(\d+)(?:\/(\d+))?\/?$/))) {
    const uid = parseInt(match[1], 10);
    const user = await db.getUser(uid);
    if (!user) return notFound(ctx);
    return renderArchive(ctx, {
      type: 'author',
      authorId: uid,
      page: parseInt(match[2] || '1', 10),
      titleFor: () => `${user.screenName} 发布的文章`,
      labelFor: () => user.screenName,
      baseUrlFor: () => `/author/${uid}/`,
    });
  }

  // /search/[kw](/[page])
  if ((match = path.match(/^\/search\/([^/]+?)(?:\/(\d+))?\/?$/))) {
    const kw = decodeURIComponent(match[1]);
    return renderArchive(ctx, {
      type: 'search',
      keywords: kw,
      page: parseInt(match[2] || '1', 10),
      titleFor: () => `包含关键字 ${kw} 的文章`,
      labelFor: () => `搜索 ${kw}`,
      baseUrlFor: () => `/search/${encodeURIComponent(kw)}/`,
    });
  }

  // /upload/[...key] —— 附件直读（Blob/KV）
  if ((match = path.match(/^\/upload\/(.+)$/))) {
    const file = await db.blob.get(decodeURIComponent(match[1]));
    if (file) {
      return new Response(file.body, { headers: fileHeaders(file.contentType, decodeURIComponent(match[1])) });
    }
    return notFound(ctx);
  }

  // 独立页面 /[slug]/
  if ((match = path.match(/^\/([a-zA-Z0-9_-]+)\/?$/)) && path !== '/admin') {
    const page = await db.getContentBySlug(match[1], 'page');
    if (page && page.status === 'publish') return renderSingle(ctx, page);
  }

  return notFound(ctx);
}

/**
 * 校验文章密码。
 * 新写入的是 PBKDF2；库里可能还留着改造前存下的明文，两种都接受。
 * 明文的那部分不在这里顺手迁移——那需要改写文章内容、触发钩子，代价不值当，
 * 等作者下次在后台编辑这篇文章时，后台保存逻辑会自动转成哈希。
 */
async function verifyPostPassword(pass, stored) {
  if (!stored) return false;
  if (stored.startsWith('pbkdf2$')) return verifyPassword(pass, stored);
  return pass === stored;
}

/**
 * 相关推荐：优先同标签、其次同分类，不足 3 条再用最新文章补齐。
 * 这样无标签/单标签文章也不会只出现 1 条推荐，始终保持 3 条卡片布局。
 */
async function buildRelated(db, post, allStatus, limit = 4) {
  const picks = [];
  const seen = new Set([post.cid]);
  const take = (items) => {
    for (const item of items) {
      if (!item || seen.has(item.cid)) continue;
      seen.add(item.cid);
      picks.push(item);
      if (picks.length >= limit) break;
    }
  };

  // 同标签 / 同分类 / 最新 三类候选一次性并行取回，再按优先级填充，
  // 避免标签、分类、兜底查询串行等待多轮 KV 往返。
  const [tagLists, catLists, latest] = await Promise.all([
    Promise.all(
      (post.tags || []).map((mid) => db.listContentsIndex({ type: 'post', pageSize: limit + 1, tagMid: mid, allStatus }))
    ),
    Promise.all(
      (post.categories || []).map((mid) => db.listContentsIndex({ type: 'post', pageSize: limit + 1, categoryMid: mid, allStatus }))
    ),
    db.listContentsIndex({ type: 'post', pageSize: limit + 3, allStatus }),
  ]);
  for (const list of tagLists) {
    if (picks.length >= limit) break;
    take(list.items);
  }
  for (const list of catLists) {
    if (picks.length >= limit) break;
    take(list.items);
  }
  take(latest.items);
  return picks.slice(0, limit);
}

async function renderSingle(ctx, post) {
  const { db, request } = ctx;
  // 密码保护。解锁凭据放在 HttpOnly cookie 里，密码本身只出现在 POST 的请求体中，
  // 不再拼进 URL —— 那样会进浏览器历史、CDN/服务器访问日志和 Referer 头。
  if (post.password) {
    const token = parseCookies(request)[CONFIG.POST_PWD_COOKIE];
    const grant = await db.getPostAccess(token);
    if (!grant || grant.cid !== post.cid) return renderProtected(ctx, post);
  }
  ctx.post = post;
  ctx.isPost = post.type === 'post';

  // 预加载渲染所需数据（并行化，避免渲染时串行查询）
  const [
    { cats, tags },
    author,
    { prev, next },
    stats,
    relatedList,
    commentsHtml,
  ] = await Promise.all([
    theme.contentMetas(db, post),
    db.getUser(post.authorId).then((u) => u || { screenName: '博主', mail: '' }),
    db.prevNext(post.cid, post.type),
    db.getStatsBatch([post.cid]),
    buildRelated(db, post, !!ctx.user),
    theme.commentsBlock(ctx, post),
  ]);

  const views = stats.get(post.cid)?.views || 0;
  const agree = stats.get(post.cid)?.agree || 0;
  const related = relatedList;

  // 存入 ctx 供 renderPost 直接使用，避免重复查询
  Object.assign(ctx, {
    preloaded: { cats, tags, author, prev, next, views, agree, related, commentsHtml },
  });

  // 插件钩子：内容渲染前
  post.text = await runHooks('renderContent', post.text, { post, ctx });
  // 管理员预览的隐藏文章、用 cookie 解锁的密码文章都走这里，
  // 所以不能缓存——html() 默认已给 no-store，这里不再单独设头。
  return html(await theme.renderPost(ctx));
}

/** 密码文章失败限流：同一 IP 对同一篇文章连续失败 5 次后锁定 10 分钟 */
const PWD_MAX_ATTEMPTS = 5;
const PWD_LOCK_MS = 10 * 60 * 1000;

function pwdThrottleKey(cid, request) {
  const ip = (request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')
    || request.headers.get('x-real-ip')
    || 'unknown').split(',')[0].trim();
  // 哈希后作为键，避免把原始 IP 写进 KV
  let h = 5381;
  const raw = `${cid}|${ip}`;
  for (let i = 0; i < raw.length; i += 1) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
  return `pwd_fail:${h.toString(16)}`;
}

async function checkPwdLocked(db, key) {
  const rec = await db.kv.getJSON(key);
  if (!rec) return { locked: false };
  if (rec.until && rec.until > Date.now()) return { locked: true, until: rec.until };
  // 窗口外的旧失败记录直接清掉，避免键无限累积
  if (Date.now() - (rec.at || 0) > PWD_LOCK_MS) {
    await db.kv.delete(key);
    return { locked: false };
  }
  return { locked: (rec.count || 0) >= PWD_MAX_ATTEMPTS };
}

async function recordPwdFailure(db, key) {
  const rec = (await db.kv.getJSON(key)) || { count: 0, at: 0, until: 0 };
  if (Date.now() - (rec.at || 0) > PWD_LOCK_MS) {
    rec.count = 0;
    rec.until = 0;
  }
  rec.count = (rec.count || 0) + 1;
  rec.at = Date.now();
  if (rec.count >= PWD_MAX_ATTEMPTS) rec.until = Date.now() + PWD_LOCK_MS;
  await db.kv.putJSON(key, rec);
  return rec;
}

/**
 * POST /archives/[cid]/ —— 提交文章密码。
 * 密码只从请求体里读，成功后换成 HttpOnly cookie 再 302 回文章页。
 */
async function handlePostUnlock(ctx, cid) {
  const { db, request } = ctx;
  const post = await db.getContent(cid);
  if (!post || post.type !== 'post' || post.status !== 'publish' || !post.password) return notFound(ctx);
  if (!sameOrigin(request)) return new Response('跨站请求被拒绝', { status: 403, headers: { 'Cache-Control': 'no-store' } });

  const lockKey = pwdThrottleKey(post.cid, request);
  if ((await checkPwdLocked(db, lockKey)).locked) {
    return renderProtected(ctx, post, { locked: true, status: 429 });
  }

  let pass = '';
  try {
    // 无 Content-Type 时 request.formData() 会同步抛错，包一层
    pass = String((await request.formData()).get('password') || '');
  } catch {
    pass = '';
  }

  if (pass && (await verifyPostPassword(pass, post.password))) {
    await db.kv.delete(lockKey);
    const token = randomHex(24);
    await db.grantPostAccess(post.cid, token, Date.now() + CONFIG.POST_PWD_TTL * 1000);
    // 303 See Other：POST 之后回到 GET，刷新页面不会重复提交
    return new Response(null, {
      status: 303,
      headers: {
        Location: `/archives/${post.cid}/`,
        'Set-Cookie': `${CONFIG.POST_PWD_COOKIE}=${encodeURIComponent(token)}; Path=/archives/${post.cid}/; HttpOnly; SameSite=Lax; Max-Age=${CONFIG.POST_PWD_TTL}`,
        'Cache-Control': 'no-store',
      },
    });
  }
  await recordPwdFailure(db, lockKey);
  return renderProtected(ctx, post, { wrong: true, status: 401 });
}

function renderProtected(ctx, post, opts = {}) {
  const body = opts.locked
    ? '<p class="joe_detail__article-protected-error">尝试次数过多，请 10 分钟后再试。</p>'
    : `${opts.wrong ? '<p class="joe_detail__article-protected-error">密码不正确，请重新输入。</p>' : ''}
    <form class="joe_detail__article-protected" method="post" action="/archives/${post.cid}/">
      <div class="contain">
        <input class="password" type="password" name="password" placeholder="请输入访问密码..." required autofocus />
        <button class="submit" type="submit">确定</button>
      </div>
    </form>`;
  ctx.contentBody = `<div class="joe_container joe_protected_page"><div class="joe_main joe_post"><div class="joe_detail">
    <h1 class="joe_detail__title">${escapeHtml(post.title)}</h1>
    ${body}
  </div></div></div>`;
  return html(simpleLayout(ctx, `密码保护 - ${ctx.options.title}`), {
    ...(opts.status ? { status: opts.status } : {}),
  });
}

/** 密码保护页的最小布局（不加载主题侧栏/页脚） */
function simpleLayout(ctx, title) {
  // 复用 renderPost 的布局路径：这里直接输出简单页
  const a = (p) => `/usr/themes/joe/${p}`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link href="${a('assets/css/joe.mode.min.css')}" rel="stylesheet"><link href="${a('assets/css/joe.normalize.min.css')}" rel="stylesheet"><link href="${a('assets/css/joe.global.min.css')}" rel="stylesheet"><link href="${a('assets/css/joe.post.min.css')}" rel="stylesheet"><link href="${a('assets/css/joe.refine.css')}" rel="stylesheet">
  </head><body><div id="Joe">${ctx.contentBody}</div></body></html>`;
}

async function renderArchive(ctx, { type, slug, page, titleFor, labelFor, baseUrlFor, authorId, keywords }) {
  const { db } = ctx;
  let meta = null;
  if (slug) {
    meta = await db.getMetaBySlug(slug, type === 'tag' ? 'tag' : 'category');
    if (!meta) return notFound(ctx);
  }
  const q = { type: 'post', page, pageSize: ctx.options.pageSize || CONFIG.PAGE_SIZE, allStatus: !!ctx.user };
  if (meta) q[type === 'tag' ? 'tagMid' : 'categoryMid'] = meta.mid;
  if (authorId) q.authorId = authorId;
  if (keywords) q.keywords = keywords;
  const list = await db.listContentsIndex(q);
  Object.assign(ctx, {
    list: await db.enrichWithStats(list),
    page,
    archiveTitle: titleFor(meta),
    archiveLabel: labelFor ? labelFor(meta) : titleFor(meta),
    archiveBaseUrl: baseUrlFor(meta),
  });
  return html(await theme.renderArchive(ctx));
}

async function notFound(ctx) {
  return html(await theme.render404(ctx), { status: 404 });
}

function html(body, init = {}) {
  // 调用点的习惯是直接把头散在顶层写：html(body, { 'Cache-Control': '...' })。
  // 但 ResponseInit 只认 status / statusText / headers，散在顶层的头会被当成
  // 未知键**静默丢掉**——页面因此一直没真正发过 Cache-Control。这里统一收进 headers。
  const { status, statusText, headers, ...extra } = init;
  return new Response(body, {
    ...(status ? { status } : {}),
    ...(statusText ? { statusText } : {}),
    // HTML 默认一律不缓存，写在默认位而不是逐个调用点：页面里有浏览数、点赞、
    // 评论数这类每次请求都在变的内容，缓存下来只会显示陈旧值；
    // 管理员预览的隐藏文章和用 cookie 解锁的密码文章也走这里，不能让边缘节点存。
    // 真要缓存某类 HTML，显式传 headers 覆盖即可。
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra,
      ...(headers || {}),
    },
  });
}

/** 评论字段校验，返回错误文案（空串表示通过） */
function validateComment({ author, mail, text }) {
  if (!author || author.length > 32) return '昵称不能为空且不能超过32字符';
  if (!MAIL_RE.test(mail)) return '请输入正确的邮箱地址';
  if (!text) return '请输入评论内容';
  if (DRAW_COMMENT_RE.test(text)) {
    if (text.length > MAX_DRAW_COMMENT_LENGTH) return '画图评论过大，请缩小画布后重试';
    return '';
  }
  if (text.length > MAX_COMMENT_LENGTH) return '评论内容过长';
  return '';
}

/** 评论提交（POST /comment/[cid]） */
async function handleCommentPost(ctx) {
  const { db, request, path } = ctx;
  // CSRF：拒绝跨站来源的评论提交（表单可被任意站点诱导提交）
  if (!sameOrigin(request)) return commentError('非法来源');
  const cid = parseInt(path.split('/')[2], 10);
  const post = await db.getContent(cid);
  // 便签留言墙开启时，/guestbook/ 页面即使关闭了普通评论区仍允许贴留言
  const wallEnabled =
    !!post && post.type === 'page' && post.slug === 'guestbook' && ctx.options.joe?.JGuestbook_Wall === 'on';
  if (!post || (!post.allowComment && !wallEnabled)) return commentError('当前页面不可评论');

  const form = await request.formData().catch(() => null);
  if (!form) return commentError('请求格式错误');
  const author = String(form.get('author') || '').trim();
  const mail = String(form.get('mail') || '').trim();
  const urlField = String(form.get('url') || '').trim();
  const text = String(form.get('text') || '').trim();
  const parent = parseInt(String(form.get('parent') || form.get('coid') || '0'), 10) || 0;

  const invalid = validateComment({ author, mail, text });
  if (invalid) return commentError(invalid);

  // 插件钩子：评论提交
  const hooked = await runHooks('commentSubmit', { author, mail, url: urlField, text, parent }, ctx);
  if (hooked && hooked.reject) return commentError(hooked.message || '评论被拒绝');

  const ip = request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || '';
  const agent = request.headers.get('User-Agent') || '';
  const login = ctx.user;
  // 审核开关（commentStatus=waiting）下普通访客的评论先待审；管理员与
  // 文章作者本人直发，免得自己人也被卡进审核队列。
  const privileged = !!login && (login.group === 'administrator' || login.uid === post.authorId);
  const status = ctx.options.commentStatus === 'waiting' && !privileged ? 'waiting' : 'approved';

  await db.createComment({
    cid,
    author: login ? login.screenName : author,
    authorId: login ? login.uid : 0,
    ownerId: post.authorId,
    mail: login ? login.mail : mail,
    url: urlField,
    ip,
    agent,
    text,
    parent,
    status,
  });

  await runHooks('commentPost', { cid, author, text }, ctx);
  if (status === 'waiting') {
    // 待审评论不在前台出现，若按成功协议（含 Joe 标记）返回，前端会刷新
    // 页面、评论者只会看到自己的评论「消失」。改走提示协议：不含 Joe
    // 标记，前端会把 .container 里的文案弹给评论者看。
    return new Response('<!DOCTYPE html><html><body><div class="container">评论已提交，审核通过后显示</div></body></html>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  // Joe 前端约定：响应 HTML 含 "Joe" 即视为成功（刷新页面）
  return new Response('<!DOCTYPE html><html><body><div id="Joe">ok</div></body></html>', {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function commentError(msg) {
  return new Response(
    `<!DOCTYPE html><html><body><div class="container">${escapeHtml(msg)}</div></body></html>`,
    { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

/** RSS/Atom 订阅 */
async function handleFeed(ctx) {
  const { db, url } = ctx;
  const siteUrl = ctx.siteUrl;
  const list = await db.listContentsIndex({ type: 'post', pageSize: 20 });
  const items = await Promise.all(list.items.map((e) => db.getContent(e.cid)));
  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeHtml(ctx.options.title)}</title>
  <subtitle>${escapeHtml(ctx.options.description || '')}</subtitle>
  <id>${siteUrl}/feed/</id>
  <updated>${new Date().toISOString()}</updated>
  <link rel="alternate" href="${siteUrl}/" />
  <link rel="self" href="${siteUrl}/feed/" />
${items
  .filter(Boolean)
  .map(
    (p) => `  <entry>
    <title>${escapeHtml(p.title)}</title>
    <id>${siteUrl}/archives/${p.cid}/</id>
    <link rel="alternate" href="${siteUrl}/archives/${p.cid}/" />
    <published>${new Date(p.created * 1000).toISOString()}</published>
    <updated>${new Date(p.modified * 1000).toISOString()}</updated>
    <summary>${escapeHtml(plainExcerpt(p.text, 200))}</summary>
  </entry>`
  )
  .join('\n')}
</feed>`;
  return new Response(feed, {
    headers: { 'Content-Type': 'application/atom+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}

/* ==================== SEO：sitemap.xml / robots.txt ==================== */

async function handleSitemap(ctx) {
  const { db } = ctx;
  const site = ctx.siteUrl;
  const [posts, pages, cats, tags] = await Promise.all([
    db.listContentsIndex({ type: 'post', pageSize: 100000 }),
    db.listContentsIndex({ type: 'page', pageSize: 100000 }),
    db.listMetas('category'),
    db.listMetas('tag'),
  ]);
  const url = (loc, modified, freq, pri) =>
    `  <url><loc>${escapeHtml(loc)}</loc>${modified ? `<lastmod>${new Date(modified * 1000).toISOString()}</lastmod>` : ''}<changefreq>${freq}</changefreq><priority>${pri}</priority></url>`;
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${url(`${site}/`, null, 'daily', '1.0')}
${posts.items.map((p) => url(`${site}/archives/${p.cid}/`, p.modified, 'weekly', '0.8')).join('\n')}
${pages.items.map((p) => url(`${site}/${encodeURIComponent(p.slug)}/`, p.modified, 'monthly', '0.6')).join('\n')}
${cats.filter((m) => m.count > 0).map((m) => url(`${site}/category/${encodeURIComponent(m.slug)}/`, null, 'weekly', '0.5')).join('\n')}
${tags.filter((m) => m.count > 0).map((m) => url(`${site}/tag/${encodeURIComponent(m.slug)}/`, null, 'weekly', '0.5')).join('\n')}
</urlset>`;
  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}

function handleRobots(ctx) {
  const body = `User-agent: *
Allow: /
Disallow: /admin/
Disallow: /install

Sitemap: ${ctx.siteUrl}/sitemap.xml
`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
  });
}

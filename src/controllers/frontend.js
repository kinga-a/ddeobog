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
import { commentsBlock } from '../render/theme-joe.js';
import { renderMarkdown, plainExcerpt } from '../render/markdown.js';
import { escapeHtml } from '../render/html.js';
import { sameOrigin } from '../auth/session.js';
import { handleJoeApi } from './joe-api.js';
import { runHooks } from '../plugins.js';

export async function handleFrontend(ctx) {
  const { db, request, url, path } = ctx;
  const method = request.method;

  // ---- 主题开放 API ----
  if (path === '/joe/api') return handleJoeApi(ctx);

  // ---- 评论提交 ----
  if (path.startsWith('/comment/')) return handleCommentPost(ctx);

  // ---- RSS/Atom ----
  if (path === '/feed' || path === '/feed/' || path === '/feed/atom' || path === '/feed/rss')
    return handleFeed(ctx);

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

  const list = await db.listContentsIndex({ type: 'post', page, pageSize: ctx.options.pageSize || CONFIG.PAGE_SIZE });
  // 批量获取统计数据
  const cids = list.items.map((e) => e.cid);
  const statsMap = await db.getStatsBatch(cids);
  const items = list.items.map((e) => ({
    ...e,
    views: statsMap.get(e.cid)?.views || 0,
    agree: statsMap.get(e.cid)?.agree || 0,
  }));
  Object.assign(ctx, { list: { ...list, items }, page, pageSize: ctx.options.pageSize || CONFIG.PAGE_SIZE });
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

  // /attachment/[cid]/
  if ((match = path.match(/^\/attachment\/(\d+)\/?$/))) {
    const file = await db.getContent(parseInt(match[1], 10));
    if (file && file.type === 'attachment') {
      const blob = await ctx.db.blob.get(file.slug);
      if (blob) {
        return new Response(blob.body, {
          headers: {
            'Content-Type': blob.contentType,
            'Cache-Control': 'public, max-age=86400',
          },
        });
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
    const file = await ctx.db.blob.get(decodeURIComponent(match[1]));
    if (file) {
      return new Response(file.body, {
        headers: { 'Content-Type': file.contentType, 'Cache-Control': 'public, max-age=86400' },
      });
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
    (async () => {
      const { contentMetas } = await import('../render/theme-joe.js');
      return contentMetas(db, post);
    })(),
    db.getUser(post.authorId).then((u) => u || { screenName: '博主', mail: '' }),
    db.prevNext(post.cid, post.type),
    db.getStatsBatch([post.cid]),
    db.listContentsIndex({ type: 'post', pageSize: 4, tagMid: post.tags?.[0] }),
    (async () => {
      const { commentsBlock } = await import('../render/theme-joe.js');
      return commentsBlock(ctx, post);
    })(),
  ]);

  const views = stats.get(post.cid)?.views || 0;
  const agree = stats.get(post.cid)?.agree || 0;
  const related = relatedList.items.filter((r) => r.cid !== post.cid).slice(0, 3);

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

/**
 * POST /archives/[cid]/ —— 提交文章密码。
 * 密码只从请求体里读，成功后换成 HttpOnly cookie 再 302 回文章页。
 */
async function handlePostUnlock(ctx, cid) {
  const { db, request } = ctx;
  const post = await db.getContent(cid);
  if (!post || post.type !== 'post' || post.status !== 'publish' || !post.password) return notFound(ctx);
  if (!sameOrigin(request)) return new Response('跨站请求被拒绝', { status: 403, headers: { 'Cache-Control': 'no-store' } });

  let pass = '';
  try {
    // 无 Content-Type 时 request.formData() 会同步抛错，包一层
    pass = String((await request.formData()).get('password') || '');
  } catch {
    pass = '';
  }

  if (pass && (await verifyPostPassword(pass, post.password))) {
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
  return renderProtected(ctx, post, { wrong: true, status: 401 });
}

function renderProtected(ctx, post, opts = {}) {
  ctx.contentBody = `<div class="joe_container"><div class="joe_main joe_post"><div class="joe_detail">
    <h1 class="joe_detail__title">${escapeHtml(post.title)}</h1>
    ${opts.wrong ? '<p class="joe_detail__article-protected-error">密码不正确，请重新输入。</p>' : ''}
    <form class="joe_detail__article-protected" method="post" action="/archives/${post.cid}/">
      <div class="contain">
        <input class="password" type="password" name="password" placeholder="请输入访问密码..." required autofocus />
        <button class="submit" type="submit">确定</button>
      </div>
    </form>
  </div></div></div>`;
  return html(theme404Layout(ctx, `密码保护 - ${ctx.options.title}`), {
    ...(opts.status ? { status: opts.status } : {}),
  });
}

function theme404Layout(ctx, title) {
  // 复用 renderPost 的布局路径：这里直接输出简单页
  const a = (p) => `/usr/themes/joe/${p}`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link href="${a('assets/css/joe.mode.min.css')}" rel="stylesheet"><link href="${a('assets/css/joe.normalize.min.css')}" rel="stylesheet"><link href="${a('assets/css/joe.global.min.css')}" rel="stylesheet"><link href="${a('assets/css/joe.post.min.css')}" rel="stylesheet">
  </head><body><div id="Joe">${ctx.contentBody}</div></body></html>`;
}

async function renderArchive(ctx, { type, slug, page, titleFor, labelFor, baseUrlFor, authorId, keywords }) {
  const { db } = ctx;
  let meta = null;
  if (slug) {
    meta = await db.getMetaBySlug(slug, type === 'tag' ? 'tag' : 'category');
    if (!meta) return notFound(ctx);
  }
  const q = { type: 'post', page, pageSize: ctx.options.pageSize || CONFIG.PAGE_SIZE };
  if (meta) q[type === 'tag' ? 'tagMid' : 'categoryMid'] = meta.mid;
  if (authorId) q.authorId = authorId;
  if (keywords) q.keywords = keywords;
  const list = await db.listContentsIndex(q);
  // 批量获取统计数据
  const cids = list.items.map((e) => e.cid);
  const statsMap = await db.getStatsBatch(cids);
  const items = list.items.map((e) => ({
    ...e,
    views: statsMap.get(e.cid)?.views || 0,
    agree: statsMap.get(e.cid)?.agree || 0,
  }));
  Object.assign(ctx, {
    list: { ...list, items },
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

/** 评论提交（POST /comment/[cid]） */
async function handleCommentPost(ctx) {
  const { db, request, url, path } = ctx;
  // CSRF：拒绝跨站来源的评论提交（表单可被任意站点诱导提交）
  if (!sameOrigin(request)) return commentError('非法来源');
  const cid = parseInt(path.split('/')[2], 10);
  const post = await db.getContent(cid);
  if (!post || !post.allowComment) return commentError('当前页面不可评论');

  const form = await request.formData().catch(() => null);
  if (!form) return commentError('请求格式错误');
  const author = String(form.get('author') || '').trim();
  const mail = String(form.get('mail') || '').trim();
  const urlField = String(form.get('url') || '').trim();
  let text = String(form.get('text') || '').trim();
  const parent = parseInt(String(form.get('parent') || form.get('coid') || '0'), 10) || 0;

  if (!author || author.length > 32) return commentError('昵称不能为空且不能超过32字符');
  if (!/^\w+([-+.]\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*$/.test(mail)) return commentError('请输入正确的邮箱地址');
  if (!text) return commentError('请输入评论内容');
  if (text.length > 2000) return commentError('评论内容过长');
  // 画图评论 {!{data:image...}!} 长度放宽
  if (text.length > 2000 && !/^\{!\{/.test(text)) return commentError('评论内容过长');

  // 插件钩子：评论提交
  const hooked = await runHooks('commentSubmit', { author, mail, url: urlField, text, parent }, ctx);
  if (hooked && hooked.reject) return commentError(hooked.message || '评论被拒绝');

  const ip = request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || '';
  const agent = request.headers.get('User-Agent') || '';
  const login = ctx.user;

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
    status: 'approved', // 可按需改为 waiting（审核）
  });

  await runHooks('commentPost', { cid, author, text }, ctx);
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

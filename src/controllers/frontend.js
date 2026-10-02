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
import * as theme from '../render/theme-joe.js';
import { renderMarkdown, plainExcerpt } from '../render/markdown.js';
import { escapeHtml } from '../render/html.js';
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

  const list = await db.listContents({ type: 'post', page, pageSize: ctx.options.pageSize || CONFIG.PAGE_SIZE });
  const items = await Promise.all(list.items.map(async (p) => ({
    ...p,
    views: await db.getStat(p.cid, 'views'),
    agree: await db.getStat(p.cid, 'agree'),
  })));
  Object.assign(ctx, { list, page, pageSize: ctx.options.pageSize || CONFIG.PAGE_SIZE });
  return html(await theme.renderIndex(ctx), { 'Cache-Control': 'public, max-age=60' });
}

async function routeInner(ctx) {
  const { db, path, url } = ctx;

  let match;

  // /archives/[cid]/
  if ((match = path.match(/^\/archives\/(\d+)\/?$/))) {
    const post = await db.getContent(parseInt(match[1], 10));
    if (post && post.type === 'post' && post.status === 'publish') return renderSingle(ctx, post);
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

async function renderSingle(ctx, post) {
  const { db } = ctx;
  // 密码保护
  if (post.password) {
    const pass = ctx.url.searchParams.get('password');
    if (pass !== post.password) {
      return renderProtected(ctx, post);
    }
  }
  ctx.post = post;
  ctx.isPost = post.type === 'post';
  // 插件钩子：内容渲染前
  post.text = await runHooks('renderContent', post.text, { post, ctx });
  return html(await theme.renderPost(ctx));
}

function renderProtected(ctx, post) {
  ctx.contentBody = `<div class="joe_container"><div class="joe_main joe_post"><div class="joe_detail">
    <h1 class="joe_detail__title">${escapeHtml(post.title)}</h1>
    <form class="joe_detail__article-protected" method="get" action="/archives/${post.cid}/">
      <div class="contain">
        <input class="password" type="password" name="password" placeholder="请输入访问密码..." />
        <button class="submit" type="submit">确定</button>
      </div>
    </form>
  </div></div></div>`;
  return html(theme404Layout(ctx, `密码保护 - ${ctx.options.title}`));
}

function theme404Layout(ctx, title) {
  // 复用 renderPost 的布局路径：这里直接输出简单页
  const a = (p) => `/usr/themes/joe/${p}`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link href="${a('assets/css/joe.mode.min.css')}" rel="stylesheet"><link href="${a('assets/css/joe.normalize.min.css')}" rel="stylesheet"><link href="${a('assets/css/joe.global.min.css')}" rel="stylesheet"><link href="${a('assets/css/joe.post.min.css')}" rel="stylesheet">
  </head><body><div id="Joe">${ctx.contentBody}</div></body></html>`;
}

async function renderArchive(ctx, { type, slug, page, titleFor, baseUrlFor, authorId, keywords }) {
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
  const list = await db.listContents(q);
  Object.assign(ctx, {
    list,
    page,
    archiveTitle: titleFor(meta),
    archiveBaseUrl: baseUrlFor(meta),
  });
  return html(await theme.renderArchive(ctx));
}

async function notFound(ctx) {
  return html(await theme.render404(ctx), { status: 404 });
}

function html(body, init = {}) {
  return new Response(body, {
    ...init,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...(init.headers || {}) },
  });
}

/** 评论提交（POST /comment/[cid]） */
async function handleCommentPost(ctx) {
  const { db, request, url, path } = ctx;
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
  const { items } = await db.listContents({ type: 'post', pageSize: 20 });
  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeHtml(ctx.options.title)}</title>
  <subtitle>${escapeHtml(ctx.options.description || '')}</subtitle>
  <id>${siteUrl}/feed/</id>
  <updated>${new Date().toISOString()}</updated>
  <link rel="alternate" href="${siteUrl}/" />
  <link rel="self" href="${siteUrl}/feed/" />
${items
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
    headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' },
  });
}

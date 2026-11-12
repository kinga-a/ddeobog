/**
 * TypechoEdge 主入口 —— EdgeOne Edge Function
 * 部署为 edge-functions/[[default]].js（构建产物，勿直接修改本文件的调用方）
 */
import { CONFIG } from './config.js';
import { createDatabase } from './db.js';
import { currentUser } from './auth/session.js';
import { handleInstall } from './controllers/install.js';
import { handleAdmin } from './controllers/admin.js';
import { handleFrontend } from './controllers/frontend.js';
import { handleMcp } from './mcp.js';
import { escapeHtml } from './render/markdown.js';
import { runHooks, runAction, hasAction, loadBuiltinPlugins } from './plugins.js';
import { setOwoMap, JOE_DEFAULTS } from './render/theme-joe.js';
import owoJson from './owo.js';
import { createRequestLogger, createRequestId, requestMeta, safePath } from './logging.js';
import {
  applySecurityHeaders,
  checkAdminAllowList,
  isAdminPath,
  readSecurityConfig,
} from './security.js';

let pluginsLoaded = false;

export default async function onRequest(context) {
  const { request, env, waitUntil } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const started = Date.now();
  const requestId = createRequestId();
  const logger = createRequestLogger(env, waitUntil);
  const meta = requestMeta(request);

  try {
    // 所有响应统一补安全头，并记录一行结构化日志（EdgeOne 函数日志可检索）
    const done = (res) => {
      const out = applySecurityHeaders(res);
      logger.info({
        requestId,
        method: request.method,
        path: safePath(path),
        status: out.status,
        ms: Date.now() - started,
        ...meta,
      });
      return out;
    };
    // 加载内置插件（进程生命周期内一次）
    if (!pluginsLoaded) {
      await loadBuiltinPlugins();
      pluginsLoaded = true;
    }

    // ---- 可选 IP 白名单（默认关闭；/admin 与 /mcp）----
    if (isAdminPath(path)) {
      const guard = checkAdminAllowList(request, readSecurityConfig(env));
      if (!guard.allowed) {
        return done(new Response('Forbidden', {
          status: 403,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }));
      }
    }

    const db = env?.__database || (await createDatabase(env));

    // ---- 安装向导（未安装时强制进入）----
    const installed = await db.isInstalled();
    if (!installed && !path.startsWith('/install') && !path.startsWith('/usr/') && path !== '/favicon.ico') {
      return done(Response.redirect(new URL('/install', url).href, 302));
    }
    if (path.startsWith('/install')) {
      return done((await handleInstall({ db, request, url, path })) || new Response('Not Found', { status: 404 }));
    }

    // /usr/ 下的真实静态资源由平台的静态资源层先行响应，不会走到函数；
    // 能落到这里的都是不存在的文件（JS/CSS/图片路径写错等），直接 404，
    // 否则会继续往下走渲染逻辑并抛 500。
    if (path.startsWith('/usr/')) {
      return done(new Response('Not Found', { status: 404 }));
    }

    // ---- 组装全局上下文 ----
    const optionsRaw = await db.getOptions();
    const joe = { ...JOE_DEFAULTS, ...(optionsRaw['theme:joe'] || {}) };
    // 旧默认 link.png 迁移到新 favicon；空值回退默认，避免标签页图标空白
    if (!joe.JFavicon || joe.JFavicon === '/usr/themes/joe/assets/img/link.png') {
      joe.JFavicon = JOE_DEFAULTS.JFavicon;
    }
    const options = {
      title: optionsRaw.title || '我的博客',
      description: optionsRaw.description || '',
      keywords: optionsRaw.keywords || '',
      pageSize: optionsRaw.pageSize || CONFIG.PAGE_SIZE,
      commentStatus: optionsRaw.commentStatus || 'approved',
      theme: optionsRaw.theme || CONFIG.DEFAULT_THEME,
      themeAssetsBase: '/usr/themes/joe',
      joe,
    };

    const auth = await currentUser(db, request);
    const user = auth?.user || null;

    // 独立页面列表（导航）
    // 导航只需要标题/slug，使用索引避免把所有页面正文读进内存
    const pagesList = await db.listContentsIndex({ type: 'page', pageSize: 50 });
    const pages = pagesList.items.map((p) => ({
      cid: p.cid,
      title: p.title,
      slug: p.slug,
      permalink: `/${p.slug}/`,
    }));

    const ctx = {
      db,
      request,
      url,
      path,
      env,
      options,
      user,
      pages,
      siteUrl: `${url.protocol}//${url.host}`,
      pageSize: options.pageSize,
      csrfToken: auth?.token ? auth.token.slice(0, 16) : '',
    };

    // Owo 表情映射（评论渲染用）
    setOwoMap(owoJson);

    // 根路径图标跟随站点设置里的 Favicon URL，而不是硬编码本地文件
    if (path === '/favicon.ico') {
      const fallback = JOE_DEFAULTS.JFavicon;
      const configured = String(options.joe.JFavicon || '').trim();
      let target;
      try {
        target = new URL(configured || fallback, url);
      } catch {
        target = new URL(fallback, url);
      }
      // 防止把 /favicon.ico 指回自身造成重定向循环
      if (target.host === url.host && target.pathname === '/favicon.ico') {
        target = new URL(fallback, url);
      }
      return done(new Response(null, {
        status: 302,
        headers: { Location: target.href, 'Cache-Control': 'public, max-age=300' },
      }));
    }

    // ---- MCP（Model Context Protocol）----
    if (path === '/mcp' || path === '/mcp/') return done(await handleMcp(ctx));

    // ---- 插件：自定义路由 ----
    const custom = await runHooks('route', null, ctx);
    if (custom instanceof Response) return done(custom);

    // ---- 插件 action（/action/[name]，对应 Typecho Widget\Action）----
    const actionMatch = path.match(/^\/action\/([a-zA-Z0-9_-]+)\/?$/);
    if (actionMatch) {
      if (hasAction(actionMatch[1])) {
        return done(await runAction(actionMatch[1], ctx));
      }
      return done(new Response('Action Not Found', { status: 404 }));
    }

    // ---- 后台 ----
    if (path === '/admin' || path.startsWith('/admin/')) {
      return done(await handleAdmin(ctx));
    }

    // ---- 前台 ----
    const res = await handleFrontend(ctx);

    // ---- 插件：响应前 ----
    const finalRes = await runHooks('response', res, ctx);
    return done(finalRes instanceof Response ? finalRes : res);
  } catch (e) {
    logger.error({
      requestId,
      method: request.method,
      path: safePath(path),
      status: 500,
      ms: Date.now() - started,
      message: String(e?.message || e).slice(0, 300),
      stack: String(e?.stack || '').slice(0, 800),
      ...meta,
    });
    return applySecurityHeaders(errorPage(e));
  }
}

/** 统一的 500 错误页（含 KV 绑定提示） */
function errorPage(error) {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>服务异常</title></head>
       <body style="font-family:sans-serif;padding:40px;color:#333">
       <h2>500 服务异常</h2>
       <pre style="background:#f6f8fa;padding:16px;border-radius:8px;white-space:pre-wrap">${escapeHtml(String(error?.message || error))}</pre>
       <p>如果提示未找到 KV 绑定，请在 EdgeOne 控制台将 KV 命名空间以变量名 <code>BLOG_KV</code> 绑定到本项目后重试。</p>
       </body></html>`,
    { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

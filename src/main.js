/**
 * TypechoEdge 主入口 —— EdgeOne Edge Function
 * 部署为 edge-functions/[[default]].js（构建产物，勿直接修改本文件的调用方）
 */
import { CONFIG } from './config.js';
import { createDatabase } from './db.js';
import { currentUser, parseCookies } from './auth/session.js';
import { handleInstall } from './controllers/install.js';
import { handleAdmin } from './controllers/admin.js';
import { handleFrontend } from './controllers/frontend.js';
import { runHooks, runAction, hasAction, loadBuiltinPlugins } from './plugins.js';
import { setOwoMap, setThemeContext, JOE_DEFAULTS } from './render/theme-joe.js';
import owoJson from './owo.js';

let pluginsLoaded = false;

export default async function onRequest(context) {
  const { request, env, waitUntil } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  try {
    // 加载内置插件（进程生命周期内一次）
    if (!pluginsLoaded) {
      await loadBuiltinPlugins();
      pluginsLoaded = true;
    }

    const db = await createDatabase(env);

    // ---- 安装向导（未安装时强制进入）----
    const installed = await db.isInstalled();
    if (!installed && !path.startsWith('/install') && !path.startsWith('/usr/')) {
      return Response.redirect(new URL('/install', url).href, 302);
    }
    if (path.startsWith('/install')) {
      return (await handleInstall({ db, request, url, path })) || new Response('Not Found', { status: 404 });
    }

    // ---- 组装全局上下文 ----
    const optionsRaw = await db.getOptions();
    const options = {
      title: optionsRaw.title || '我的博客',
      description: optionsRaw.description || '',
      keywords: optionsRaw.keywords || '',
      pageSize: optionsRaw.pageSize || CONFIG.PAGE_SIZE,
      commentStatus: optionsRaw.commentStatus || 'approved',
      theme: optionsRaw.theme || CONFIG.DEFAULT_THEME,
      themeAssetsBase: '/usr/themes/joe',
      joe: { ...JOE_DEFAULTS, ...(optionsRaw['theme:joe'] || {}) },
    };

    const auth = await currentUser(db, request);
    const user = auth?.user || null;

    // 独立页面列表（导航）
    const pagesList = await db.listContents({ type: 'page', pageSize: 50 });
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
    setThemeContext(ctx);

    // ---- 插件：自定义路由 ----
    const custom = await runHooks('route', null, ctx);
    if (custom instanceof Response) return custom;

    // ---- 插件 action（/action/[name]，对应 Typecho Widget\Action）----
    const actionMatch = path.match(/^\/action\/([a-zA-Z0-9_-]+)\/?$/);
    if (actionMatch) {
      if (hasAction(actionMatch[1])) {
        return await runAction(actionMatch[1], ctx);
      }
      return new Response('Action Not Found', { status: 404 });
    }

    // ---- 后台 ----
    if (path === '/admin' || path.startsWith('/admin/')) {
      return await handleAdmin(ctx);
    }

    // ---- 前台 ----
    const res = await handleFrontend(ctx);

    // ---- 插件：响应前 ----
    const finalRes = await runHooks('response', res, ctx);
    return finalRes instanceof Response ? finalRes : res;
  } catch (e) {
    console.error('[TypechoEdge]', e);
    return new Response(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>服务异常</title></head>
       <body style="font-family:sans-serif;padding:40px;color:#333">
       <h2>500 服务异常</h2>
       <pre style="background:#f6f8fa;padding:16px;border-radius:8px;white-space:pre-wrap">${String(e?.message || e)}</pre>
       <p>如果提示未找到 KV 绑定，请在 EdgeOne 控制台将 KV 命名空间以变量名 <code>BLOG_KV</code> 绑定到本项目后重试。</p>
       </body></html>`,
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

/**
 * 安装向导 —— 首次访问时引导创建管理员账号，写入 KV
 * 对应 Typecho install.php 流程（简化为一页）
 */
import { hashPassword } from '../auth/password.js';
import { escapeHtml } from '../render/markdown.js';

export async function handleInstall(ctx) {
  const { db, request, path } = ctx;

  if (path.startsWith('/install')) {
    if (request.method === 'POST') {
      return await doInstall(ctx);
    }
    return installPage(ctx);
  }
  return null;
}

function installPage(ctx, error = '') {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>安装 - TypechoEdge</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; background: #f4f5f7; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .card { background: #fff; border-radius: 12px; box-shadow: 0 2px 20px rgba(0,0,0,.08); max-width: 460px; width: 100%; padding: 40px; }
  h1 { font-size: 22px; color: #24292f; margin-bottom: 6px; }
  .sub { color: #57606a; font-size: 13px; margin-bottom: 28px; line-height: 1.6; }
  .item { margin-bottom: 16px; }
  label { display: block; font-size: 13px; color: #24292f; margin-bottom: 6px; font-weight: 600; }
  input, select { width: 100%; padding: 10px 12px; border: 1px solid #d0d7de; border-radius: 6px; font-size: 14px; outline: none; }
  input:focus { border-color: #0969da; box-shadow: 0 0 0 3px rgba(9,105,218,.15); }
  button { width: 100%; padding: 12px; background: #1a1f24; color: #fff; border: 0; border-radius: 6px; font-size: 15px; cursor: pointer; margin-top: 8px; }
  button:hover { background: #30363d; }
  .err { background: #ffebe9; color: #cf222e; border: 1px solid #ffcecb; border-radius: 6px; padding: 10px 12px; font-size: 13px; margin-bottom: 16px; }
  .tip { font-size: 12px; color: #8b949e; margin-top: 16px; line-height: 1.6; }
</style>
</head>
<body>
  <div class="card">
    <h1>欢迎使用 TypechoEdge</h1>
    <div class="sub">运行在腾讯 EdgeOne 边缘函数上的 Typecho 兼容博客。<br>首次使用请创建管理员账号，数据将保存到 KV 存储与 Blob 存储。</div>
    ${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
    <form method="post" action="/install">
      <div class="item">
        <label>站点名称</label>
        <input type="text" name="title" value="我的博客" required>
      </div>
      <div class="item">
        <label>站点描述</label>
        <input type="text" name="description" value="一个运行在边缘的博客">
      </div>
      <div class="item">
        <label>管理员用户名</label>
        <input type="text" name="name" placeholder="admin" required pattern="[A-Za-z0-9_@.\-]{3,32}">
      </div>
      <div class="item">
        <label>邮箱</label>
        <input type="email" name="mail" placeholder="admin@example.com" required>
      </div>
      <div class="item">
        <label>密码（至少 8 位）</label>
        <input type="password" name="password" required minlength="8">
      </div>
      <div class="item">
        <label>确认密码</label>
        <input type="password" name="password2" required minlength="8">
      </div>
      <button type="submit">创建账号并完成安装</button>
    </form>
    <div class="tip">安装后可在后台「安全设置」中开启 TOTP 两步验证（Google Authenticator / 微信小程序「腾讯身份验证器」等均兼容）。</div>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function doInstall(ctx) {
  const { db, request, url } = ctx;
  const form = await request.formData();
  const title = String(form.get('title') || '我的博客').trim();
  const description = String(form.get('description') || '').trim();
  const name = String(form.get('name') || '').trim();
  const mail = String(form.get('mail') || '').trim().toLowerCase();
  const password = String(form.get('password') || '');
  const password2 = String(form.get('password2') || '');

  if (!/^[A-Za-z0-9_@.\-]{3,32}$/.test(name)) return installPage(ctx, '用户名格式不正确（3-32位字母数字 @ . _ -）');
  if (!/^\S+@\S+\.\S+$/.test(mail)) return installPage(ctx, '邮箱格式不正确');
  if (password.length < 8) return installPage(ctx, '密码至少 8 位');
  if (password !== password2) return installPage(ctx, '两次输入的密码不一致');
  if (await db.getUserByName(name)) return installPage(ctx, '用户名已存在');

  await db.createUser({
    name,
    mail,
    password,
    screenName: name,
    group: 'administrator',
  });

  // 默认配置（对应 Typecho options 表）
  const defaults = {
    title,
    description,
    keywords: '',
    timezone: '8',
    installed: 1,
    pageSize: 10,
    theme: 'joe',
    commentsRequireMail: true,
    commentsRequireURL: false,
    commentsThreaded: true,
    commentsMaxNestingLevels: 999,
    commentStatus: 'approved', // approved 直发 / waiting 先审
    siteCreated: Math.floor(Date.now() / 1000),
  };
  for (const [k, v] of Object.entries(defaults)) await db.setOption(k, v);
  // Joe 主题默认配置
  const { JOE_DEFAULTS } = await import('../render/theme-joe.js');
  await db.setOption('theme:joe', JOE_DEFAULTS);

  // 示例首篇文章
  await db.createContent({
    title: 'Hello TypechoEdge',
    slug: 'hello',
    text: `欢迎使用 **TypechoEdge**！

这是一个运行在 \`腾讯 EdgeOne\` 边缘函数上的博客系统，完全兼容 Typecho 数据模型与 Joe 主题。

## 特性

- 数据存储在 **KV 存储**（结构化数据）与 **Blob 存储**（附件）
- 支持 **Markdown** 写作（标题、代码块、表格、图片……）
- 首次访问一键安装，账号数据存放在 KV 空间
- 登录支持 **TOTP 两步验证**（RFC 6238，兼容各类验证器 App）
- 兼容 Typecho 路由：\`/archives/1/\`、\`/category/xx/\`、\`/tag/xx/\`
- 插件系统：JS 钩子机制对应 Typecho 插件接口

<!--more-->

## 开始写作

登录 \`/admin\` 后台，新建你的第一篇文章吧！

\`\`\`js
console.log('Hello from EdgeOne Edge Functions!');
\`\`\`

> 数据全部保存在你绑定的 KV 命名空间中，可随时在控制台查看。`,
    authorId: 1,
    type: 'post',
    fields: { thumb: '', abstract: '欢迎使用 TypechoEdge —— EdgeOne 边缘函数上的 Typecho 兼容博客' },
  });

  // 示例分类
  await db.createMeta({ name: '默认分类', slug: 'default', type: 'category', description: '默认分类' });

  return new Response(null, {
    status: 302,
    headers: { Location: '/admin?installed=1' },
  });
}

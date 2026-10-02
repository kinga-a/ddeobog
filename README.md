# ddeobog

> TypechoEdge —— 运行在腾讯 EdgeOne Pages 上的 Typecho 兼容博客


[![Typecho](https://img.shields.io/badge/Typecho-兼容数据模型/路由-467B61)](https://github.com/typecho/typecho) [![Joe](https://img.shields.io/badge/主题-Joe%208.0-ff6a18)](https://github.com/HaoOuBa/Joe) [![EdgeOne](https://img.shields.io/badge/EdgeOne-边缘函数%20%2B%20KV%20%2B%20Blob-0052d9)](https://edgeone.ai)

将 [Typecho](https://github.com/typecho/typecho) 博客系统与 [Joe](https://github.com/HaoOuBa/Joe) 主题移植到**腾讯 EdgeOne Pages 边缘函数**运行：

- **零服务器**：全部逻辑运行在 EdgeOne 边缘函数（Edge Functions），无需 PHP / MySQL
- **KV 存储**：文章、页面、分类、标签、评论、用户账号、配置全部存放在 EdgeOne KV 命名空间
- **Blob 存储**：上传的图片等附件存放在 EdgeOne Blob（无 SDK 环境自动降级 KV）
- **首次访问安装**：浏览器打开网站即引导创建管理员账号（存入 KV）
- **TOTP 两步验证**：RFC 6238 标准动态口令（Google Authenticator 等），后台扫码绑定
- **Typecho 路由兼容**：`/archives/[cid]/`、`/category/[slug]/`、`/tag/[slug]/`、`/author/[uid]/`、`/search/[kw]/`、`/feed/`、`/action/[name]`
- **Joe 主题复刻**：复用 Joe 原版 CSS/JS/表情包/字体图标静态资源，DOM 结构一致；灯箱、代码高亮、点赞、浏览量统计、Owo 表情、画图评论、暗黑模式全部可用
- **插件系统**：JS 钩子机制对应 Typecho 插件接口，内置 2 个示例插件

## 目录结构

```
typecho-edgeone/
├── src/                     # 源码（构建打包为单文件边缘函数）
│   ├── main.js              # 入口：路由分发
│   ├── db.js                # 数据层：Typecho 7 表 → KV 文档
│   ├── storage/kv.js        # EdgeOne KV 封装
│   ├── storage/blob.js      # EdgeOne Blob 封装（含 KV 降级）
│   ├── auth/password.js     # PBKDF2-SHA256 密码哈希
│   ├── auth/session.js      # Cookie + KV 会话
│   ├── auth/totp.js         # TOTP（RFC 6238）+ SVG 二维码生成
│   ├── render/markdown.js   # HyperDown 兼容 Markdown 渲染器
│   ├── render/theme-joe.js  # Joe 主题服务端渲染
│   ├── controllers/         # 前台 / 后台 / 安装 / Joe API
│   ├── plugins.js           # 插件系统
│   └── plugins-builtin/     # 内置插件
├── usr/themes/joe/assets/   # Joe 主题静态资源（原版复制）
├── edge-functions/          # 构建产物（边缘函数，平台自动路由）
├── functions/               # 构建产物（Pages Functions 风格目录，二选一生效）
├── build.mjs                # esbuild 打包脚本
└── edgeone.json             # 构建配置
```

## 部署步骤（EdgeOne Pages）

### 1. 创建项目

1. 将本目录推送到 GitHub 仓库
2. 登录 [EdgeOne Pages 控制台](https://console.tencentcloud.com/edgeone/pages)，**创建项目 → 导入 Git 仓库**
3. 构建配置（`edgeone.json` 已写好，控制台确认即可）：
   - 构建命令：`npm run build`
   - 输出目录：`.`（仓库根目录，静态资源 `usr/` 与函数目录 `edge-functions/` 一并部署）

### 2. 绑定 KV 存储（必须）

1. 控制台进入 **存储 → KV**，开通并创建命名空间（如 `typecho-blog`）
2. 进入项目详情 → **KV 存储** → 绑定命名空间
3. **运行时变量名填 `BLOG_KV`**（对应 `src/config.js` 中的 `KV_BINDING`，可自定义）
4. 重新部署一次使绑定生效

> 未绑定 KV 时访问会返回 500 并提示绑定方法。

### 3. Blob 存储（可选，附件上传用）

- 安装依赖已包含 `@edgeone/pages-blob`，首次上传附件时自动创建 `typecho-uploads` 命名空间
- 若运行环境不支持，自动降级为 KV 存储（文件 ≤ 25MB）
- 免费版单账户 Blob 容量 1GB
- ⚠️ 平台限制：Edge Functions 请求体上限 **1 MB**，故经函数上传的文件最大约 1 MB；
  更大的附件需改为客户端直传 Blob（预签名 URL），此版本未实现

### 3.1 已知平台限制

- **CPU 时间 200ms**：本项目每次请求需多次 KV 读写并渲染完整 HTML。若频繁超时，
  需为热点数据（如站点配置）增加边缘缓存
- **请求体 1 MB**：见上

### 4. 安装与使用

1. 访问站点域名，自动跳转 `/install` 安装向导
2. 填写站点名称、管理员用户名 / 邮箱 / 密码 → 完成安装（账号存入 KV）
3. 访问 `/admin` 登录后台：
   - **仪表盘**：统计与快捷入口
   - **撰写文章 / 创建页面**：Markdown 编辑（标题、代码块、表格、`<!--more-->` 摘要、密码保护、自定义字段）
   - **分类 / 标签**：管理（撰写时可按名自动创建标签）
   - **评论管理**：通过 / 待审 / 删除
   - **附件管理**：上传到 Blob，返回 `/upload/<文件名>` 引用地址
   - **站点设置**：站点信息 + Joe 主题常用配置（Logo、侧栏、导航、备案号……）
   - **安全设置**：修改密码、**TOTP 两步验证**（扫码绑定，登录需动态码）

### 5. 开启 TOTP 两步验证

1. 后台 → 安全设置 → 「开启两步验证」
2. 用验证器 App 扫描二维码（或手输密钥）
3. 输入 6 位动态码确认绑定
4. 之后登录流程：密码 → 动态码 → 后台

## 主题与插件适配说明

| Typecho 概念 | TypechoEdge 实现 |
|---|---|
| MySQL 7 张表 | KV 文档 + 轻量索引（`src/db.js`） |
| 路由表 `routingTable` | 固定默认路由（`src/controllers/frontend.js`），后续可配置化 |
| 主题模板 `.php` | `src/render/theme-*.js` 服务端渲染；Joe 静态资源零改动复用 |
| `Helper::addAction` | `pluginApi.registerAction('xx', handler)` → `/action/xx` |
| 插件钩子 `Typecho_Plugin::factory` | `pluginApi.registerHook('name', fn)` |
| `themeInit` / `fields` | 钩子 `themeInit`；自定义字段（thumb / abstract / keywords / description / mode）后台可编辑 |
| Widget API（`$this->title()` 等） | 渲染函数内部等价实现 |

**支持的钩子**：`themeInit`、`renderContent`（改写正文）、`commentSubmit`（拦截评论）、`commentPost`、`route`（自定义路由）、`response`（改写响应）。

**内置插件示例**：
- `hello-world`：评论 hello 替换 + `/action/hello` 演示
- `links-cache`：友链页（页面正文每行 `名称||URL||头像`，自定义字段 `mode=links`）

**自定义插件**：在 `src/plugins-builtin/` 新建 `my-plugin.js` 导出 `register(api)`，并在 `src/plugins.js` 的 `loadBuiltinPlugins` 中注册，重新构建部署。

## 本地开发

```bash
npm install
npm run build   # 生成 edge-functions/[[default]].js 与 functions/[[path]].js
```

KV / Blob 需在真实 EdgeOne 环境绑定后使用，本地可参照 [EdgeOne CLI](https://pages.edgeone.ai/zh/document/edgeone-cli) 调试。

## 已知差异

- 评论邮件通知（SMTP）暂未实现（Joe 主题的邮件订阅功能依赖 PHPMailer，可结合 EdgeOne + 邮件 API 以插件形式补充）
- Pingback / XML-RPC 未移植
- 主题配置项为 Joe 常用子集（约 30 项），其余可用「页脚自定义内容」或修改 `JOE_DEFAULTS` 实现
- Joe 的百度收录检测默认返回未收录占位（第三方接口）

## 致谢

- [Typecho](https://github.com/typecho/typecho)（GPL 2.0）
- [Joe 主题](https://github.com/HaoOuBa/Joe)（MIT）—— 静态资源与页面结构来自原版主题

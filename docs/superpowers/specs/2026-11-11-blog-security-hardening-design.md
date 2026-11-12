# 博客安全加固设计（A：应用层加固）

- 项目：5iblog 博客（`/workspace/ddeobog-main`）
- 日期：2026-11-11
- 范围：评论防护、安全响应头、可选后台 IP 白名单、安全事件展示
- 状态：已实现（2026-11-12，落地差异见文末「十三、实现说明」）

## 一、背景与现状

当前站点通过 frp TCP 暴露在公网 `39.101.68.241:6080`，已安装且后台登录可用。现有防护与缺口：

| 项目 | 现状 | 缺口 |
|---|---|---|
| 评论提交 | 同源校验、昵称/邮箱/长度校验、审核开关 | 无频率限制、无蜜罐、无去重 |
| 登录 | IP + 用户名限流（5 次 / 10 分钟） | 已有，无需改动 |
| 密码文章 | 按 cid + IP 限流（5 次 / 10 分钟） | 已有，无需改动 |
| XSS | 评论/搜索转义已通过测试 | 无 |
| 响应头 | 静态资源有 `nosniff` | HTML 缺 `X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy`、CSP |
| 暴露面 | frp TCP 直连 | 后台登录对公网开放；无真实客户端 IP |
| 备份 | 后台手动 JSON / WebDAV | 不在本设计范围 |

关键约束：**frp 当前是 TCP 代理**，本地服务看到的来源 IP 都是 `127.0.0.1`，基于纯 IP 的限流会误伤所有访客。因此评论限流使用组合身份键，IP 白名单默认关闭并标注前置条件。

## 二、目标与非目标

### 目标

1. 脚本刷评论在 10 分钟内被限制，正常访客不受影响。
2. 自动提交（填写隐藏蜜罐）不产生评论，且不向攻击者暴露拦截信号。
3. 重复内容在 10 分钟内不重复写库。
4. 所有 HTML 响应带基础安全头，CSP 先以 `Report-Only` 观察。
5. 可选：仅允许白名单 IP 访问 `/admin` 与 `/mcp`，默认关闭。
6. 后台安全页可查看最近拦截事件（只读 + 清空）。

### 非目标

- 验证码、云 WAF、Bot 管理平台。
- 强制 CSP（需要先处理内联脚本 nonce/hash）。
- 修改 frp 协议或强制 HTTPS；HTTPS 仅作为部署选项写入文档。
- 备份、日志轮转、进程守护（属于运维批）。

## 三、威胁模型

| 威胁 | 场景 | 对策 |
|---|---|---|
| 评论刷屏 | 脚本循环提交广告/垃圾内容 | 频率限制 + 内容去重 + 审核队列 |
| 自动化表单提交 | 机器人填写所有字段 | 隐藏蜜罐字段 |
| 点击劫持 | 第三方 iframe 嵌入后台/前台 | `X-Frame-Options: SAMEORIGIN` + CSP `frame-ancestors 'self'` |
| MIME 嗅探 | 上传/静态资源被当作脚本执行 | `X-Content-Type-Options: nosniff`（扩展至 HTML） |
| Referer 泄露 | 外链带走完整路径 | `Referrer-Policy: strict-origin-when-cross-origin` |
| 后台暴露 | 公网直接访问 `/admin`、`/mcp` | 可选 IP 白名单 |
| XFF 伪造 | 攻击者伪造来源 IP 绕过白名单/限流 | 默认不信任 XFF，需显式 `ADMIN_TRUST_PROXY=1` |

## 四、总体设计

新增 `src/security.js` 作为安全能力的单一入口，避免 `frontend.js` / `main.js` 继续膨胀：

```
请求
 ├─ main.js：安全响应头包装 + 可选 IP 白名单（/admin、/mcp）
 ├─ frontend.js：评论提交
 │    ├─ security.js：蜜罐检查
 │    ├─ security.js：内容去重
 │    ├─ security.js：频率限制
 │    └─ security.js：记录拦截事件
 └─ admin.js：安全页展示最近事件
```

`src/security.js` 只依赖 `db.kv` 与标准 Web API，不引入第三方依赖。

## 五、详细设计

### 5.1 评论防护

#### 5.1.1 表单变更

文章评论表单（`src/render/theme-5iblog.js` 的 `blog_comment__respond-form`）与留言墙表单（`blog_wall__form`）各增加一个蜜罐字段：

```html
<div class="hp" aria-hidden="true">
  <label for="hp-website">网站</label>
  <input id="hp-website" type="text" name="website" tabindex="-1" autocomplete="off">
</div>
```

样式：绝对定位到视口外（`position:absolute; left:-9999px; width:1px; height:1px; overflow:hidden`），不参与布局；`aria-hidden="true"` 与 `tabindex="-1"` 避免屏幕阅读器与键盘用户聚焦。正常用户不会看到或填写。

#### 5.1.2 提交顺序

在 `frontend.js` 的 `handleCommentPost` 中，保持现有同源校验与字段校验，插入顺序如下：

1. 同源校验（已有）
2. 解析表单与字段（已有）
3. **蜜罐检查**：`website` 非空 → 记录事件 → 返回 200 静默成功页（不写库）
4. 字段校验（已有）
5. 插件 `commentSubmit` 钩子（已有）
6. **内容去重**：同一 `cid + 邮箱 + 正文` 在窗口内重复 → 记录事件 → 返回 200 静默成功页
7. **频率限制**：组合身份键超出阈值 → 记录事件 → 返回 429 + 提示
8. 写入评论（已有）
9. **计数**：成功提交后累加窗口计数
10. 特权用户（管理员或文章作者）跳过第 6、7 步，但仍检查蜜罐

#### 5.1.3 身份键与阈值

- 身份键：`hash(cid + IP + 邮箱 + User-Agent)`，使用 SHA-256 前 16 位十六进制，避免把原始 IP/邮箱写进 KV 键。
- IP 来源：`X-Forwarded-For` 第一项（仅当可信代理时）→ `CF-Connecting-IP` → `X-Real-IP` → 空。当前 frp TCP 下通常为空或 `127.0.0.1`，邮箱与 UA 仍能区分。
- 默认阈值：`COMMENT_RATE_LIMIT=5` 条 / `COMMENT_RATE_WINDOW=600` 秒。
- 去重窗口：`COMMENT_DUP_WINDOW=600` 秒。
- 计数键：`cmt_rate:<hash>` → `{ count, at }`；去重键 `cmt_dup:<hash>` → 时间戳。
- 计数在窗口外自动重置；键不设 TTL，读取时判断过期并覆盖，避免依赖平台 TTL 能力。

#### 5.1.4 响应策略

| 场景 | 状态码 | 响应体 | 是否写库 |
|---|---|---|---|
| 正常评论 | 200 | 现有成功协议（含 Blog 标记） | 是 |
| 待审核 | 200 | 现有提示协议（不含 Blog 标记） | 是 |
| 蜜罐命中 | 200 | 静默成功提示（不含 Blog 标记） | 否 |
| 重复内容 | 200 | 静默成功提示（不含 Blog 标记） | 否 |
| 频率超限 | 429 | 提示协议（不含 Blog 标记）+ `Retry-After` | 否 |

静默成功页与待审提示一致，避免攻击者通过状态码/文案判断是否被拦截。默认返回 429 + `Retry-After`（值为窗口剩余秒数，最少 60）；实现阶段用浏览器验证前端评论脚本：若它把非 2xx 当网络错误，则退回 200 + 提示，以浏览器实测为准，并在测试中固定最终行为。

#### 5.1.5 事件记录

- 键：`sec:events`，值为数组，最多 100 条，新的在前。
- 字段：`{ type: 'honeypot'|'rate'|'duplicate', at, cid, ipHash, uaHash, mailHash }`，不存原始 IP/邮箱/UA。
- 写入失败不影响评论主流程（try/catch 吞掉）。
- 后台安全页新增「评论防护」卡片：显示当前阈值、最近 10 条事件、清空按钮（管理员可见）。
- 清空操作：`POST /admin/security`，`op=clear-security-events`，删除 `sec:events`。

### 5.2 安全响应头

新增 `applySecurityHeaders(response, { html })`：

| 头 | 值 | 范围 |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | 所有响应 |
| `X-Frame-Options` | `SAMEORIGIN` | 所有 HTML 响应 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 所有响应 |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | 所有 HTML 响应 |
| `Content-Security-Policy-Report-Only` | 见下 | 所有 HTML 响应 |

CSP 策略：

```
default-src 'self';
img-src 'self' data: https:;
style-src 'self' 'unsafe-inline';
script-src 'self' 'unsafe-inline';
font-src 'self' data:;
connect-src 'self';
frame-ancestors 'self';
base-uri 'self';
form-action 'self'
```

说明：

- 先 `Report-Only`，只上报不阻断；后台大量内联脚本与样式，直接强制会导致页面不可用。
- `img-src https:` 允许外链头像（weavatar 等）；`data:` 允许内联图片。
- 不设置 `report-uri`，浏览器控制台即可观察；不新增上报端点（YAGNI）。

注入位置：

- `src/main.js`：将现有 `onRequest` 的路由逻辑抽为内部 `handleRequest(context)`，`onRequest` 统一 `return applySecurityHeaders(await handleRequest(context))`，错误分支同样加头。
- `server.mjs`：静态资源响应补 `nosniff`、`X-Frame-Options`、`Referrer-Policy`。
- `edgeone.json`：在 `headers` 增加 `/*` 全局规则，与函数返回头保持一致；平台合并时以更严格者为准。

### 5.3 可选后台 IP 白名单

- 环境变量：`ADMIN_ALLOW_IPS`（逗号分隔），支持 `1.2.3.4`、`1.2.3.*`、`*`；默认空 = 不限制。
- 作用路径：`/admin` 与其子路径、`/mcp`；其他路径不受影响。
- IP 解析：
  - 本地 `server.mjs` 在转发时把 `socket.remoteAddress` 写入 `X-Real-IP`（可信来源）。
  - `ADMIN_TRUST_PROXY=1` 时：`X-Forwarded-For` 第一项 → `CF-Connecting-IP` → `X-Real-IP`；EdgeOne 线上必须开启此项以读取平台头。
  - 默认：只使用 `X-Real-IP`；不信任可伪造的 XFF。
- 拒绝响应：403 纯文本页面，不暴露后台细节。
- 前置条件与回滚：
  - frp TCP 模式下真实 IP 为 `127.0.0.1`，开启白名单前必须改用反代或 PROXY protocol，否则会锁死后台。
  - 回滚：移除 `ADMIN_ALLOW_IPS` 并重启即可。
- 本设计不实现 PROXY protocol 解析；在文档中给出部署选项（Caddy/Nginx 反代、frp https 代理、Cloudflare Tunnel）。

### 5.4 配置读取

新增 `readSecurityConfig(env)`：

- 优先 `context.env`（EdgeOne 绑定），回退 `globalThis.process?.env`（本地）。
- 数值做范围校验：限流 1–100、窗口 60–86400 秒；非法值回落默认。
- 配置只读，不在每次请求重新解析（模块级缓存，环境变量变更需重启）。

## 六、数据与接口变更

| 变更 | 位置 |
|---|---|
| 新增 `src/security.js` | 蜜罐、去重、限流、事件、头、白名单 |
| `handleCommentPost` 接入防护 | `src/controllers/frontend.js` |
| 两个评论表单加蜜罐字段 | `src/render/theme-5iblog.js` |
| 统一安全头 + 白名单 | `src/main.js` |
| 静态资源头 | `server.mjs` |
| 全局头 | `edgeone.json` |
| 安全页事件卡片与清空 action | `src/controllers/admin.js` |
| 新增 KV 键 | `cmt_rate:*`、`cmt_dup:*`、`sec:events` |
| 新增环境变量 | `COMMENT_RATE_LIMIT`、`COMMENT_RATE_WINDOW`、`COMMENT_DUP_WINDOW`、`ADMIN_ALLOW_IPS`、`ADMIN_TRUST_PROXY` |

不改数据库 schema，不新增依赖，不影响 EdgeOne KV/Blob 部署路径。

## 七、错误处理与边界

| 场景 | 处理 |
|---|---|
| 事件写入失败 | 吞掉异常，评论正常提交 |
| KV 读取失败 | 放行评论（fail-open），记录日志；避免因防护组件故障阻断正常访客 |
| 限流键损坏 | 视为无记录，重置计数 |
| 蜜罐误伤（密码管理器自动填充） | 字段名 `website` + `autocomplete="off"`；上线后观察事件，若误伤明显可移除蜜罐 |
| frp 下 IP 全为 127.0.0.1 | 组合键仍有效；白名单默认关闭 |
| 管理员测试评论被限流 | 特权用户豁免 |
| 429 前端处理不兼容 | 实现阶段浏览器验证；必要时改 200 + 提示 |
| CSP 报告噪音 | 先 Report-Only，观察后再决定是否强制 |
| 白名单锁死 | 默认关闭；回滚步骤写入文档 |

## 八、测试策略

### 单元 / HTTP

- 蜜罐非空：不新增评论，返回 200 静默页。
- 第 6 条评论：429（或静默，按实现阶段结论），第 5 条内成功。
- 同内容 10 分钟内重复：不新增评论。
- 管理员/作者：超过阈值仍可评论。
- 安全头：HTML 响应包含 4 个基础头 + `CSP-Report-Only`；JSON/XML 不含 CSP。
- 白名单：默认关闭；`ADMIN_ALLOW_IPS` 配置后非白名单 403、白名单 200；`ADMIN_TRUST_PROXY=0` 时伪造 XFF 无效。

### 浏览器

- 正常评论提交成功；蜜罐视觉隐藏且不可 Tab 聚焦。
- 限流提示可读；后台安全页事件列表显示与清空。

### 回归

- `test.mjs` 90 项、`test-security.mjs` 11 项、`test-bundle.mjs` 8 项、`test-sqlite.mjs` 9 项。
- 网站测试关键路径：首页、文章、评论、后台登录/评论审核。
- 性能：单条评论新增 2–3 次 KV 读写，目标单请求增加 < 5 ms。

## 九、验收标准

- [ ] 10 分钟内第 6 条评论返回 429（或经浏览器验证后的等价提示），前 5 条正常。
- [ ] 蜜罐填写的提交不产生评论，且响应与成功一致。
- [ ] 重复内容不重复写库。
- [ ] 所有 HTML 响应带 4 个基础安全头 + CSP Report-Only。
- [ ] 后台安全页可查看最近 10 条拦截事件并清空。
- [ ] 默认配置下无行为变化；白名单开启后按预期生效。
- [ ] 现有 90/11/8/9 项测试全部通过。
- [ ] 正式站与公网冒烟通过。

## 十、实施顺序

1. `src/security.js`：纯函数与单元测试（哈希、窗口判断、IP 解析、头构造）。
2. `theme-5iblog.js`：两个评论表单加蜜罐字段。
3. `frontend.js`：接入蜜罐、去重、限流、事件。
4. `main.js`：抽出 `handleRequest`，统一安全头；接入白名单。
5. `server.mjs` / `edgeone.json`：静态与全局头同步，并在 `server.mjs` 注入 `X-Real-IP`。
6. `admin.js`：安全页事件卡片 + 清空 action。
7. 测试与回归、构建、重启、公网验证。
8. 文档：部署选项（HTTPS/反代）与配置说明。

## 十一、风险与回滚

| 风险 | 影响 | 回滚 |
|---|---|---|
| 限流阈值过严 | 正常访客被拒 | 调大 `COMMENT_RATE_LIMIT` 或窗口，重启 |
| 蜜罐误伤 | 少量真实评论被静默丢弃 | 移除蜜罐字段或检查逻辑 |
| 白名单配置错误 | 后台无法访问 | 移除 `ADMIN_ALLOW_IPS` 重启 |
| CSP 影响页面 | Report-Only 不阻断，仅控制台报告 | 删除 CSP 头 |
| 事件写入放大 KV | 每条拦截一次读写 | 事件上限 100，写入失败吞掉 |

## 十二、后续（不在本次）

- 强制 CSP：为内联脚本生成 nonce/hash。
- HTTPS：frp https 代理、Caddy/Nginx 反代、Cloudflare Tunnel 三种部署方式。
- 评论验证码/第三方反垃圾（仅在刷屏仍严重时评估）。
- 自动备份、日志轮转、进程守护（运维批）。
- 搜索尾延迟与 options 缓存（性能批）。

## 十三、实现说明（2026-11-12）

### 13.1 落地文件

| 文件 | 内容 |
|---|---|
| `src/security.js`（新增） | 配置读取、短哈希、IP 解析、蜜罐、去重、限流、事件、安全头、白名单 |
| `src/controllers/frontend.js` | `handleCommentPost` 接入蜜罐 → 字段校验 → 插件钩子 → 去重 → 限流 → 写库 → 计数；管理员/作者豁免去重与限流 |
| `src/main.js` | `done()` 与 500 分支统一补安全头；`/admin`、`/mcp` 白名单校验 |
| `src/controllers/admin.js` | 安全页「评论防护」卡片（阈值、最近 10 条事件）+ `clear-security-events` 操作 |
| `src/render/theme-5iblog.js` | 文章评论表单与留言墙表单新增蜜罐字段 |
| `usr/themes/5iblog/assets/js/5iblog.global.js` | 评论 ajax 显式提交 `hp_site`（该脚本手动构造 data，不序列化表单） |
| `usr/themes/5iblog/assets/css/5iblog.refine.css` | `.hp` 视觉隐藏样式 |
| `server.mjs` | 注入可信 `X-Real-IP`；静态资源补安全头 |
| `edgeone.json` | `/*` 全局安全头（含 CSP Report-Only） |
| `test-security-hardening.mjs`（新增） | 8 项回归：头、蜜罐、去重、限流、管理员豁免、白名单、事件展示/清空 |

### 13.2 与设计的差异

1. **蜜罐字段名改为 `hp_site`**：`website` 被浏览器/密码管理器自动填充的概率偏高。同时因为 `5iblog.global.js` 的评论提交是手动构造 `{author, mail, text, parent, url, _}`，仅在表单里加 input 不会发送，必须同步改脚本并重新生成 `.min.js`。留言墙使用 `new FormData(form)`，加字段即可。
2. **限流命中返回 200 + 静默提示，而非 429**：jQuery 对非 2xx 走 `error()`，只会提示「发送失败！请刷新重试！」，无法展示 `Retry-After`。按设计 5.1.4 的兜底方案统一返回与待审一致的静默文案，同时避免向脚本暴露拦截信号。
3. **安全头在 `done()` 注入，未抽 `handleRequest`**：现有所有分支已经过 `done()`，异常分支单独补头即可；`Response.redirect` / fetch 返回的 Response 头为 immutable，`applySecurityHeaders` 会捕获后复制头新建 Response。
4. **配置不做模块级缓存**：EdgeOne 的 `context.env` 按请求注入，缓存首个请求会吞掉后续绑定；配置解析只有几次字符串比较，成本可忽略。
5. **白名单同时覆盖 `/mcp` 与 `/mcp/`**，`server.mjs` 用真实 socket 地址覆盖客户端自带的 `X-Real-IP`，防止本地伪造。

### 13.3 验证结果

| 测试 | 结果 |
|---|---|
| `node test-security-hardening.mjs` | 8 / 8 |
| `node test-security.mjs` | 11 / 11 |
| `node test.mjs` | 90 / 90 |
| `node test-bundle.mjs` | 8 / 8 |
| `npm run test:sqlite` | 9 / 9 |
| `node tools/edge-runtime-check.mjs` | 通过 |
| `node tools/edge-install-check.mjs` | 通过 |
| 本地 `server.mjs` 冒烟 | HTML 5 个头、静态资源 4 个头、302 基础头、白名单 403/302 均符合 |

构建产物 371.1 KB，未混入 `node:sqlite`；`hp_site`、CSP 头均已进入 `edge-functions/*.js`。
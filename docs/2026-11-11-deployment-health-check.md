# 部署健康检查报告

- 日期：2026-11-11
- 检查范围：本地 SQLite 部署、EdgeOne 构建与边缘运行时模拟
- 结论：**本地部署与 EdgeOne 构建/运行时检查正常**；实际 EdgeOne 部署未执行（环境无 CLI 与 API Token）

## 一、本地部署（Node + SQLite）

| 检查项 | 结果 |
|---|---|
| 服务进程 | 运行中（5173，RSS 约 67 MB） |
| SQLite 数据 | 用户 1、文章 3、评论 1、附件 1；`idx:posts` 与文章数一致 |
| 首页 / 文章 / 归档 / 搜索 | 200 |
| 404 | 404（状态正确） |
| RSS / sitemap / robots | 200 |
| 后台登录页 | 200 |
| `/install`（已安装） | 403（安装向导已关闭） |
| 重启后数据 | 用户/文章/评论/附件数量不变；首页、文章、搜索、后台正常 |
| 公网 frp | `http://39.101.68.241:6080/` → 200 |
| 后台页面（隔离实例） | 仪表盘、文章、编辑器、评论、附件、设置、备份、回收站、安全 均 200 |
| 索引缓存一致性 | 创建、更新、删除文章后列表立即反映（3/3） |

评论审核检查项在隔离库未执行成功，原因是该库当时没有待审核评论（无「通过」按钮），不是功能失败；此前在性能实例上该项已通过。

## 二、EdgeOne 构建与运行时

按 `edgeone-makers-developer` skill 的结构与限制核对：

| 检查项 | 结果 |
|---|---|
| `npm run build` | 成功，产物 356.9 KB（平台限制 5 MB） |
| `edge-functions/index.js` | 存在，对应 `/` |
| `edge-functions/[[default]].js` | 存在，catch-all |
| `public/` 静态目录 | 已生成（主题资源） |
| `edgeone.json` | JSON 合法；`buildCommand` / `outputDirectory` / `nodeVersion`（22.11.0）符合平台支持列表 |
| 本地专用模块混入 | 产物中 `node:sqlite`、`SqliteBinding`、`server.mjs` 均为 0 次 |
| 关键修复进入产物 | 索引缓存、密码限流、后台可访问性标记均在 |
| Edge 运行时全链路 | `node tools/edge-runtime-check.mjs` 通过（onRequest 返回 200） |
| Edge 安装流程 | `node tools/edge-install-check.mjs` 通过（安装、默认页面、删除后自愈重建） |
| 构建产物测试 | `node test-bundle.mjs` 8 / 8 |
| 请求体限制 | 上传上限 950 KB < 平台 1 MB，符合 |
| 存储绑定 | KV `BLOG_KV`；Blob `@edgeone/pages-blob`（`typecho-uploads`），与 skill 的绑定方式一致 |
| 函数请求日志 | 已实现（`src/logging.js` + `main.js`），默认 `info`；重新部署后可在控制台函数日志/实时日志查看 |

### 本次修复的检查工具

`tools/edge-install-check.mjs` 原先直接改写模拟 KV 的 `idx:posts` 来删除页面，绕过了数据层的索引缓存失效，导致「删除后重建」检查报 2 条索引（实际是测试手法问题）。

已改为：登录后台后通过真实 `POST /admin/delete` 删除页面，走 `Database.deleteContent` 的索引失效路径。修改后检查通过。

## 三、回归测试

| 测试 | 结果 |
|---|---|
| `node test.mjs` | 90 / 90 |
| `node test-security.mjs` | 11 / 11 |
| `npm run test:sqlite` | 9 / 9 |
| `node test-bundle.mjs` | 8 / 8 |
| `node tools/edge-runtime-check.mjs` | 通过 |
| `node tools/edge-install-check.mjs` | 通过 |

## 四、未执行 / 已知限制

1. **未实际部署到 EdgeOne**：环境未安装 `edgeone` CLI，也没有 `EDGEONE_API_TOKEN` 与项目名。`scripts/deploy.sh` 需要这两个参数，无法在当前环境执行。
2. **日志需部署后查看**：函数请求日志已加入代码并通过 Edge 沙箱验证，但控制台要看到记录必须先重新部署；访问日志/CDN 日志仍需在 EdgeOne 控制台开通日志服务。
2. **Docker 未实测**：环境没有 Docker，`Dockerfile` / `docker-compose.yml` 只做了静态检查。
3. **frp 仍是明文 HTTP**：后台登录对公网开放，依赖应用层会话与限流；HTTPS 属于安全批的部署选项，尚未实施。
4. **Playwright 未安装为运行依赖**：`npm run test` 中的 e2e 步骤在当前环境不可直接执行；本次用已安装的 Chromium 做隔离实例验证。
5. **安全设计尚未实现**：评论限流/蜜罐、安全响应头、IP 白名单仍在设计阶段（见 `docs/superpowers/specs/2026-11-11-blog-security-hardening-design.md`）。

## 五、部署前建议

- 在 EdgeOne 控制台确认 `BLOG_KV` 命名空间与 `typecho-uploads` Blob 存储已绑定到项目。
- 使用 `EDGEONE_API_TOKEN` + 项目名执行一次 preview 部署，验证 KV/Blob 实际读写；本地 SQLite 路径不依赖这两个绑定。
- 部署后检查 `/admin/login`、`/install`（应 403）、评论提交、上传附件、MCP（如启用）。
- 若要继续安全批实现，先完成设计文档审阅，再进入实现计划。
# Changelog

## v1.2.1 (2026-11-08)

### 修复
- 修复 `/about/`、`/guestbook/` 在页面缺失时报 500 的问题：`IS_NODE` / `ensureDefaultPage` 此前只有引用没有定义。

### 变更
- 全新安装后自动创建「关于本站」「留言板」独立页面（仅边缘运行时创建；本地 Node 预览与测试不创建，保持原有 ID 序列）。
- 页面被后台删除后，再次访问 `/about/`、`/guestbook/` 会自动重建。
- 留言板便签墙 `JGuestbook_Wall` 默认开启。
- 导航「留言板」始终显示，不再依赖留言板页面是否已存在。

### 测试
- 新增 `tools/edge-install-check.mjs` 并纳入 `npm test`：覆盖安装后默认页面、导航链接、删除页面后自动重建。

## v1.2.0 (2026-11-08)

### MCP
- 支持创建多个 MCP 令牌，每个可设置名称、备注、启用/停用，并可单独重置令牌或删除。
- 兼容旧版单令牌配置：升级后自动显示为「默认 MCP · 旧版迁移」，原令牌继续可用。
- 任一启用令牌均可调用 `/mcp`；全部停用/删除后端点恢复 404。
- 令牌要求长度 ≥ 24 且至少 8 种不同字符；移除通配 CORS。

### 其他
- 修复评论审核状态、SVG/HTML 上传、API 输出转义等安全问题。
- EdgeOne 静态输出收窄到 `public/`；资源版本 `?v=1.2.0`。

## v1.1.0 (2026-11-08)

### 新增
- 便签留言墙 `/guestbook/`：彩色便签卡片、桌面拖拽、本地位置记忆、后台开关。
- MCP 服务 `/mcp`：文章、页面、分类、标签、评论、附件、站点信息工具，Bearer Token 鉴权。
- 首页轮播与多条广告：后台可开关，支持多行 `图片 || 链接 || 标题` 配置。
- 文章页右上角管理员「编辑」按钮（仅登录可见）。
- 归档页：按年/月时间线、分类/标签筛选、统计卡片、分类扇形图、右侧栏。
- 文章相关推荐固定数据并支持 PC 3 条 / 手机 2×2。

### 优化
- 后台 UI 统一 Joe 蓝视觉，按钮/表单/侧栏/表格样式统一。
- 后台侧栏无刷新切换、骨架屏、页面入场与数字滚动动效。
- 手机端后台：输入框 16px 防 iOS 缩放、表格卡片化、仪表盘按钮与分类页适配。
- 性能：JS `defer`、非关键 CSS 异步、按页面加载 fancybox/sketchpad/APlayer、Swiper 条件加载。
- 静态资源版本化与长缓存；构建输出收窄到 `public/`，避免源码进入静态发布目录。
- 头像改用邮箱 MD5 查询 WeAvatar / Cravatar / Gravatar。

### 安全
- 评论审核状态按站点设置写入 `waiting/approved`。
- 拒绝 SVG/HTML 附件上传，附件响应增加 `nosniff` 与 `Content-Disposition`。
- `/joe/api` 输出字段转义，修复首页重绘 DOM XSS。
- 后台页面 `Cache-Control: no-store`；500 错误页转义。
- CSRF 增加 `Sec-Fetch-Site` 与 Referer 兜底；MCP 移除通配 CORS，令牌最小长度/复杂度校验。
- 上传大小与 EdgeOne 1MB 请求体上限对齐。

### 部署
- `edgeone.json`：`outputDirectory` 改为 `./public`，`nodeVersion: 22.11.0`。
- 静态资源 `Cache-Control: immutable` + `?v=1.1.0`。
- 移除未使用的 live/wallpaper/video 组件文件。
- 完整测试：76 / 11 / 8 / 16 项 + 边缘运行时检查通过。

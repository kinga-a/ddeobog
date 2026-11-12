# EdgeOne 日志接入说明

- 日期：2026-11-11
- 目标：让 EdgeOne 函数日志能看到正常请求，而不是只有异常时才有输出

## 一、之前为什么是空白

项目此前只有 `src/main.js` 的异常分支输出 `console.error`，正常请求没有任何 `console` 输出。EdgeOne 的函数日志只收集函数执行期间的 console，因此绝大多数访问在控制台里看不到记录。

另外，EdgeOne 控制台里可能同时存在三类日志，容易混淆：

| 日志类型 | 来源 | 是否需要代码 |
|---|---|---|
| 构建日志 | 部署/构建过程 | 不需要 |
| 函数日志 / 实时日志 | Edge Function 的 `console.log` / `console.error` | **需要代码输出** |
| 访问日志 / CDN 日志 | 边缘加速域名的请求日志 | 需要在控制台开通日志服务并投递 CLS |

本次解决的是第二类：函数日志。

## 二、已实现的请求日志

新增 `src/logging.js`，在 `src/main.js` 的 `onRequest` 外层统一记录：

```json
{
  "ts": "2026-11-11T15:06:38.586Z",
  "level": "info",
  "requestId": "4ee3a4ac",
  "method": "GET",
  "path": "/archives/1/",
  "status": 200,
  "ms": 10,
  "ip": "1a2b3c4d",
  "ua": "Mozilla/5.0 ..."
}
```

异常时输出：

```json
{
  "ts": "...",
  "level": "error",
  "requestId": "a1b2c3d4",
  "method": "GET",
  "path": "/",
  "status": 500,
  "ms": 3,
  "message": "未找到 KV 绑定 \"BLOG_KV\"...",
  "stack": "...",
  "ip": "1a2b3c4d",
  "ua": "..."
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| `requestId` | 8 位请求 ID，用于串联同一次请求的日志 |
| `path` | 只记 pathname；`/search/<关键词>` 脱敏为 `/search/[kw]/` |
| `ms` | 请求耗时（毫秒） |
| `ip` | 客户端 IP 的短哈希，不存原始 IP |
| `ua` | User-Agent，截断到 80 字符 |
| `status` | HTTP 状态码；异常固定 500 |

隐私：不记录 query、Cookie、Authorization、请求体；不记录评论/登录正文。

## 三、日志级别

环境变量 `LOG_LEVEL`：

| 值 | 行为 |
|---|---|
| `info`（默认） | 每个请求一行 info；异常额外 error |
| `error` | 只输出异常 |
| `off` | 关闭 |

- EdgeOne：在控制台项目环境变量里设置 `LOG_LEVEL`；不设置时默认 `info`。
- 本地：`server.mjs` 默认把 `LOG_LEVEL` 设为 `off`，终端保留原有摘要日志（`GET / → 200 22ms`），避免重复；需要结构化日志时：

```bash
LOG_LEVEL=info npm start
```

## 四、在 EdgeOne 查看

### 4.1 控制台「日志分析」为什么看不到

EdgeOne Makers 的「日志分析」目前只收集以下来源（官方文档：<https://pages.edgeone.ai/zh/document/log-analysis>）：

| 来源 | 代码位置 |
|---|---|
| SSR | 框架自动生成 |
| Cloud Functions | `cloud-functions/` |
| Agents | `agents/` 或自定义目录 |
| **Edge Functions** | **平台规划中，尚未纳入** |

本项目是 Edge Functions（`edge-functions/`），所以 `src/logging.js` 的 `console.log` JSON **不会出现在「日志分析」页**。这是平台当前的能力限制，不是代码没写或 `LOG_LEVEL` 配置问题。

### 4.2 当前可用的查看方式

1. 重新部署（代码改动必须部署后才会生效）。
2. 控制台 → 对应 Makers / Pages 项目 → 部署详情 → **函数日志 / 实时日志**。
3. 选择环境（生产 / 预览）与时间范围，按 `requestId`、`status`、`path` 检索。
4. 如果是"访问日志"页面为空：那是 CDN 访问日志，需要在 EdgeOne 控制台开通日志服务并配置投递到 CLS；代码无法开启。
5. 平台提供「指标分析」查看请求量、错误率、响应时间等聚合指标，不依赖函数日志。

### 4.3 已实现的 Cloud Functions 中转（推荐）

本仓库已内置 `cloud-functions/log-ingest.js`（路由 `/log-ingest`）：

```
Edge Function (console.log JSON)
   └─ LOG_SINK_URL 异步 POST（waitUntil，不阻塞响应）
        └─ Cloud Function /log-ingest：校验 Token → console.log(JSON)
             └─ 控制台「日志分析 → 来源：Cloud Functions」可检索
```

#### 配置步骤

1. 部署时平台自动识别 `cloud-functions/` 目录，无需改 `edgeone.json`。
2. 在项目环境变量中增加：

| 变量 | 配置位置 | 值 |
|---|---|---|
| `LOG_SINK_TOKEN` | **Edge Functions 与 Cloud Functions 都要配** | 随机长字符串，两边一致 |
| `LOG_SINK_URL` | Edge Functions | `https://<项目访问域名>/log-ingest` |

3. 重新部署（Edge 与 Cloud 函数都要发新生效）。
4. 控制台 → 日志分析 → **日志来源选 Cloud Functions**，按 `sink:"edge"`、`requestId`、`status`、`path` 检索。

行为说明：

- `LOG_SINK_URL` 或 `LOG_SINK_TOKEN` 任一为空时**完全不转发**，与旧版本一致。
- 转发失败静默，不影响请求；`LOG_LEVEL=error` 时只转发异常日志。
- Cloud Function 只接受 POST + Bearer Token，单条上限 16KB，字段白名单 + 长度截断；未配置 Token 时返回 503。
- 如果 `/log-ingest` 被 Edge Functions 的 catch-all 路由抢先处理，把 `LOG_SINK_URL` 换成 Cloud Function 的独立访问地址（控制台函数详情可查）。

#### 其他方案

| 方案 | 做法 | 代价 |
|---|---|---|
| 外部日志服务 | 把 `LOG_SINK_URL` 指向自建 API / Loki / CLS，复用现有异步转发 | 需额外日志服务与鉴权 |
| 访问日志投递 CLS | 控制台开通 EdgeOne 日志服务，投递 CDN 访问日志到 CLS | 只能看 CDN 层数据，不含 `requestId`/`ms` 等应用字段 |
| 等待平台支持 | Edge Functions 来源上线后，现有 JSON 日志可直接按 `requestId` 检索 | 时间不确定 |

## 五、验证

```bash
# Edge 沙箱内验证日志字段、脱敏、级别与错误日志
node tools/log-check.mjs

# 边缘运行时全链路
node tools/edge-runtime-check.mjs

# 日志转发（Edge → Cloud Function 中转）
node test-log-sink.mjs

# 构建产物与回归
node test-bundle.mjs
node test.mjs
```

`tools/log-check.mjs` 会检查：

- info 日志数量与字段完整性
- `/search/<关键词>` 是否脱敏
- 200 / 302 / 404 状态是否记录
- `LOG_LEVEL=error` / `off` 是否按预期静默
- 缺少 KV 绑定时是否输出 error 日志且 status=500

## 六、仍然空白时的排查顺序

1. 确认已重新部署，且访问的是部署后的环境。
2. 确认请求是动态路由（`/`、`/archives/...`、`/admin/...`）；`/usr/` 静态资源由平台直接返回，不经过函数。
3. 确认 `LOG_LEVEL` 不是 `off`。
4. 确认查看的是「函数日志」而不是「访问日志」。
5. 确认时间范围与日志保留期；高频日志可能被平台采样/截断。
6. 若需要长期检索与告警，使用 EdgeOne 日志服务投递 CLS，或后续增加 KV 日志/后台日志页。

## 七、限制与后续

- **日志分析来源限制**：Makers「日志分析」当前不收集 Edge Functions，代码侧无法开启；只能等平台支持，或走 4.3 的外部投递 / Cloud Functions 中转。
- 每请求一行日志，高流量时会产生可观的日志量；可用 `LOG_LEVEL=error` 降量。
- 平台日志保留时间由 EdgeOne 控制，不作为长期审计存储。
- 当前不写 KV，避免增加请求延迟；如果需要在后台看日志，可后续增加"慢请求/错误写 KV + 后台日志页"（默认仅记录 >1s 或 5xx，采样写入）。
- Webhook 部署事件通知属于另一类日志/通知，不在本次范围。
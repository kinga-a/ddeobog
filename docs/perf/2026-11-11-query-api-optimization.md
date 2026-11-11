# 查询接口性能优化报告

- 优化日期：2026-11-11
- 目标：降低前台搜索、后台列表、MCP 查询接口的响应时间与尾延迟
- 环境：Node.js 22.11 + `node:sqlite`（WAL）、单进程、本机 loopback
- 数据规模：519 篇文章、1503 条评论、30 个分类/标签；`idx:posts` 约 208 KB
- 压测工具：`docs/perf/benchmark.mjs`（Node 原生 http，keep-alive，统计 P50/P95/P99/RPS）
- 原始数据：`baseline.json`、`optimized.json`

## 一、被测接口

| 接口 | 说明 | 认证 |
|---|---|---|
| `GET /search/querybenchmark/` | 前台搜索，命中 500 篇，HTML 渲染 + 60s 快照 | 匿名 |
| `GET /admin/posts` | 后台文章列表，读取索引 + 分页 | 会话 Cookie |
| `GET /admin/comments` | 后台评论列表，读取评论索引并排序 | 会话 Cookie |
| `POST /mcp` → `list_posts` | MCP 查询工具，JSON 输出 + 分类/标签批量解析 | Bearer Token |

并发档位：1 / 10 / 30；每档 40–180 个请求，先做 5 次预热。

## 二、基线结果

### 并发 1（单请求固定开销）

| 接口 | P50 | P95 | P99 | RPS |
|---|---|---|---|---|
| 搜索 | 3.63 ms | 5.04 ms | 6.31 ms | 255 |
| 后台文章 | 3.58 ms | 3.97 ms | 4.43 ms | 276 |
| 后台评论 | 4.64 ms | 5.37 ms | 9.69 ms | 205 |
| MCP list_posts | 4.00 ms | 4.44 ms | 6.52 ms | 244 |

### 并发 30（尾延迟问题集中暴露）

| 接口 | P50 | P95 | P99 | RPS |
|---|---|---|---|---|
| 搜索 | 51.89 ms | **566.04 ms** | 590.24 ms | 301.8 |
| 后台文章 | 88.05 ms | 93.01 ms | 180.61 ms | 323.7 |
| 后台评论 | 119.19 ms | 122.33 ms | 238.64 ms | 243.1 |
| MCP list_posts | 113.10 ms | 121.58 ms | 123.02 ms | 263.4 |

全部请求错误率为 0。

## 三、瓶颈分析

1. **每个请求重复读取并解析全量索引**
   `listContentsIndex` / `listAllComments` / MCP 查询都会读取 `idx:posts`（约 208 KB）或 `idx:cmts`（1503 条）并 `JSON.parse`。单次 1–2 ms 看似不高，但在并发 30 时叠加成队列。

2. **SQLite 同步 API 阻塞事件循环**
   `node:sqlite` 的 `DatabaseSync` 是同步调用；每个请求的多次 `get`/`getBatch` 会阻塞其他请求。单并发 3–5 ms，并发 30 时 P95 放大到 93–566 ms，说明瓶颈是**排队**而不是单次查询本身。

3. **评论列表排序成本**
   `listAllComments` 每次对 1503 条索引排序再分页；并发下 CPU 与 I/O 都被重复消耗。

4. **搜索页额外成本**
   搜索页命中 60s HTML 快照时仍需读取并解析 32 KB 快照 JSON；冷启动并发会同时触发多份渲染，尾延迟被放大。

## 四、优化方案

### 4.1 索引进程内缓存 + 写点主动失效

在 `src/db.js` 增加模块级缓存：

```js
const INDEX_CACHE = new Map();
const INDEX_CACHE_TTL = 5000;

async #loadCachedIndex(key) {
  const now = Date.now();
  const hit = INDEX_CACHE.get(key);
  if (hit && now - hit.at < INDEX_CACHE_TTL) return [...hit.data];
  const data = (await this.kv.getJSON(key)) || [];
  INDEX_CACHE.set(key, { data, at: now });
  return [...data];
}

async #putIndex(key, value) {
  await this.kv.putJSON(key, value);
  INDEX_CACHE.delete(key);
}
```

- `#loadPostIndex` / `#loadMetaIndex` / `#loadCmtIndex` 统一走缓存。
- 所有索引写点（`#replaceIndexEntry`、`#dropIndexEntry`、`#savePostIndex`、评论/分类索引写入）统一改为 `#putIndex`，写入后立即失效。
- 返回浅拷贝，调用方 `filter/sort` 不会污染缓存。
- 5 秒 TTL 作为多实例/外部写入的兜底；同进程写后读**立即一致**。

### 4.2 有意不缓存 options

尝试过缓存 `getOptions`，但测试/备份恢复等路径可能直接写 `opt:*` 绕过 `setOption`，导致 3 秒内读到旧配置。为保证正确性，本次只缓存索引；options 读取本身是 `listKeys + getBatch` 两次批量调用，成本可控。

### 4.3 改动文件

| 文件 | 内容 |
|---|---|
| `src/db.js` | `INDEX_CACHE`、`#loadCachedIndex`、`#putIndex`；三个索引读取走缓存；7 处索引写入统一失效 |

## 五、优化后结果

### 并发 1

| 接口 | P50（前 → 后） | P95（前 → 后） |
|---|---|---|
| 搜索 | 3.63 → **1.61 ms** | 5.04 → **2.89 ms** |
| 后台文章 | 3.58 → **1.26 ms** | 3.97 → **1.84 ms** |
| 后台评论 | 4.64 → **1.89 ms** | 5.37 → **2.53 ms** |
| MCP list_posts | 4.00 → **1.87 ms** | 4.44 → **2.70 ms** |

### 并发 10

| 接口 | P95（前 → 后） | RPS（前 → 后） |
|---|---|---|
| 搜索 | 60.23 → **18.51 ms** | 292.9 → **954.1** |
| 后台文章 | 55.12 → **17.12 ms** | 322.7 → **984.8** |
| 后台评论 | 74.63 → **23.84 ms** | 237.8 → **718.9** |
| MCP list_posts | 39.04 → **15.45 ms** | 279.5 → **744.4** |

### 并发 30

| 接口 | P50（前 → 后） | P95（前 → 后） | P99（前 → 后） | RPS（前 → 后） |
|---|---|---|---|---|
| 搜索 | 51.89 → **16.16** | 566.04 → **167.31** | 590.24 → **178.93** | 301.8 → **990.3** |
| 后台文章 | 88.05 → **25.48** | 93.01 → **46.87** | 180.61 → **53.47** | 323.7 → **1062.6** |
| 后台评论 | 119.19 → **39.58** | 122.33 → **46.49** | 238.64 → **81.91** | 243.1 → **714.5** |
| MCP list_posts | 113.10 → **38.20** | 121.58 → **43.30** | 123.02 → **49.65** | 263.4 → **757.4** |

汇总（并发 30）：

- P95 降幅：搜索 **-70.4%**、后台文章 **-49.6%**、后台评论 **-62.0%**、MCP **-64.4%**
- 吞吐提升：**+188% ~ +228%**
- 错误率：全部为 0

## 六、正确性验证

| 验证项 | 结果 |
|---|---|
| 创建文章后列表立即出现 | 通过 |
| 更新文章后列表立即更新 | 通过 |
| 删除文章后列表立即消失 | 通过 |
| 评论审核后状态立即刷新 | 通过 |
| `node test.mjs` | 90 / 90 |
| `npm run test:sqlite` | 9 / 9 |
| `test-security.mjs` | 11 / 11 |
| `test-bundle.mjs` | 8 / 8 |
| `edge-functions` 产物重建 | 356.9 KB，构建通过 |
| 正式站 / 公网 | 均返回 200 |

## 七、限制与后续

1. **多实例一致性**：缓存按进程隔离；写入方进程立即失效，其他实例最多 5 秒旧索引。博客读多写少，可接受；若需要更强一致性，可改为 `idxver:<key>` 版本号方案（每次读取多一次小键查询）。
2. **内存占用**：缓存约等于索引大小（当前 208 KB/进程）。数据量增长到几十 MB 时需改为分页索引或 SQLite 表化。
3. **同步 SQLite 仍是单线程瓶颈**：并发 30 的搜索 P95 仍有 167 ms，主要来自 HTML 快照 32 KB 的读取/解析与单线程排队。下一步可将公开页快照放入进程内 Map（60s TTL），减少一次 JSON.parse。
4. **评论索引排序**：1503 条时 46 ms P95 可接受；若评论上万，建议按时间分片键（`idx:cmts:YYYYMM`）或迁移到 SQLite 关系表。
5. **写热点**：高频写入会频繁失效索引缓存；当前后台写操作频率低，收益稳定。

## 八、复现

```bash
# 1. 准备数据（隔离库，不触碰正式站点）
node --experimental-sqlite docs/perf/seed.mjs

# 2. 启动性能实例
node --experimental-sqlite server.mjs --port 5185 --db /tmp/perf/blog.sqlite

# 3. 基线/优化后各跑一轮
node docs/perf/benchmark.mjs
# 结果输出到 /tmp/perf/baseline.json（或通过 OUT 指定）

# 4. 正确性验证
python3 docs/perf/correctness.py
```

> 压测与数据准备均在 `/tmp/perf` 隔离实例完成，正式站与公网服务未受影响。
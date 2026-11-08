/**
 * MCP（Model Context Protocol）服务端
 *
 * 通过 JSON-RPC over HTTP（POST /mcp）把站点的文章、分类、标签、评论、
 * 附件与站点信息暴露给 AI 客户端。仅当后台「安全设置 → MCP 服务」开启，
 * 且请求携带正确 Bearer Token 时可用。
 *
 * 支持协议版本：2024-11-05 / 2025-03-26 / 2025-06-18
 * 传输方式：Streamable HTTP 的 JSON 响应（不维持 SSE 长连接，适配边缘函数）
 */
import { hashPassword } from './auth/password.js';

const PROTOCOL_VERSION = '2025-03-26';
const SUPPORTED_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);
const SERVER_INFO = { name: 'typecho-edge-mcp', version: '1.0.0' };

// 不返回 Access-Control-Allow-Origin: *：MCP 客户端通常是服务端调用，
// 去掉通配 CORS 可防止任意网页读取管理 API。同源调用不需要 CORS 头。
const CORS = {
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-MCP-Token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS,
      ...extra,
    },
  });

const rpcOk = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
});

/** 常量时间字符串比较，避免令牌被逐字符试探 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const text = (v) => (v == null ? '' : String(v));
const numberOr = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function isDrawComment(t) {
  return /^\{!\{data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+\}!\}$/.test(t);
}

function plainText(t, len = 300) {
  const s = text(t).replace(/\{!\{[\s\S]*?\}!\}/g, '[图片]').replace(/\s+/g, ' ').trim();
  return s.length > len ? `${s.slice(0, len)}…` : s;
}

/** 把 mid / slug / 名称统一解析为 mid；名称不存在时自动创建（与后台行为一致） */
async function resolveMetaIds(db, values, type) {
  if (values == null) return undefined;
  const raw = Array.isArray(values) ? values : String(values).split(/[,，]/);
  const names = raw.map((v) => text(v).trim()).filter(Boolean);
  if (!names.length) return [];
  const metas = await db.listMetas(type);
  const ids = [];
  for (const value of names) {
    if (/^\d+$/.test(value)) {
      ids.push(Number(value));
      continue;
    }
    let meta = metas.find((m) => m.name === value || m.slug === value);
    if (!meta) {
      meta = await db.createMeta({ name: value, slug: value, type, description: '' });
      metas.push(meta);
    }
    ids.push(meta.mid);
  }
  return [...new Set(ids)];
}

async function resolveMetaId(db, value, type) {
  const ids = await resolveMetaIds(db, value == null ? [] : [value], type);
  return ids && ids.length ? ids[0] : undefined;
}

async function adminUid(db) {
  const users = await db.listUsers();
  const admin = users.find((u) => u.group === 'administrator') || users[0];
  return admin ? admin.uid : 1;
}

function buildFields(args, existing = {}) {
  const fields = { ...existing };
  for (const key of ['abstract', 'thumb', 'mode']) {
    if (args[key] === undefined) continue;
    if (args[key] === null || args[key] === '') delete fields[key];
    else fields[key] = text(args[key]);
  }
  return fields;
}

async function findContent(db, args) {
  const cid = numberOr(args.cid, 0);
  if (cid) return await db.getContent(cid);
  const slug = text(args.slug).trim();
  if (!slug) return null;
  const type = args.type === 'page' ? 'page' : 'post';
  return (await db.getContentBySlug(slug, type)) || (await db.getContentBySlug(slug, type === 'post' ? 'page' : 'post'));
}

/* ==================== 工具定义 ==================== */

const TOOLS = [
  {
    name: 'list_posts',
    description: '分页查询文章或独立页面，支持按状态、分类、标签、关键词筛选。',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1, description: '页码，默认 1' },
        pageSize: { type: 'integer', minimum: 1, maximum: 100, description: '每页数量，默认 20' },
        type: { type: 'string', enum: ['post', 'page'], description: '内容类型，默认 post' },
        status: { type: 'string', enum: ['publish', 'hidden'], description: '状态筛选' },
        category: { type: ['string', 'integer'], description: '分类 mid、slug 或名称' },
        tag: { type: ['string', 'integer'], description: '标签 mid、slug 或名称' },
        keyword: { type: 'string', description: '标题关键词' },
        order: { type: 'string', enum: ['created', 'views', 'agree', 'commentsNum'], description: '排序字段' },
      },
    },
    async run(ctx, args) {
      const { db } = ctx;
      const page = Math.max(1, numberOr(args.page, 1));
      const pageSize = clamp(numberOr(args.pageSize, 20), 1, 100);
      const query = {
        type: args.type === 'page' ? 'page' : 'post',
        page,
        pageSize,
        allStatus: true,
      };
      if (args.status) query.status = args.status;
      if (args.keyword) query.keywords = text(args.keyword);
      if (args.order) query.order = args.order;
      const categoryMid = await resolveMetaId(db, args.category, 'category');
      const tagMid = await resolveMetaId(db, args.tag, 'tag');
      if (categoryMid) query.categoryMid = categoryMid;
      if (tagMid) query.tagMid = tagMid;

      const list = await db.listContentsIndex(query);
      const mids = [...new Set(list.items.flatMap((p) => [...(p.categories || []), ...(p.tags || [])]))];
      const metas = mids.length ? await db.getMetasBatch(mids) : [];
      const byMid = new Map(metas.map((m) => [m.mid, m]));
      return {
        total: list.total,
        pages: list.pages,
        page,
        pageSize,
        items: list.items.map((p) => ({
          cid: p.cid,
          title: p.title,
          slug: p.slug,
          type: p.type,
          status: p.status,
          created: p.created,
          modified: p.modified,
          commentsNum: p.commentsNum,
          hasPassword: p.hasPassword,
          categories: (p.categories || []).map((mid) => byMid.get(mid)?.name).filter(Boolean),
          tags: (p.tags || []).map((mid) => byMid.get(mid)?.name).filter(Boolean),
          permalink: `/${p.type === 'page' ? '' : 'archives/'}${p.cid}/`,
        })),
      };
    },
  },
  {
    name: 'get_post',
    description: '按 cid 或 slug 读取文章/页面的完整内容（含 Markdown 正文）。',
    inputSchema: {
      type: 'object',
      properties: {
        cid: { type: 'integer', description: '内容 cid' },
        slug: { type: 'string', description: '内容 slug' },
        type: { type: 'string', enum: ['post', 'page'], description: 'slug 查询时的类型，默认 post' },
      },
    },
    async run(ctx, args) {
      const row = await findContent(ctx.db, args);
      if (!row) throw new Error('内容不存在');
      return row;
    },
  },
  {
    name: 'create_post',
    description: '新建文章或独立页面。分类/标签可传 mid、slug 或名称（名称不存在会自动创建）。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '标题' },
        text: { type: 'string', description: 'Markdown 正文' },
        type: { type: 'string', enum: ['post', 'page'], description: '默认 post' },
        status: { type: 'string', enum: ['publish', 'hidden'], description: '默认 publish' },
        slug: { type: 'string', description: '别名，不传自动生成' },
        categories: { type: 'array', items: { type: ['string', 'integer'] }, description: '分类列表' },
        tags: { type: 'array', items: { type: ['string', 'integer'] }, description: '标签列表' },
        abstract: { type: 'string', description: '自定义摘要' },
        thumb: { type: 'string', description: '缩略图地址' },
        allowComment: { type: 'boolean', description: '是否允许评论，默认 true' },
        password: { type: 'string', description: '访问密码，留空表示无密码' },
      },
      required: ['title', 'text'],
    },
    async run(ctx, args) {
      const { db } = ctx;
      const type = args.type === 'page' ? 'page' : 'post';
      const data = {
        title: text(args.title).trim() || '未命名',
        slug: text(args.slug).trim() || `${type}-${Date.now().toString(36)}`,
        text: text(args.text),
        type,
        status: args.status === 'hidden' ? 'hidden' : 'publish',
        allowComment: args.allowComment !== false,
        categories: (await resolveMetaIds(db, args.categories, 'category')) || [],
        tags: (await resolveMetaIds(db, args.tags, 'tag')) || [],
        fields: buildFields(args),
        password: args.password ? await hashPassword(text(args.password)) : '',
        authorId: await adminUid(db),
      };
      const row = await db.createContent(data);
      return { cid: row.cid, title: row.title, slug: row.slug, type: row.type, status: row.status };
    },
  },
  {
    name: 'update_post',
    description: '更新文章/页面。只更新传入的字段；categories/tags 传 null 可清空，password 传 null 可取消密码。',
    inputSchema: {
      type: 'object',
      properties: {
        cid: { type: 'integer', description: '内容 cid' },
        title: { type: 'string' },
        slug: { type: 'string' },
        text: { type: 'string' },
        type: { type: 'string', enum: ['post', 'page'] },
        status: { type: 'string', enum: ['publish', 'hidden'] },
        categories: { type: ['array', 'null'], items: { type: ['string', 'integer'] } },
        tags: { type: ['array', 'null'], items: { type: ['string', 'integer'] } },
        abstract: { type: ['string', 'null'] },
        thumb: { type: ['string', 'null'] },
        allowComment: { type: 'boolean' },
        password: { type: ['string', 'null'] },
      },
      required: ['cid'],
    },
    async run(ctx, args) {
      const { db } = ctx;
      const cid = numberOr(args.cid, 0);
      const row = cid ? await db.getContent(cid) : null;
      if (!row) throw new Error('内容不存在');
      const patch = {};
      if (args.title !== undefined) patch.title = text(args.title).trim() || row.title;
      if (args.slug !== undefined) patch.slug = text(args.slug).trim() || row.slug;
      if (args.text !== undefined) patch.text = text(args.text);
      if (args.type !== undefined) patch.type = args.type === 'page' ? 'page' : 'post';
      if (args.status !== undefined) patch.status = args.status === 'hidden' ? 'hidden' : 'publish';
      if (args.allowComment !== undefined) patch.allowComment = args.allowComment !== false;
      if (args.categories !== undefined) patch.categories = (await resolveMetaIds(db, args.categories, 'category')) || [];
      if (args.tags !== undefined) patch.tags = (await resolveMetaIds(db, args.tags, 'tag')) || [];
      if (args.abstract !== undefined || args.thumb !== undefined) {
        patch.fields = buildFields(args, row.fields || {});
      }
      if (args.password !== undefined) {
        patch.password = args.password ? await hashPassword(text(args.password)) : '';
      }
      const updated = await db.updateContent(cid, patch);
      return { cid: updated.cid, title: updated.title, status: updated.status, modified: updated.modified };
    },
  },
  {
    name: 'delete_post',
    description: '删除文章/页面，并级联删除其评论。',
    inputSchema: {
      type: 'object',
      properties: { cid: { type: 'integer', description: '内容 cid' } },
      required: ['cid'],
    },
    async run(ctx, args) {
      const cid = numberOr(args.cid, 0);
      if (!cid) throw new Error('缺少 cid');
      const ok = await ctx.db.deleteContent(cid);
      if (!ok) throw new Error('内容不存在');
      return { ok: true, cid };
    },
  },

  {
    name: 'list_categories',
    description: '列出全部分类及其文章数。',
    inputSchema: { type: 'object', properties: {} },
    async run(ctx) {
      const list = await ctx.db.listMetas('category');
      return list.map((m) => ({ mid: m.mid, name: m.name, slug: m.slug, description: m.description || '', count: m.count || 0 }));
    },
  },
  {
    name: 'create_category',
    description: '新建分类。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        slug: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['name'],
    },
    async run(ctx, args) {
      const name = text(args.name).trim();
      if (!name) throw new Error('分类名称不能为空');
      const meta = await ctx.db.createMeta({
        name,
        slug: text(args.slug).trim() || name,
        type: 'category',
        description: text(args.description),
      });
      return { mid: meta.mid, name: meta.name, slug: meta.slug };
    },
  },
  {
    name: 'update_category',
    description: '修改分类名称、slug 或描述。',
    inputSchema: {
      type: 'object',
      properties: {
        mid: { type: 'integer' },
        name: { type: 'string' },
        slug: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['mid'],
    },
    async run(ctx, args) {
      const patch = {};
      if (args.name !== undefined) patch.name = text(args.name).trim();
      if (args.slug !== undefined) patch.slug = text(args.slug).trim();
      if (args.description !== undefined) patch.description = text(args.description);
      const meta = await ctx.db.updateMeta(numberOr(args.mid, 0), patch);
      if (!meta) throw new Error('分类不存在');
      return { mid: meta.mid, name: meta.name, slug: meta.slug, description: meta.description || '' };
    },
  },
  {
    name: 'delete_category',
    description: '删除分类（文章上的该分类会被移除）。',
    inputSchema: {
      type: 'object',
      properties: { mid: { type: 'integer' } },
      required: ['mid'],
    },
    async run(ctx, args) {
      const ok = await ctx.db.deleteMeta(numberOr(args.mid, 0));
      if (!ok) throw new Error('分类不存在');
      return { ok: true, mid: numberOr(args.mid, 0) };
    },
  },

  {
    name: 'list_tags',
    description: '列出全部标签及其文章数。',
    inputSchema: { type: 'object', properties: {} },
    async run(ctx) {
      const list = await ctx.db.listMetas('tag');
      return list.map((m) => ({ mid: m.mid, name: m.name, slug: m.slug, description: m.description || '', count: m.count || 0 }));
    },
  },
  {
    name: 'create_tag',
    description: '新建标签。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        slug: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['name'],
    },
    async run(ctx, args) {
      const name = text(args.name).trim();
      if (!name) throw new Error('标签名称不能为空');
      const meta = await ctx.db.createMeta({
        name,
        slug: text(args.slug).trim() || name,
        type: 'tag',
        description: text(args.description),
      });
      return { mid: meta.mid, name: meta.name, slug: meta.slug };
    },
  },
  {
    name: 'update_tag',
    description: '修改标签名称、slug 或描述。',
    inputSchema: {
      type: 'object',
      properties: {
        mid: { type: 'integer' },
        name: { type: 'string' },
        slug: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['mid'],
    },
    async run(ctx, args) {
      const patch = {};
      if (args.name !== undefined) patch.name = text(args.name).trim();
      if (args.slug !== undefined) patch.slug = text(args.slug).trim();
      if (args.description !== undefined) patch.description = text(args.description);
      const meta = await ctx.db.updateMeta(numberOr(args.mid, 0), patch);
      if (!meta) throw new Error('标签不存在');
      return { mid: meta.mid, name: meta.name, slug: meta.slug, description: meta.description || '' };
    },
  },
  {
    name: 'delete_tag',
    description: '删除标签（文章上的该标签会被移除）。',
    inputSchema: {
      type: 'object',
      properties: { mid: { type: 'integer' } },
      required: ['mid'],
    },
    async run(ctx, args) {
      const ok = await ctx.db.deleteMeta(numberOr(args.mid, 0));
      if (!ok) throw new Error('标签不存在');
      return { ok: true, mid: numberOr(args.mid, 0) };
    },
  },

  {
    name: 'list_comments',
    description: '分页查询评论，支持按状态筛选。',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1 },
        pageSize: { type: 'integer', minimum: 1, maximum: 100 },
        status: { type: 'string', enum: ['approved', 'pending', 'spam'] },
        cid: { type: 'integer', description: '只看某篇文章的评论' },
      },
    },
    async run(ctx, args) {
      const page = Math.max(1, numberOr(args.page, 1));
      const pageSize = clamp(numberOr(args.pageSize, 20), 1, 100);
      const status = args.status || undefined;
      const result = await ctx.db.listAllComments({ status, page, pageSize });
      let items = result.items;
      const cid = numberOr(args.cid, 0);
      if (cid) items = items.filter((c) => c.cid === cid);
      return {
        total: cid ? items.length : result.total,
        page,
        pageSize,
        items: items.map((c) => ({
          coid: c.coid,
          cid: c.cid,
          author: c.author,
          mail: c.mail,
          text: isDrawComment(c.text) ? '[图片评论]' : plainText(c.text),
          status: c.status,
          parent: c.parent,
          created: c.created,
        })),
      };
    },
  },
  {
    name: 'set_comment_status',
    description: '审核评论：approved（通过）/ pending（待审）/ spam（垃圾）。',
    inputSchema: {
      type: 'object',
      properties: {
        coid: { type: 'integer' },
        status: { type: 'string', enum: ['approved', 'pending', 'spam'] },
      },
      required: ['coid', 'status'],
    },
    async run(ctx, args) {
      const coid = numberOr(args.coid, 0);
      if (!coid) throw new Error('缺少 coid');
      if (!['approved', 'pending', 'spam'].includes(args.status)) throw new Error('非法的评论状态');
      const row = await ctx.db.updateComment(coid, { status: args.status });
      if (!row) throw new Error('评论不存在');
      return { ok: true, coid, status: args.status };
    },
  },
  {
    name: 'delete_comment',
    description: '删除评论。',
    inputSchema: {
      type: 'object',
      properties: { coid: { type: 'integer' } },
      required: ['coid'],
    },
    async run(ctx, args) {
      const coid = numberOr(args.coid, 0);
      if (!coid) throw new Error('缺少 coid');
      const ok = await ctx.db.deleteComment(coid);
      if (!ok) throw new Error('评论不存在');
      return { ok: true, coid };
    },
  },

  {
    name: 'get_site_info',
    description: '读取站点基本信息与内容统计（不含敏感配置）。',
    inputSchema: { type: 'object', properties: {} },
    async run(ctx) {
      const { db, options } = ctx;
      const [posts, pages, attachments, categories, tags, comments] = await Promise.all([
        db.listContentsIndex({ type: 'post', pageSize: 1, allStatus: true }),
        db.listContentsIndex({ type: 'page', pageSize: 1, allStatus: true }),
        db.listContentsIndex({ type: 'attachment', pageSize: 1, allStatus: true }),
        db.listMetas('category'),
        db.listMetas('tag'),
        db.listAllComments({ pageSize: 1 }),
      ]);
      return {
        site: {
          title: options.title || '',
          description: options.description || '',
          keywords: options.keywords || '',
          theme: options.theme || 'joe',
          pageSize: options.pageSize || 10,
          siteCreated: options.siteCreated || 0,
        },
        counts: {
          posts: posts.total,
          pages: pages.total,
          attachments: attachments.total,
          comments: comments.total,
          categories: categories.length,
          tags: tags.length,
        },
        mcp: { endpoint: '/mcp', protocolVersion: PROTOCOL_VERSION },
      };
    },
  },
  {
    name: 'update_site_info',
    description: '修改站点基础信息（标题、描述、关键词、每页数量、评论审核策略）。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        keywords: { type: 'string' },
        pageSize: { type: 'integer', minimum: 1, maximum: 100 },
        commentStatus: { type: 'string', enum: ['approved', 'waiting'] },
      },
    },
    async run(ctx, args) {
      const { db } = ctx;
      const patch = {};
      if (args.title !== undefined) patch.title = text(args.title).trim();
      if (args.description !== undefined) patch.description = text(args.description).trim();
      if (args.keywords !== undefined) patch.keywords = text(args.keywords).trim();
      if (args.pageSize !== undefined) patch.pageSize = clamp(numberOr(args.pageSize, 10), 1, 100);
      if (args.commentStatus !== undefined) {
        if (!['approved', 'waiting'].includes(args.commentStatus)) throw new Error('非法的评论审核策略');
        patch.commentStatus = args.commentStatus;
      }
      for (const [key, value] of Object.entries(patch)) await db.setOption(key, value);
      return { ok: true, updated: Object.keys(patch) };
    },
  },

  {
    name: 'list_media',
    description: '分页列出上传的附件。',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1 },
        pageSize: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
    async run(ctx, args) {
      const page = Math.max(1, numberOr(args.page, 1));
      const pageSize = clamp(numberOr(args.pageSize, 20), 1, 100);
      const list = await ctx.db.listContents({ type: 'attachment', page, pageSize, allStatus: true });
      return {
        total: list.total,
        pages: list.pages,
        page,
        pageSize,
        items: list.items.map((f) => ({
          cid: f.cid,
          name: f.title,
          slug: f.slug,
          url: `/upload/${encodeURIComponent(f.slug)}`,
          contentType: f.fields?.contentType || '',
          size: f.fields?.size || 0,
          created: f.created,
        })),
      };
    },
  },
  {
    name: 'delete_media',
    description: '删除附件（同时删除 Blob 中的文件）。',
    inputSchema: {
      type: 'object',
      properties: { cid: { type: 'integer' } },
      required: ['cid'],
    },
    async run(ctx, args) {
      const cid = numberOr(args.cid, 0);
      if (!cid) throw new Error('缺少 cid');
      const row = await ctx.db.getContent(cid);
      if (!row || row.type !== 'attachment') throw new Error('附件不存在');
      await ctx.db.deleteContent(cid);
      return { ok: true, cid };
    },
  },
];

const TOOL_MAP = new Map(TOOLS.map((tool) => [tool.name, tool]));

/* ==================== 多令牌配置 ==================== */
/** 读取 MCP 令牌列表；自动兼容旧版单令牌 mcp:enabled/mcp:token */
export async function loadMcpServers(db) {
  const list = await db.getOption('mcp:list');
  if (Array.isArray(list)) return list;
  const token = await db.getOption('mcp:token');
  if (!token) return [];
  return [{
    id: 'legacy',
    name: '默认 MCP',
    remark: '由旧版单令牌自动迁移',
    token: String(token),
    enabled: (await db.getOption('mcp:enabled')) === true,
    createdAt: 0,
  }];
}

/** 保存令牌列表，并清理旧版单令牌字段 */
export async function saveMcpServers(db, list) {
  await db.setOption('mcp:list', list);
  await db.setOption('mcp:enabled', null);
  await db.setOption('mcp:token', null);
}

/* ==================== JSON-RPC 分发 ==================== */

async function dispatch(ctx, message) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
    return rpcError(message?.id, -32600, 'Invalid Request');
  }
  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  try {
    if (method === 'initialize') {
      const requested = params?.protocolVersion;
      return rpcOk(id, {
        protocolVersion: SUPPORTED_VERSIONS.has(requested) ? requested : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          '你现在连接的是 TypechoEdge 博客。可以使用 list_posts/get_post/create_post/update_post/delete_post 管理文章，' +
          '使用 list_categories、list_tags 及其 create/update/delete 管理分类与标签，' +
          '使用 list_comments、set_comment_status、delete_comment 管理评论，还可以读取/修改站点基础信息与附件。',
      });
    }
    if (method === 'ping') return rpcOk(id, {});
    if (method === 'tools/list') return rpcOk(id, { tools: TOOLS.map(({ run, ...t }) => t) });
    if (method === 'tools/call') {
      const name = params?.name;
      const tool = TOOL_MAP.get(name);
      if (!tool) {
        return rpcOk(id, { content: [{ type: 'text', text: `未知工具：${text(name)}` }], isError: true });
      }
      try {
        const result = await tool.run(ctx, params?.arguments || {});
        return rpcOk(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
      } catch (error) {
        return rpcOk(id, {
          content: [{ type: 'text', text: String(error?.message || error) }],
          isError: true,
        });
      }
    }
    if (isNotification) return null;
    return rpcError(id, -32601, `Method not found: ${text(method)}`);
  } catch (error) {
    return isNotification ? null : rpcError(id, -32603, String(error?.message || error));
  }
}

/* ==================== HTTP 入口 ==================== */

export async function handleMcp(ctx) {
  const { request, db } = ctx;

  // 未启用时直接 404，不暴露端点是否存在
  const servers = (await loadMcpServers(db)).filter((s) => s && s.enabled !== false && s.token);
  if (!servers.length) return new Response('Not Found', { status: 404 });

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') {
    return jsonResponse({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method Not Allowed' } }, 405);
  }

  const authorization = request.headers.get('Authorization') || '';
  const provided = authorization.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : (request.headers.get('X-MCP-Token') || '').trim();
  const matched = servers.find((server) => safeEqual(provided, text(server.token)));
  if (!matched) {
    return jsonResponse({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }, 401, {
      'WWW-Authenticate': 'Bearer',
    });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(rpcError(null, -32700, 'Parse error'), 400);
  }

  if (Array.isArray(payload)) {
    const results = [];
    for (const message of payload) {
      const result = await dispatch(ctx, message);
      if (result) results.push(result);
    }
    if (!results.length) return new Response(null, { status: 202, headers: CORS });
    return jsonResponse(results);
  }

  const result = await dispatch(ctx, payload);
  if (!result) return new Response(null, { status: 202, headers: CORS });
  return jsonResponse(result);
}

/** 供后台展示的 MCP 配置说明（不包含真实令牌） */
export function mcpClientExample(endpoint) {
  return JSON.stringify(
    {
      mcpServers: {
        'typecho-edge': {
          url: `${endpoint}/mcp`,
          headers: { Authorization: 'Bearer <在后台生成的令牌>' },
        },
      },
    },
    null,
    2
  );
}
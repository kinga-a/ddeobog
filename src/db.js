/**
 * 数据层 —— 将 Typecho 的 7 张表（contents/metas/comments/users/options/fields/relationships）
 * 映射为 EdgeOne KV 中的 JSON 文档 + 轻量索引。
 *
 * KV 键布局：
 *   opt:<name>                 配置项（对应 typecho_options）
 *   user:<uid>                 用户（对应 typecho_users）
 *   usern:<name> / userm:<mail> 用户名/邮箱 → uid 索引
 *   post:<cid>                 内容全文（对应 typecho_contents + fields + relationships）
 *   meta:<mid>                 分类/标签（对应 typecho_metas）
 *   cmt:<coid>                 评论（对应 typecho_comments）
 *   idx:posts                  文章索引（列表元数据，按 created 倒序）
 *   idx:metas                  分类/标签索引
 *   idx:cmts                   评论索引
 *   stat:views / stat:agree    浏览/点赞计数表（cid → n）
 *   seq:cid/mid/coid/uid       自增序列
 *   sess:<token>               登录会话
 */
import { KV } from './storage/kv.js';
import { BlobStorage } from './storage/blob.js';

/** 索引里存一份纯文本摘要，列表页不必再读正文；旧索引缺失时由列表查询回填 */
function plainAbstract(text, len = 90) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~]/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, len);
}

export class Database {
  constructor(kv, blob) {
    this.kv = kv;
    this.blob = blob;
  }

  // ---------- 序列 ----------
  async nextId(seq) {
    // Node 预览/测试环境保留递增 ID，保证测试与本地数据可复现；
    // EdgeOne 边缘运行时没有 process，也没有 KV 原子自增，改用「毫秒时间戳 + 3 位随机数」，
    // 避免并发创建拿到同一个 cid/coid。最大约 1.7e15，仍在 Number 安全整数范围内。
    if (globalThis.process?.versions?.node) {
      const key = `seq:${seq}`;
      const cur = parseInt((await this.kv.get(key)) || '0', 10);
      const next = cur + 1;
      await this.kv.put(key, String(next));
      return next;
    }
    const random = globalThis.crypto?.getRandomValues
      ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % 1000
      : Math.floor(Math.random() * 1000);
    return Date.now() * 1000 + random;
  }

  // ---------- options ----------
  async getOption(name, fallback = null) {
    const v = await this.kv.get(`opt:${name}`, 'json');
    return v === null || v === undefined ? fallback : v;
  }
  async setOption(name, value) {
    await this.kv.putJSON(`opt:${name}`, value);
  }
  async getOptions() {
    const keys = await this.kv.listKeys('opt:');
    const values = await this.kv.getBatch(keys);
    const out = {};
    for (const k of keys) out[k.slice(4)] = values.get(k);
    return out;
  }
  async isInstalled() {
    return (await this.getOption('installed')) === 1;
  }

  // ---------- users ----------
  async getUser(uid) {
    return await this.kv.getJSON(`user:${uid}`);
  }
  async getUserByName(name) {
    const uid = await this.kv.get(`usern:${encodeURIComponent(name)}`);
    if (!uid) return null;
    return await this.getUser(uid);
  }
  async getUserByMail(mail) {
    const uid = await this.kv.get(`userm:${encodeURIComponent(mail)}`);
    if (!uid) return null;
    return await this.getUser(uid);
  }
  async createUser({ name, mail, password, screenName, url = '', group = 'administrator' }) {
    const { hashPassword } = await import('./auth/password.js');
    const uid = await this.nextId('uid');
    const user = {
      uid,
      name,
      mail: mail || '',
      url: url || '',
      screenName: screenName || name,
      created: Math.floor(Date.now() / 1000),
      activated: 0,
      logged: 0,
      group,
      passwordHash: await hashPassword(password),
      totpEnabled: false,
      totpSecret: null,
    };
    await this.kv.putJSON(`user:${uid}`, user);
    await this.kv.put(`usern:${encodeURIComponent(name)}`, String(uid));
    if (mail) await this.kv.put(`userm:${encodeURIComponent(mail)}`, String(uid));
    return user;
  }
  async updateUser(uid, patch) {
    const user = await this.getUser(uid);
    if (!user) return null;
    Object.assign(user, patch);
    await this.kv.putJSON(`user:${uid}`, user);
    return user;
  }
  async listUsers() {
    const keys = (await this.kv.listKeys('user:')).filter(
      (k) => !k.startsWith('usern:') && !k.startsWith('userm:')
    );
    const values = await this.kv.getBatch(keys);
    const users = [...values.values()].filter(Boolean);
    users.sort((a, b) => a.uid - b.uid);
    return users;
  }

  // ---------- 索引维护 ----------
  /** 覆写索引中的一条记录（未命中则忽略），可选按 sortFn 重新排序 */
  async #replaceIndexEntry(key, match, entry, sortFn) {
    const idx = (await this.kv.getJSON(key)) || [];
    const i = idx.findIndex(match);
    if (i < 0) return;
    idx[i] = typeof entry === 'function' ? entry(idx[i]) : entry;
    if (sortFn) idx.sort(sortFn);
    await this.kv.putJSON(key, idx);
  }

  /** 从索引中移除一条记录（未命中则忽略） */
  async #dropIndexEntry(key, match) {
    const idx = (await this.kv.getJSON(key)) || [];
    const i = idx.findIndex(match);
    if (i < 0) return;
    idx.splice(i, 1);
    await this.kv.putJSON(key, idx);
  }

  // ---------- contents ----------
  async #loadPostIndex() {
    return (await this.kv.getJSON('idx:posts')) || [];
  }
  async #savePostIndex(idx) {
    await this.kv.putJSON('idx:posts', idx);
  }

  async createContent(data) {
    const cid = await this.nextId('cid');
    const now = Math.floor(Date.now() / 1000);
    const row = {
      cid,
      title: data.title || '',
      slug: data.slug || String(cid),
      created: data.created || now,
      modified: now,
      text: data.text || '',
      order: data.order || 0,
      authorId: data.authorId || 1,
      template: data.template || null,
      type: data.type || 'post', // post | page | attachment
      status: data.status || 'publish',
      password: data.password || '',
      commentsNum: 0,
      allowComment: data.allowComment !== undefined ? data.allowComment : true,
      allowPing: data.allowPing !== undefined ? data.allowPing : true,
      allowFeed: data.allowFeed !== undefined ? data.allowFeed : true,
      parent: data.parent || 0,
      fields: data.fields || {},
      categories: data.categories || [],
      tags: data.tags || [],
    };
    await this.kv.putJSON(`post:${cid}`, row);
    const idx = await this.#loadPostIndex();
    idx.unshift(this.#indexEntry(row));
    await this.#savePostIndex(idx);
    await this.#syncMetaCounts(row.categories, row.tags);
    return row;
  }

  #indexEntry(row) {
    return {
      cid: row.cid,
      title: row.title,
      slug: row.slug,
      abstract: plainAbstract(row.text, 90),
      created: row.created,
      modified: row.modified,
      type: row.type,
      status: row.status,
      commentsNum: row.commentsNum,
      authorId: row.authorId,
      categories: row.categories,
      tags: row.tags,
      hasPassword: !!row.password,
      allowComment: !!row.allowComment,
    };
  }

  async getContent(cid) {
    return await this.kv.getJSON(`post:${cid}`);
  }
  async getContentBySlug(slug, type = 'page') {
    const idx = await this.#loadPostIndex();
    const hit = idx.find((e) => e.slug === slug && e.type === type);
    return hit ? await this.getContent(hit.cid) : null;
  }

  async updateContent(cid, patch) {
    const row = await this.getContent(cid);
    if (!row) return null;
    const oldCats = row.categories, oldTags = row.tags;
    Object.assign(row, patch);
    row.modified = Math.floor(Date.now() / 1000);
    await this.kv.putJSON(`post:${cid}`, row);
    await this.#replaceIndexEntry(
      'idx:posts',
      (e) => e.cid === cid,
      this.#indexEntry(row),
      (a, b) => b.created - a.created
    );
    await this.#syncMetaCounts(row.categories, row.tags, oldCats, oldTags);
    return row;
  }

  async deleteContent(cid, { keepBlob = false } = {}) {
    const row = await this.getContent(cid);
    if (!row) return false;
    // 附件的字节不在 KV 里，KV 行删掉后 slug 就再也找不回来了，
    // 必须先清 Blob 对象再删记录，否则 Blob 空间永久残留（KV 降级通道的
    // file:data: 同理）。这里失败只告警不阻断——记录才是列表的真相。
    if (!keepBlob && row.type === 'attachment' && row.slug) {
      try {
        await this.blob.delete(row.slug);
      } catch (e) {
        console.error('[db] 删除附件 Blob 失败:', row.slug, e && e.message);
      }
    }
    await this.kv.delete(`post:${cid}`);
    await this.#dropIndexEntry('idx:posts', (e) => e.cid === cid);
    // 删除关联评论
    const cidx = await this.#loadCmtIndex();
    const keep = [];
    for (const c of cidx) {
      if (c.cid === cid) await this.kv.delete(`cmt:${c.coid}`);
      else keep.push(c);
    }
    await this.kv.putJSON('idx:cmts', keep);
    await this.#syncMetaCounts([], [], row.categories, row.tags);
    return true;
  }

  /* ---------- 回收站 ---------- */

  /** 软删除内容：先存副本，再从正式数据移除；附件保留 Blob 以便恢复 */
  async trashContent(cid, actor = 'admin') {
    const row = await this.getContent(cid);
    if (!row) return false;
    const cidx = await this.#loadCmtIndex();
    const coids = cidx.filter((c) => c.cid === cid).map((c) => c.coid);
    const comments = await this.loadCommentsBatch(coids);
    const key = `trash:content:${cid}`;
    await this.kv.putJSON(key, {
      key,
      kind: 'content',
      type: row.type,
      id: cid,
      title: row.title || row.slug || String(cid),
      deletedAt: Math.floor(Date.now() / 1000),
      actor,
      data: { row, comments },
    });
    await this.deleteContent(cid, { keepBlob: true });
    return true;
  }

  /** 软删除评论 */
  async trashComment(coid, actor = 'admin') {
    const row = await this.kv.getJSON(`cmt:${coid}`);
    if (!row) return false;
    const key = `trash:comment:${coid}`;
    const preview = String(row.text || '').replace(/\s+/g, ' ').slice(0, 40);
    await this.kv.putJSON(key, {
      key,
      kind: 'comment',
      type: 'comment',
      id: coid,
      title: `${row.author || '匿名'}：${preview}`,
      deletedAt: Math.floor(Date.now() / 1000),
      actor,
      data: { comment: row },
    });
    await this.deleteComment(coid);
    return true;
  }

  /** 软删除分类/标签，并记录受影响的文章以便恢复 */
  async trashMeta(mid, actor = 'admin') {
    const meta = await this.getMeta(mid);
    if (!meta) return false;
    const listName = meta.type === 'category' ? 'categories' : 'tags';
    const idx = await this.#loadPostIndex();
    const affectedPosts = idx.filter((e) => (e[listName] || []).includes(mid)).map((e) => e.cid);
    const key = `trash:meta:${mid}`;
    await this.kv.putJSON(key, {
      key,
      kind: 'meta',
      type: meta.type,
      id: mid,
      title: meta.name || meta.slug || String(mid),
      deletedAt: Math.floor(Date.now() / 1000),
      actor,
      data: { meta, affectedPosts },
    });
    await this.deleteMeta(mid);
    return true;
  }

  /** 列出回收站条目（按删除时间倒序） */
  async listTrash() {
    const keys = await this.kv.listKeys('trash:');
    if (!keys.length) return [];
    const map = await this.kv.getBatch(keys);
    return [...map.values()]
      .filter(Boolean)
      .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  }

  /** 从回收站恢复一条记录 */
  async restoreTrash(key) {
    const entry = await this.kv.getJSON(key);
    if (!entry) throw new Error('回收站条目不存在');
    if (entry.kind === 'content') await this.#restoreTrashContent(entry);
    else if (entry.kind === 'comment') await this.#restoreTrashComment(entry);
    else if (entry.kind === 'meta') await this.#restoreTrashMeta(entry);
    else throw new Error('未知的回收站条目类型');
    await this.kv.delete(key);
    return entry;
  }

  async #restoreTrashContent(entry) {
    const row = entry.data && entry.data.row;
    if (!row) throw new Error('回收站条目缺少内容数据');
    if (await this.getContent(row.cid)) throw new Error('同 ID 内容已存在，无法恢复');
    const comments = (entry.data.comments || []).filter(Boolean);
    row.commentsNum = comments.filter((c) => c.status === 'approved').length;
    await this.kv.putJSON(`post:${row.cid}`, row);

    const idx = await this.#loadPostIndex();
    if (!idx.some((e) => e.cid === row.cid)) {
      idx.unshift(this.#indexEntry(row));
      await this.#savePostIndex(idx);
    }

    if (comments.length) {
      const cidx = await this.#loadCmtIndex();
      for (const c of comments) {
        await this.kv.putJSON(`cmt:${c.coid}`, c);
        if (!cidx.some((x) => x.coid === c.coid)) {
          cidx.push({ coid: c.coid, cid: c.cid, created: c.created, status: c.status });
        }
      }
      await this.kv.putJSON('idx:cmts', cidx);
    }

    await this.#syncMetaCounts(row.categories || [], row.tags || []);
  }

  async #restoreTrashComment(entry) {
    const row = entry.data && entry.data.comment;
    if (!row) throw new Error('回收站条目缺少评论数据');
    if (await this.kv.getJSON(`cmt:${row.coid}`)) throw new Error('同 ID 评论已存在，无法恢复');
    await this.kv.putJSON(`cmt:${row.coid}`, row);
    const idx = await this.#loadCmtIndex();
    if (!idx.some((c) => c.coid === row.coid)) {
      idx.push({ coid: row.coid, cid: row.cid, created: row.created, status: row.status });
      await this.kv.putJSON('idx:cmts', idx);
    }
    if (row.status === 'approved') await this.#bumpCommentsNum(row.cid, 1);
  }

  async #restoreTrashMeta(entry) {
    const meta = entry.data && entry.data.meta;
    if (!meta) throw new Error('回收站条目缺少分类/标签数据');
    if (await this.getMeta(meta.mid)) throw new Error('同 ID 分类/标签已存在，无法恢复');
    await this.kv.putJSON(`meta:${meta.mid}`, meta);

    const midx = await this.#loadMetaIndex();
    if (!midx.some((m) => m.mid === meta.mid)) {
      midx.push({ mid: meta.mid, type: meta.type, slug: meta.slug });
      await this.kv.putJSON('idx:metas', midx);
    }

    const listName = meta.type === 'category' ? 'categories' : 'tags';
    for (const cid of entry.data.affectedPosts || []) {
      const row = await this.getContent(cid);
      if (!row) continue;
      row[listName] = [...new Set([...(row[listName] || []), meta.mid])];
      await this.kv.putJSON(`post:${cid}`, row);
      await this.#replaceIndexEntry('idx:posts', (e) => e.cid === cid, (prev) => ({
        ...prev,
        [listName]: row[listName],
      }));
    }

    await this.#recountMeta(meta.mid, meta.type);
  }

  /** 按文章索引重算某分类/标签的文章数 */
  async #recountMeta(mid, type) {
    const listName = type === 'category' ? 'categories' : 'tags';
    const idx = await this.#loadPostIndex();
    const count = idx.filter((e) => (e[listName] || []).includes(mid)).length;
    const meta = await this.getMeta(mid);
    if (meta) {
      meta.count = count;
      await this.kv.putJSON(`meta:${mid}`, meta);
    }
    await this.#replaceIndexEntry('idx:metas', (m) => m.mid === mid, (prev) => ({ ...prev, count }));
  }

  /** 永久删除一条回收站记录（附件同时删除 Blob） */
  async purgeTrash(key) {
    const entry = await this.kv.getJSON(key);
    if (!entry) return false;
    if (entry.kind === 'content' && entry.type === 'attachment') {
      const slug = entry.data && entry.data.row && entry.data.row.slug;
      if (slug) {
        try {
          await this.blob.delete(slug);
        } catch (e) {
          console.error('[db] 清理回收站附件失败:', slug, e && e.message);
        }
      }
    }
    await this.kv.delete(key);
    return true;
  }

  /** 清空回收站 */
  async emptyTrash() {
    const keys = await this.kv.listKeys('trash:');
    let removed = 0;
    for (const key of keys) {
      if (await this.purgeTrash(key)) removed += 1;
    }
    return removed;
  }

  /**
   * 内容列表查询（返回完整内容，兼容旧调用）
   * @param {object} q type/status/page/pageSize/categoryMid/tagMid/keywords/order/year/month/authorId
   */
  async listContents(q = {}) {
    const result = await this.listContentsIndex(q);
    // 兼容旧代码：逐个加载完整内容（仅在确实需要正文时使用）
    const items = await Promise.all(result.items.map((e) => this.getContent(e.cid)));
    return { ...result, items: items.filter(Boolean) };
  }

  /**
   * 内容列表查询（仅返回索引元数据，不加载正文，高性能）
   * @param {object} q type/status/page/pageSize/categoryMid/tagMid/keywords/order/year/month/authorId
   */
  async listContentsIndex(q = {}) {
    const {
      type = 'post',
      status = 'publish',
      page = 1,
      pageSize = 10,
      categoryMid,
      tagMid,
      keywords,
      order = 'created',
      year,
      month,
      authorId,
      allStatus = false,
    } = q;
    let idx = await this.#loadPostIndex();
    let list = idx.filter(
      (e) => e.type === type && (allStatus || e.status === status)
    );
    if (categoryMid) list = list.filter((e) => e.categories.includes(categoryMid));
    if (tagMid) list = list.filter((e) => e.tags.includes(tagMid));
    if (authorId) list = list.filter((e) => e.authorId === authorId);
    if (year) list = list.filter((e) => new Date(e.created * 1000).getFullYear() === year);
    if (month)
      list = list.filter((e) => new Date(e.created * 1000).getMonth() + 1 === month);
    if (keywords) {
      // 关键词搜索：仅在索引标题中匹配，避免 N+1 读取正文
      // 如需全文搜索，建议引入专用搜索引擎（MeiliSearch/Algolia/Typesense）
      const kw = String(keywords).toLowerCase();
      list = list.filter((e) => e.title.toLowerCase().includes(kw));
    }
    if (order === 'views' || order === 'agree') {
      const stat = await this.kv.getJSON(`stat:${order === 'views' ? 'views' : 'agree'}`);
      list = [...list].sort((a, b) => (stat?.[b.cid] || 0) - (stat?.[a.cid] || 0) || b.created - a.created);
    } else if (order === 'commentsNum') {
      list = [...list].sort((a, b) => (b.commentsNum || 0) - (a.commentsNum || 0) || b.created - a.created);
    } else {
      list = [...list].sort((a, b) => b.created - a.created);
    }
    const total = list.length;
    const start = (page - 1) * pageSize;
    const items = list.slice(start, start + pageSize);
    // 兼容历史索引：旧条目没有 abstract 时按需读取正文补齐（只补当前页）
    const missing = items.filter((e) => !e.abstract);
    if (missing.length) {
      const rows = await Promise.all(missing.map((e) => this.getContent(e.cid)));
      rows.forEach((row, i) => {
        missing[i].abstract = plainAbstract(row && row.text, 90);
      });
    }
    return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  /**
   * 批量获取浏览/点赞统计
   * @param {number[]} cids
   * @returns {Map<number, {views: number, agree: number}>}
   */
  async getStatsBatch(cids) {
    if (!cids.length) return new Map();
    const [viewsMap, agreeMap] = await Promise.all([
      this.kv.getJSON('stat:views'),
      this.kv.getJSON('stat:agree'),
    ]);
    const result = new Map();
    for (const cid of cids) {
      result.set(cid, {
        views: (viewsMap?.[cid] || 0),
        agree: (agreeMap?.[cid] || 0),
      });
    }
    return result;
  }

  /**
   * 给列表结果（listContentsIndex 的返回值）补全浏览/点赞数。
   * 首页与归档页此前各自重复实现这段合并逻辑，统一收口到这里。
   * @param {{items: Array}} list
   * @returns {Promise<{items: Array}>}
   */
  async enrichWithStats(list) {
    const statsMap = await this.getStatsBatch(list.items.map((e) => e.cid));
    const items = list.items.map((e) => ({
      ...e,
      views: statsMap.get(e.cid)?.views || 0,
      agree: statsMap.get(e.cid)?.agree || 0,
    }));
    return { ...list, items };
  }

  /** 上一篇/下一篇（按时间相邻的已发布同类型内容） */
  async prevNext(cid, type = 'post') {
    const idx = (await this.#loadPostIndex())
      .filter((e) => e.type === type && e.status === 'publish' && !e.hasPassword)
      .sort((a, b) => b.created - a.created);
    const i = idx.findIndex((e) => e.cid === cid);
    return {
      prev: i > 0 ? idx[i - 1] : null, // 更新的一篇
      next: i >= 0 && i < idx.length - 1 ? idx[i + 1] : null, // 更早的一篇
    };
  }

  // ---------- metas（分类/标签） ----------
  async #loadMetaIndex() {
    return (await this.kv.getJSON('idx:metas')) || [];
  }
  async listMetas(type) {
    const idx = (await this.#loadMetaIndex()).filter((m) => !type || m.type === type);
    const values = await this.kv.getBatch(idx.map((m) => `meta:${m.mid}`));
    const out = [...values.values()].filter(Boolean);
    out.sort((a, b) => (a.order || 0) - (b.order || 0));
    return out;
  }
  async getMeta(mid) {
    return await this.kv.getJSON(`meta:${mid}`);
  }
  async getMetaBySlug(slug, type) {
    const idx = await this.#loadMetaIndex();
    const hit = idx.find((m) => m.slug === slug && m.type === type);
    return hit ? await this.getMeta(hit.mid) : null;
  }

  /** 批量获取分类/标签详情 */
  async getMetasBatch(mids) {
    if (!mids.length) return [];
    const rows = await Promise.all(mids.map((mid) => this.kv.getJSON(`meta:${mid}`)));
    return rows.filter(Boolean);
  }

  async createMeta({ name, slug, type, description = '' }) {
    const mid = await this.nextId('mid');
    const meta = { mid, name, slug: slug || name, type, description, count: 0, order: 0, parent: 0 };
    await this.kv.putJSON(`meta:${mid}`, meta);
    const idx = await this.#loadMetaIndex();
    idx.push({ mid, type, slug: meta.slug });
    await this.kv.putJSON('idx:metas', idx);
    return meta;
  }
  async updateMeta(mid, patch) {
    const meta = await this.getMeta(mid);
    if (!meta) return null;
    Object.assign(meta, patch);
    await this.kv.putJSON(`meta:${mid}`, meta);
    await this.#replaceIndexEntry(
      'idx:metas',
      (m) => m.mid === mid,
      { mid, type: meta.type, slug: meta.slug }
    );
    return meta;
  }
  async deleteMeta(mid) {
    const meta = await this.getMeta(mid);
    if (!meta) return false;
    await this.kv.delete(`meta:${mid}`);
    await this.#dropIndexEntry('idx:metas', (m) => m.mid === mid);
    // 从文章中移除该 meta
    const postIdx = await this.#loadPostIndex();
    for (const e of postIdx) {
      const listName = meta.type === 'category' ? 'categories' : 'tags';
      if (e[listName]?.includes(mid)) {
        const row = await this.getContent(e.cid);
        if (row) {
          row[listName] = row[listName].filter((m) => m !== mid);
          await this.kv.putJSON(`post:${row.cid}`, row);
        }
      }
    }
    return true;
  }
  /** 内容分类/标签变更后同步计数（增量更新，避免全量扫描） */
  async #syncMetaCounts(newCats = [], newTags = [], oldCats = [], oldTags = []) {
    const affected = new Set([...newCats, ...newTags, ...oldCats, ...oldTags]);
    if (!affected.size) return;
    // 仅更新受影响的 meta：+1 或 -1
    for (const mid of affected) {
      const meta = await this.getMeta(mid);
      if (!meta) continue;
      // 计算增量：新增的计 +1，移除的计 -1
      let delta = 0;
      if (newCats.includes(mid) || newTags.includes(mid)) delta += 1;
      if (oldCats.includes(mid) || oldTags.includes(mid)) delta -= 1;
      if (delta !== 0) {
        meta.count = Math.max(0, (meta.count || 0) + delta);
        await this.kv.putJSON(`meta:${mid}`, meta);
      }
    }
  }

  // ---------- comments ----------
  async #loadCmtIndex() {
    return (await this.kv.getJSON('idx:cmts')) || [];
  }
  async createComment({ cid, author, authorId = 0, ownerId = 0, mail, url, ip, agent, text, parent = 0, status = 'approved' }) {
    const coid = await this.nextId('coid');
    const now = Math.floor(Date.now() / 1000);
    const row = {
      coid, cid, created: now, author, authorId, ownerId,
      mail: mail || '', url: url || '', ip: ip || '', agent: agent || '',
      text: text || '', type: 'comment', status, parent,
    };
    await this.kv.putJSON(`cmt:${coid}`, row);
    const idx = await this.#loadCmtIndex();
    idx.push({ coid, cid, created: now, status });
    await this.kv.putJSON('idx:cmts', idx);
    if (status === 'approved') await this.#bumpCommentsNum(cid, 1);
    return row;
  }
  async #bumpCommentsNum(cid, delta) {
    const row = await this.getContent(cid);
    if (!row) return;
    row.commentsNum = Math.max(0, (row.commentsNum || 0) + delta);
    await this.kv.putJSON(`post:${cid}`, row);
    await this.#replaceIndexEntry('idx:posts', (e) => e.cid === cid, (prev) => ({
      ...prev,
      commentsNum: row.commentsNum,
    }));
  }
  async updateComment(coid, patch) {
    const row = await this.kv.getJSON(`cmt:${coid}`);
    if (!row) return null;
    const oldStatus = row.status;
    Object.assign(row, patch);
    await this.kv.putJSON(`cmt:${coid}`, row);
    await this.#replaceIndexEntry('idx:cmts', (c) => c.coid === coid, (prev) => ({
      ...prev,
      status: row.status,
    }));
    if (oldStatus !== row.status) {
      await this.#bumpCommentsNum(row.cid, row.status === 'approved' ? 1 : -1);
    }
    return row;
  }
  async deleteComment(coid) {
    const row = await this.kv.getJSON(`cmt:${coid}`);
    if (!row) return false;
    await this.kv.delete(`cmt:${coid}`);
    await this.#dropIndexEntry('idx:cmts', (c) => c.coid === coid);
    if (row.status === 'approved') await this.#bumpCommentsNum(row.cid, -1);
    return true;
  }
  /** 某内容的已通过评论（含嵌套结构）——批量加载 */
  async listComments(cid) {
    const idx = await this.#loadCmtIndex();
    const coids = idx
      .filter((c) => c.cid === cid && c.status === 'approved')
      .map((c) => c.coid);
    const rows = await this.loadCommentsBatch(coids);
    return rows.sort((a, b) => a.created - b.created);
  }

  /** 批量加载评论详情 */
  async loadCommentsBatch(coids) {
    if (!coids.length) return [];
    const rows = await Promise.all(coids.map((coid) => this.kv.getJSON(`cmt:${coid}`)));
    return rows.filter(Boolean);
  }

  /** 后台评论管理——批量加载 */
  async listAllComments({ status, page = 1, pageSize = 20 }) {
    const idx = await this.#loadCmtIndex();
    let list = [...idx].sort((a, b) => b.created - a.created);
    if (status) list = list.filter((c) => c.status === status);
    const total = list.length;
    const pageItems = list.slice((page - 1) * pageSize, page * pageSize);
    const coids = pageItems.map((c) => c.coid);
    const items = await this.loadCommentsBatch(coids);
    // 保持原排序
    const byCoid = new Map(items.map((r) => [r.coid, r]));
    const ordered = coids.map((id) => byCoid.get(id)).filter(Boolean);
    return { items: ordered, total, page, pageSize };
  }

  async recentComments(n = 5) {
    const idx = await this.#loadCmtIndex();
    const coids = [...idx]
      .sort((a, b) => b.created - a.created)
      .slice(0, n)
      .filter((c) => c.status === 'approved')
      .map((c) => c.coid);
    return await this.loadCommentsBatch(coids);
  }

  // ---------- 浏览/点赞 ----------
  /** 调整计数（delta 可为负，结果不小于 0） */
  async adjustStat(cid, kind, delta) {
    const key = `stat:${kind}`;
    const map = (await this.kv.getJSON(key)) || {};
    map[cid] = Math.max(0, (map[cid] || 0) + delta);
    await this.kv.putJSON(key, map);
    return map[cid];
  }
  async incrStat(cid, kind) {
    return await this.adjustStat(cid, kind, 1);
  }
  /** 全站统计总和（仪表盘用） */
  async sumStat(kind) {
    const map = (await this.kv.getJSON(`stat:${kind}`)) || {};
    return Object.values(map).reduce((sum, value) => sum + (Number(value) || 0), 0);
  }
  async getStat(cid, kind) {
    const map = (await this.kv.getJSON(`stat:${kind}`)) || {};
    return map[cid] || 0;
  }

  // ---------- 会话 ----------
  async createSession(uid, ttl) {
    const { randomHex } = await import('./auth/password.js');
    const token = randomHex(32);
    await this.kv.putJSON(`sess:${token}`, { uid, exp: Date.now() + ttl * 1000 });
    return token;
  }
  async getSession(token) {
    if (!token) return null;
    const s = await this.kv.getJSON(`sess:${token}`);
    if (!s) return null;
    if (s.exp < Date.now()) {
      await this.kv.delete(`sess:${token}`);
      return null;
    }
    return s;
  }
  async deleteSession(token) {
    await this.kv.delete(`sess:${token}`);
  }

  /**
   * 密码文章解锁凭据 —— 形如管理端会话（pacc:<token> → { cid, exp }）。
   * 密码本身只在表单 POST 的请求体里出现一次，通过后换成 HttpOnly cookie，
   * 不会像 ?password= 那样进 URL、历史记录和访问日志。
   */
  async grantPostAccess(cid, token, exp) {
    await this.kv.putJSON(`pacc:${token}`, { cid, exp });
  }

  async getPostAccess(token) {
    if (!token) return null;
    const a = await this.kv.getJSON(`pacc:${token}`);
    if (!a) return null;
    if (a.exp < Date.now()) {
      await this.kv.delete(`pacc:${token}`);
      return null;
    }
    return a;
  }
}

/** 工厂：从 EdgeOne 请求上下文创建 Database */
export async function createDatabase(env) {
  const { getKV } = await import('./storage/kv.js');
  const kv = getKV(env);
  const blob = new BlobStorage(kv);
  // 附件存储初始化失败不能拖垮整个站点：降级为 KV 通道即可。
  // 未绑定 Blob 时 getStore 会抛 MISSING_ENVIRONMENT，这里兜住。
  try {
    await blob.init();
  } catch (e) {
    blob.mode = 'kv';
  }
  return new Database(kv, blob);
}

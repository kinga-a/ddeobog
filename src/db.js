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

export class Database {
  constructor(kv, blob) {
    this.kv = kv;
    this.blob = blob;
  }

  static async create(env) {
    // 避免循环依赖，kv.js 中 getKV 在 main 中已解析；这里接收 KV 实例
    throw new Error('use createDatabase(env)');
  }

  // ---------- 序列 ----------
  async nextId(seq) {
    const key = `seq:${seq}`;
    const cur = parseInt((await this.kv.get(key)) || '0', 10);
    const next = cur + 1;
    await this.kv.put(key, String(next));
    return next;
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
    const out = {};
    for (const k of keys) {
      const name = k.slice(4);
      out[name] = await this.kv.get(k, 'json');
    }
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
    const keys = await this.kv.listKeys('user:');
    const users = [];
    for (const k of keys) {
      if (k.startsWith('usern:') || k.startsWith('userm:')) continue;
      const u = await this.kv.getJSON(k);
      if (u) users.push(u);
    }
    users.sort((a, b) => a.uid - b.uid);
    return users;
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
    const idx = await this.#loadPostIndex();
    const i = idx.findIndex((e) => e.cid === cid);
    if (i >= 0) {
      idx[i] = this.#indexEntry(row);
      idx.sort((a, b) => b.created - a.created);
      await this.#savePostIndex(idx);
    }
    await this.#syncMetaCounts(row.categories, row.tags, oldCats, oldTags);
    return row;
  }

  async deleteContent(cid) {
    const row = await this.getContent(cid);
    if (!row) return false;
    await this.kv.delete(`post:${cid}`);
    const idx = await this.#loadPostIndex();
    const i = idx.findIndex((e) => e.cid === cid);
    if (i >= 0) {
      idx.splice(i, 1);
      await this.#savePostIndex(idx);
    }
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

  /**
   * 内容列表查询
   * @param {object} q type/status/page/pageSize/categoryMid/tagMid/keywords/order/year/month/authorId
   */
  async listContents(q = {}) {
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
      // 关键词搜索：索引中只有标题，正文需要读取文章行（个人博客规模可接受）
      const kw = String(keywords).toLowerCase();
      const matched = [];
      for (const e of list) {
        if (e.title.toLowerCase().includes(kw)) {
          matched.push(e);
          continue;
        }
        const row = await this.getContent(e.cid);
        if (row && row.text.toLowerCase().includes(kw)) matched.push(e);
      }
      list = matched;
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
    const items = [];
    for (const e of list.slice(start, start + pageSize)) {
      const row = await this.getContent(e.cid);
      if (row) items.push(row);
    }
    return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
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
    const idx = await this.#loadMetaIndex();
    const out = [];
    for (const m of idx) {
      if (type && m.type !== type) continue;
      out.push(await this.kv.getJSON(`meta:${m.mid}`));
    }
    out.sort((a, b) => (a.order || 0) - (b.order || 0));
    return out.filter(Boolean);
  }
  async getMeta(mid) {
    return await this.kv.getJSON(`meta:${mid}`);
  }
  async getMetaBySlug(slug, type) {
    const idx = await this.#loadMetaIndex();
    const hit = idx.find((m) => m.slug === slug && m.type === type);
    return hit ? await this.getMeta(hit.mid) : null;
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
    const idx = await this.#loadMetaIndex();
    const i = idx.findIndex((m) => m.mid === mid);
    if (i >= 0) {
      idx[i] = { mid, type: meta.type, slug: meta.slug };
      await this.kv.putJSON('idx:metas', idx);
    }
    return meta;
  }
  async deleteMeta(mid) {
    const meta = await this.getMeta(mid);
    if (!meta) return false;
    await this.kv.delete(`meta:${mid}`);
    const idx = await this.#loadMetaIndex();
    const i = idx.findIndex((m) => m.mid === mid);
    if (i >= 0) {
      idx.splice(i, 1);
      await this.kv.putJSON('idx:metas', idx);
    }
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
  /** 内容分类/标签变更后同步计数（全量重算，规模可接受） */
  async #syncMetaCounts(newCats = [], newTags = [], oldCats = [], oldTags = []) {
    const affected = new Set([...newCats, ...newTags, ...oldCats, ...oldTags]);
    if (!affected.size) return;
    const postIdx = await this.#loadPostIndex();
    const counts = {};
    for (const e of postIdx) {
      if (e.status !== 'publish') continue;
      for (const m of e.categories || []) counts[`c${m}`] = (counts[`c${m}`] || 0) + 1;
      for (const m of e.tags || []) counts[`t${m}`] = (counts[`t${m}`] || 0) + 1;
    }
    for (const mid of affected) {
      const meta = await this.getMeta(mid);
      if (meta) {
        meta.count = counts[`${meta.type === 'category' ? 'c' : 't'}${mid}`] || 0;
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
    const idx = await this.#loadPostIndex();
    const i = idx.findIndex((e) => e.cid === cid);
    if (i >= 0) {
      idx[i].commentsNum = row.commentsNum;
      await this.kv.putJSON('idx:posts', idx);
    }
  }
  async updateComment(coid, patch) {
    const row = await this.kv.getJSON(`cmt:${coid}`);
    if (!row) return null;
    const oldStatus = row.status;
    Object.assign(row, patch);
    await this.kv.putJSON(`cmt:${coid}`, row);
    const idx = await this.#loadCmtIndex();
    const i = idx.findIndex((c) => c.coid === coid);
    if (i >= 0) {
      idx[i].status = row.status;
      await this.kv.putJSON('idx:cmts', idx);
    }
    if (oldStatus !== row.status) {
      await this.#bumpCommentsNum(row.cid, row.status === 'approved' ? 1 : -1);
    }
    return row;
  }
  async deleteComment(coid) {
    const row = await this.kv.getJSON(`cmt:${coid}`);
    if (!row) return false;
    await this.kv.delete(`cmt:${coid}`);
    const idx = await this.#loadCmtIndex();
    const i = idx.findIndex((c) => c.coid === coid);
    if (i >= 0) {
      idx.splice(i, 1);
      await this.kv.putJSON('idx:cmts', idx);
    }
    if (row.status === 'approved') await this.#bumpCommentsNum(row.cid, -1);
    return true;
  }
  /** 某内容的已通过评论（含嵌套结构） */
  async listComments(cid) {
    const idx = await this.#loadCmtIndex();
    const rows = [];
    for (const c of idx) {
      if (c.cid === cid && c.status === 'approved') {
        const row = await this.kv.getJSON(`cmt:${c.coid}`);
        if (row) rows.push(row);
      }
    }
    rows.sort((a, b) => a.created - b.created);
    return rows;
  }
  /** 后台评论管理 */
  async listAllComments({ status, page = 1, pageSize = 20 }) {
    const idx = await this.#loadCmtIndex();
    let list = [...idx].sort((a, b) => b.created - a.created);
    if (status) list = list.filter((c) => c.status === status);
    const total = list.length;
    const items = [];
    for (const c of list.slice((page - 1) * pageSize, page * pageSize)) {
      const row = await this.kv.getJSON(`cmt:${c.coid}`);
      if (row) items.push(row);
    }
    return { items, total, page, pageSize };
  }
  async recentComments(n = 5) {
    const idx = await this.#loadCmtIndex();
    const list = [...idx].sort((a, b) => b.created - a.created).slice(0, n);
    const out = [];
    for (const c of list) {
      const row = await this.kv.getJSON(`cmt:${c.coid}`);
      if (row && row.status === 'approved') out.push(row);
    }
    return out;
  }

  // ---------- 浏览/点赞 ----------
  async incrStat(cid, kind) {
    const key = `stat:${kind}`;
    const map = (await this.kv.getJSON(key)) || {};
    map[cid] = (map[cid] || 0) + 1;
    await this.kv.putJSON(key, map);
    return map[cid];
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

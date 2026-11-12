/**
 * KV 存储封装 —— EdgeOne Pages KV
 * 绑定方式：控制台创建 KV 命名空间并绑定到项目，变量名 BLOG_KV（可在 src/config.js 修改）
 * 兼容两种访问形式：context.env.BLOG_KV 或全局变量 BLOG_KV
 */
import { CONFIG } from '../config.js';

export class KV {
  constructor(binding) {
    this.binding = binding;
    // 请求级读缓存：KV 实例随请求创建（main.js 每次 onRequest 都新建），
    // 同一请求内同一 key 只真正读一次——首页渲染会反复读文章/评论/分类索引
    // 与统计全表，没有这层缓存时每次都是整表重复读。写/删时同步更新缓存，
    // 保证同请求内读到自己刚写的数据；缓存存 Promise 以合并并发重复读。
    this._memo = new Map();
  }
  async get(key, type = 'text') {
    const memoKey = `${type}:${key}`;
    const hit = this._memo.get(memoKey);
    if (hit) return hit;
    const p = Promise.resolve().then(() => this.binding.get(key, { type }));
    this._memo.set(memoKey, p);
    p.catch(() => {
      if (this._memo.get(memoKey) === p) this._memo.delete(memoKey);
    });
    return p;
  }
  async getJSON(key) {
    return await this.get(key, 'json');
  }
  async put(key, value) {
    await this.binding.put(key, value);
    this._memo.set(`text:${key}`, Promise.resolve(value));
    this._memo.delete(`json:${key}`);
  }
  async putJSON(key, obj) {
    const text = JSON.stringify(obj);
    await this.binding.put(key, text);
    this._memo.set(`json:${key}`, Promise.resolve(obj));
    this._memo.set(`text:${key}`, Promise.resolve(text));
  }
  async delete(key) {
    await this.binding.delete(key);
    this._memo.delete(`text:${key}`);
    this._memo.delete(`json:${key}`);
  }

  /** 批量获取多个 key（并行） */
  async getBatch(keys) {
    if (!keys.length) return new Map();
    const results = await Promise.all(keys.map((k) => this.getJSON(k)));
    const map = new Map();
    keys.forEach((k, i) => map.set(k, results[i]));
    return map;
  }

  /** 批量写入多个 key（并行） */
  async putBatch(entries) {
    if (!entries.length) return;
    await Promise.all(entries.map(([k, v]) => this.putJSON(k, v)));
  }

  /** 批量删除多个 key（并行） */
  async deleteBatch(keys) {
    if (!keys.length) return;
    await Promise.all(keys.map((k) => this.delete(k)));
  }

  /** 前缀遍历所有 key（自动翻页，平台限制单页最大 256） */
  async listKeys(prefix = '', limit = 10000) {
    const out = [];
    let cursor;
    let complete = false;
    while (!complete && out.length < limit) {
      // EdgeOne KV 单页 limit 最大 256
      const pageLimit = Math.min(256, limit - out.length);
      const opts = { prefix, limit: pageLimit };
      if (cursor) opts.cursor = cursor;
      const res = await this.binding.list(opts);
      if (!res) break;
      for (const k of res.keys || []) out.push(k.key);
      complete = res.complete !== false;
      cursor = res.cursor;
      if (complete || !cursor) break;
    }
    return out;
  }
}

/** 从请求上下文中解析 KV 绑定 */
export function getKV(env) {
  const name = CONFIG.KV_BINDING;
  let binding = null;
  if (env) {
    binding = env[name] || env[name.toLowerCase()] || null;
  }
  if (!binding && typeof globalThis !== 'undefined') {
    binding = globalThis[name] || null;
  }
  if (!binding) {
    throw new Error(
      `[5iblog] 未找到 KV 绑定 "${name}"。请在 EdgeOne 控制台创建 KV 命名空间并以变量名 "${name}" 绑定到本项目。`
    );
  }
  return new KV(binding);
}

/**
 * KV 存储封装 —— EdgeOne Pages KV
 * 绑定方式：控制台创建 KV 命名空间并绑定到项目，变量名 BLOG_KV（可在 src/config.js 修改）
 * 兼容两种访问形式：context.env.BLOG_KV 或全局变量 BLOG_KV
 */
import { CONFIG } from '../config.js';

export class KV {
  constructor(binding) {
    this.binding = binding;
  }
  async get(key, type = 'text') {
    return await this.binding.get(key, { type });
  }
  async getJSON(key) {
    return await this.binding.get(key, { type: 'json' });
  }
  async put(key, value) {
    await this.binding.put(key, value);
  }
  async putJSON(key, obj) {
    await this.binding.put(key, JSON.stringify(obj));
  }
  async delete(key) {
    await this.binding.delete(key);
  }
  /** 前缀遍历所有 key（自动翻页） */
  async listKeys(prefix = '', limit = 10000) {
    const out = [];
    let cursor;
    let complete = false;
    while (!complete && out.length < limit) {
      // cursor 必须是 string 或干脆不传：平台实现对 undefined 做严格类型校验，
      // 首次分页传 cursor: undefined 会抛 "cursor type invalid. expect: 'string'"。
      const opts = { prefix, limit: 256 };
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
      `[TypechoEdge] 未找到 KV 绑定 "${name}"。请在 EdgeOne 控制台创建 KV 命名空间并以变量名 "${name}" 绑定到本项目。`
    );
  }
  return new KV(binding);
}

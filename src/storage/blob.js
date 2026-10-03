/**
 * Blob 存储封装 —— 用于附件（上传的图片/文件）
 * 优先使用 @edgeone/pages-blob SDK；运行时不可用时自动降级为 KV 存储（value ≤ 25MB）。
 *
 * 注意：SDK 采用惰性引用（getStoreRef），不能写成模块顶层的动态 import()。
 * Edge Functions 的 iife 输出格式不支持 top-level await，顶层 await 会让
 * esbuild 打包失败、平台判定"No server-handler detected"而部署成纯静态站点。
 */
import { CONFIG } from '../config.js';

let blobStorePromise = null;

/**
 * 惰性取得 blob SDK 的 getStore 函数。
 * 用回调包装而非顶层 await：init() 是 async，await 发生在函数体内而非模块顶层。
 */
const getStoreRef = () => import('@edgeone/pages-blob');

/**
 * 取得 Blob store，任何异常都降级为 null（走 KV 通道）。
 *
 * 注意两点：
 * 1. getStore() 在未配置 Blob 时会**同步**抛出 MISSING_ENVIRONMENT，
 *    必须在 try 内调用；
 * 2. promise 被 reject 后必须清空缓存，否则这个失败会被永久记忆下来，
 *    后续所有请求都直接失败 —— 站点会在配置就绪后仍然一直报错。
 */
async function getBlobStore() {
  if (!blobStorePromise) {
    blobStorePromise = (async () => {
      try {
        const mod = await getStoreRef();
        const getStore = mod.getStore || mod.default?.getStore;
        if (getStore) return getStore(CONFIG.BLOB_STORE);
      } catch (e) {
        // SDK 不可用 / Blob 未绑定（MISSING_ENVIRONMENT）等，降级到 KV
      }
      return null;
    })().catch(() => null);
  }
  try {
    return await blobStorePromise;
  } catch (e) {
    blobStorePromise = null;
    return null;
  }
}

/**
 * content-type 兜底表。
 *
 * Blob 模式下二进制要靠 store.get(key, {type:'arrayBuffer'}) 读，那条路拿不到
 * 响应头，所以正常靠 KV 里那条 file:meta: 记录；老附件（meta 缺失）或
 * KV 兜底通道才按扩展名猜。
 */
const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
  svg: 'image/svg+xml', pdf: 'application/pdf', zip: 'application/zip',
  txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8',
  json: 'application/json', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg',
};

const guessMime = (key) => {
  const m = /\.([a-z0-9]+)$/i.exec(String(key || ''));
  return (m && MIME_BY_EXT[m[1].toLowerCase()]) || 'application/octet-stream';
};

export class BlobStorage {
  constructor(kv) {
    this.kv = kv; // KV 降级通道
    this.mode = 'init';
  }

  async init() {
    const store = await getBlobStore();
    if (store) {
      this.store = store;
      this.mode = 'blob';
    } else {
      this.mode = 'kv';
    }
    return this.mode;
  }

  /** 写入文件，返回 { key, mode } */
  async set(key, data, contentType) {
    if (this.mode === 'blob') {
      await this.store.set(key, data);
      // 二进制读取拿不到响应头，content-type 得另存一份
      await this.kv.putJSON(`file:meta:${key}`, {
        contentType: contentType || guessMime(key),
        size: data && data.byteLength ? data.byteLength : 0,
      });
      return { key, mode: 'blob' };
    }
    // KV 降级：存 base64
    let b64;
    if (typeof data === 'string') {
      b64 = btoa(unescape(encodeURIComponent(data)));
    } else if (data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(data);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      b64 = btoa(bin);
    } else {
      throw new Error('unsupported data type');
    }
    await this.kv.putJSON(`file:data:${key}`, {
      b64,
      contentType: contentType || 'application/octet-stream',
    });
    return { key, mode: 'kv' };
  }

  /** 读取文件，返回 { body: ArrayBuffer, contentType } 或 null */
  async get(key) {
    if (this.mode === 'blob') {
      try {
        // 注意：不能用 store.getWithHeaders()——它内部是
        // `new TextDecoder("utf-8").decode(s.body)`，把二进制字节毁成字符串，
        // 图片读出来就是一坨乱码。取 body 必须用 arrayBuffer（原始字节）。
        const buf = await this.store.get(key, { type: 'arrayBuffer' });
        if (!buf) return null;
        const meta = await this.kv.getJSON(`file:meta:${key}`);
        return {
          body: buf,
          contentType: (meta && meta.contentType) || guessMime(key),
        };
      } catch (e) {
        return null;
      }
    }
    const meta = await this.kv.getJSON(`file:data:${key}`);
    if (!meta) return null;
    const bin = atob(meta.b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { body: bytes.buffer, contentType: meta.contentType };
  }

  async delete(key) {
    if (this.mode === 'blob') {
      await this.store.delete(key);
    } else {
      await this.kv.delete(`file:data:${key}`);
    }
    await this.kv.delete(`file:meta:${key}`);
  }
}

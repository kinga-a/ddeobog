/**
 * SQLite 存储后端 —— 本地部署用
 *
 * 目标：不改动 Database / 控制器 / 渲染层，只把 EdgeOne KV + Blob 的运行时能力
 * 换成单个 SQLite 文件，从而脱离边缘平台在 Node 上直接运行。
 *
 * 表结构（schema version 1）：
 *   kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER)
 *      与 EdgeOne KV 一一对应；业务侧所有键（opt:/user:/post:/idx:/stat:/sess:/snap:…）
 *      原样落在这里，因此备份、回收站、快照等既有逻辑无需改动。
 *   blobs(key TEXT PRIMARY KEY, data BLOB, content_type TEXT, size INTEGER, created_at INTEGER)
 *      附件二进制；对应的 file:meta:<key> 仍写入 kv，与平台 Blob 模式保持一致，
 *      后台附件统计与导出备份元数据照常工作。
 *
 * 运行时要求：Node.js >= 22.5，并带 --experimental-sqlite（22.11 起仍为实验特性）。
 * 不引入 better-sqlite3 等原生依赖，Docker 构建无需编译工具链。
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { guessMime } from './blob.js';

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS blobs (
  key          TEXT PRIMARY KEY,
  data         BLOB NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size         INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
) WITHOUT ROWID;
`;

/** 把 string / ArrayBuffer / TypedArray 统一成 Uint8Array，供 BLOB 绑定 */
function toBytes(data) {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new Error('SQLite Blob 只接受 string / ArrayBuffer / TypedArray');
}

/** 复制成独立的 ArrayBuffer（node:sqlite 返回的 Uint8Array 可能带共享 buffer） */
function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** EdgeOne KV 的 binding 契约，SQLite 实现 */
export class SqliteBinding {
  constructor(db) {
    this.db = db;
    this.sql = {
      get: db.prepare('SELECT value FROM kv WHERE key = ?'),
      put: db.prepare(
        `INSERT INTO kv(key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ),
      del: db.prepare('DELETE FROM kv WHERE key = ?'),
      listPrefix: db.prepare(
        'SELECT key FROM kv WHERE key >= ? AND key < ? ORDER BY key LIMIT ? OFFSET ?'
      ),
      listAll: db.prepare('SELECT key FROM kv ORDER BY key LIMIT ? OFFSET ?'),
    };
  }

  async get(key, type = 'text') {
    const mode = typeof type === 'string' ? type : type?.type || 'text';
    const row = this.sql.get.get(String(key));
    if (!row) return null;
    if (mode === 'json' || mode === 'array') {
      try {
        return JSON.parse(row.value);
      } catch {
        return null;
      }
    }
    if (mode === 'arrayBuffer') return new TextEncoder().encode(row.value).buffer;
    return row.value;
  }

  async put(key, value) {
    this.sql.put.run(String(key), typeof value === 'string' ? value : String(value), Date.now());
  }

  async delete(key) {
    this.sql.del.run(String(key));
  }

  /**
   * 前缀列举。返回结构与 EdgeOne KV 一致：
   *   { keys: [{ key, name }], complete, cursor }
   * cursor 使用数字偏移量；KV 包装层会自动翻页。
   */
  async list({ prefix = '', limit = 1000, cursor = null } = {}) {
    const size = Math.max(1, Math.min(1000, Number(limit) || 1000));
    const offset = cursor == null || cursor === '' ? 0 : Math.max(0, Number(cursor) || 0);
    const rows = prefix
      ? this.sql.listPrefix.all(prefix, prefix + '\uffff', size + 1, offset)
      : this.sql.listAll.all(size + 1, offset);
    const complete = rows.length <= size;
    return {
      keys: rows.slice(0, size).map((r) => ({ key: r.key, name: r.key })),
      complete,
      cursor: complete ? null : String(offset + size),
    };
  }
}

/** 附件存储：接口与 src/storage/blob.js 的 BlobStorage 对齐 */
export class SqliteBlobStorage {
  constructor(store, kv) {
    this.store = store;
    this.kv = kv;
    this.mode = 'sqlite';
  }

  async init() {
    return this.mode;
  }

  async set(key, data, contentType) {
    const bytes = toBytes(data);
    const mime = contentType || guessMime(key);
    this.store.putBlob(key, bytes, mime);
    // 与平台 Blob 模式一致：content-type / 大小另存一条元数据
    await this.kv.putJSON(`file:meta:${key}`, { contentType: mime, size: bytes.byteLength });
    return { key, mode: this.mode };
  }

  async get(key) {
    const row = this.store.getBlob(key);
    if (!row) return null;
    return {
      body: toArrayBuffer(row.data),
      contentType: row.content_type || guessMime(key),
    };
  }

  async delete(key) {
    this.store.deleteBlob(key);
    await this.kv.delete(`file:meta:${key}`);
  }
}

/** SQLite 句柄：持有一个长期连接，所有请求共享（DatabaseSync 为同步 API） */
export class SqliteStore {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.closed = false;
    this.binding = new SqliteBinding(db);
    this.blobs = {
      put: db.prepare(
        `INSERT INTO blobs(key, data, content_type, size, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET data = excluded.data, content_type = excluded.content_type,
           size = excluded.size, created_at = excluded.created_at`
      ),
      get: db.prepare('SELECT data, content_type, size FROM blobs WHERE key = ?'),
      del: db.prepare('DELETE FROM blobs WHERE key = ?'),
    };
  }

  putBlob(key, bytes, contentType) {
    this.blobs.put.run(String(key), bytes, contentType, bytes.byteLength, Date.now());
  }

  getBlob(key) {
    return this.blobs.get.get(String(key)) || null;
  }

  deleteBlob(key) {
    this.blobs.del.run(String(key));
  }

  /** 关闭前把 WAL 合并回主文件，便于直接复制 .sqlite 做备份 */
  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      /* 只读或已关闭时忽略 */
    }
    this.db.close();
  }
}

/**
 * 打开（并按需创建）SQLite 数据库。
 * @param {{path?: string, memory?: boolean}} [options]
 */
export function openSqliteStore({ path = 'data/blog.sqlite', memory = false } = {}) {
  const file = memory ? ':memory:' : resolve(path);
  if (!memory) mkdirSync(dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);

  const current = Number(db.prepare('PRAGMA user_version').get()?.user_version || 0);
  if (current > SCHEMA_VERSION) {
    throw new Error(`数据库 schema 版本 ${current} 高于当前代码支持的 ${SCHEMA_VERSION}`);
  }
  if (current < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);

  return new SqliteStore(db, file);
}
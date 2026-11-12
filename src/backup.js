/**
 * 站点备份 / 恢复
 *
 * 备份内容 = KV 中与站点内容相关的键值（文章、页面、分类、标签、评论、索引、
 * 统计、附件元数据、站点配置、用户）。会话、登录限流、WebDAV 凭据不进入备份，
 * 避免把旧登录态或第三方密码带到别的环境。
 *
 * 附件二进制在 Blob / KV 中，体积可能远超边缘函数的请求与内存上限，
 * 因此只备份 `file:meta:*` 元数据，恢复后附件记录仍在，二进制需另行迁移。
 */
import { CONFIG } from './config.js';

export const BACKUP_FORMAT = '5iblog-backup';
export const BACKUP_VERSION = 1;
/** 兼容旧版本备份（主题迁移前） */
const LEGACY_BACKUP_FORMATS = new Set(['typecho-edge-backup']);

/** 参与备份的键前缀 */
export const BACKUP_PREFIXES = [
  'opt:',
  'user:',
  'usern:',
  'userm:',
  'post:',
  'meta:',
  'cmt:',
  'idx:',
  'stat:',
  'file:meta:',
];

/** 单个导出/导入批次大小，避免一次并发打满平台限制 */
const BATCH = 40;

/** 明确排除的键（第三方凭据、WebDAV 密码） */
const EXCLUDED_KEYS = new Set(['opt:backup:webdav']);

export function isBackupKey(key) {
  if (typeof key !== 'string' || EXCLUDED_KEYS.has(key)) return false;
  return BACKUP_PREFIXES.some((p) => key.startsWith(p));
}

/** 读取一组键，尽力把 JSON 解析回对象；解析失败保留原始字符串 */
async function readValues(kv, keys) {
  const out = {};
  for (let i = 0; i < keys.length; i += BATCH) {
    const chunk = keys.slice(i, i + BATCH);
    const values = await Promise.all(
      chunk.map(async (key) => {
        try {
          return [key, await kv.get(key, 'text')];
        } catch {
          return [key, null];
        }
      })
    );
    for (const [key, raw] of values) {
      if (raw === null || raw === undefined) continue;
      try {
        out[key] = JSON.parse(raw);
      } catch {
        out[key] = raw;
      }
    }
  }
  return out;
}

/**
 * 生成备份对象。
 * @param {any} db
 * @param {{title?: string, description?: string, primaryUrl?: string}} [meta]
 */
export async function exportBackup(db, meta = {}) {
  const allKeys = await db.kv.listKeys();
  const keys = allKeys.filter(isBackupKey).sort();
  const data = await readValues(db.kv, keys);

  const posts = Object.keys(data).filter((k) => k.startsWith('post:')).length;
  const pages = Object.entries(data).filter(([k, v]) => k.startsWith('post:') && v && v.type === 'page').length;
  const comments = Object.keys(data).filter((k) => k.startsWith('cmt:')).length;
  const attachments = Object.keys(data).filter((k) => k.startsWith('file:meta:')).length;

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: Math.floor(Date.now() / 1000),
    app: { name: '5iblog', version: CONFIG.VERSION },
    site: {
      title: meta.title || '',
      description: meta.description || '',
      url: meta.primaryUrl || '',
    },
    counts: { keys: keys.length, posts, pages, comments, attachments },
    data,
  };
}

/** 校验备份对象，返回版本号 */
export function validateBackup(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('备份文件不是合法的 JSON 对象');
  }
  if (obj.format !== BACKUP_FORMAT && !LEGACY_BACKUP_FORMATS.has(obj.format)) {
    throw new Error('不是 5iblog 的备份文件（format 不匹配）');
  }
  const version = Number(obj.version);
  if (!Number.isFinite(version) || version < 1) {
    throw new Error('备份文件缺少有效的 version');
  }
  if (version > BACKUP_VERSION) {
    throw new Error(`备份版本 v${version} 高于当前支持的 v${BACKUP_VERSION}`);
  }
  if (!obj.data || typeof obj.data !== 'object' || Array.isArray(obj.data)) {
    throw new Error('备份文件缺少 data 内容');
  }
  return version;
}

/** 统计备份里会被采用的有效键 */
export function countBackupEntries(obj) {
  return Object.keys(obj.data || {}).filter(isBackupKey).length;
}

/**
 * 导入备份。
 * - merge：写入备份中的键，保留备份之外的数据（默认）
 * - replace：先删除现有内容键再写入，等价于整站还原
 *
 * @param {any} db
 * @param {any} obj 备份对象
 * @param {{mode?: 'merge'|'replace'}} [options]
 */
export async function importBackup(db, obj, { mode = 'merge' } = {}) {
  validateBackup(obj);

  const entries = Object.entries(obj.data).filter(([k]) => isBackupKey(k));
  if (!entries.length) throw new Error('备份文件里没有可恢复的数据');

  if (mode === 'replace') {
    const existing = (await db.kv.listKeys()).filter(isBackupKey);
    for (let i = 0; i < existing.length; i += BATCH) {
      await db.kv.deleteBatch(existing.slice(i, i + BATCH));
    }
  }

  let written = 0;
  for (let i = 0; i < entries.length; i += BATCH) {
    const chunk = entries.slice(i, i + BATCH);
    await Promise.all(
      chunk.map(([key, value]) =>
        typeof value === 'string' ? db.kv.put(key, value) : db.kv.putJSON(key, value)
      )
    );
    written += chunk.length;
  }

  return { written, mode };
}

/** 备份文件名：5iblog-20261108-224500.json */
export function backupFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `5iblog-${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}.json`
  );
}
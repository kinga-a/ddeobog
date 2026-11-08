/**
 * 极简 WebDAV 客户端 —— 只做备份需要的 4 个动词：MKCOL / PUT / GET / PROPFIND
 *
 * 运行在边缘函数里，不引第三方库：
 * - 认证固定 Basic（WebDAV 生态最通用的方式）
 * - XML 用正则解析（只读，不参与业务逻辑）
 * - 所有请求带超时，避免拖动整个函数执行时间
 */
const DEFAULT_TIMEOUT = 25000;

/** UTF-8 安全的 base64（btoa 只接受 latin1） */
function base64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** 去掉首尾斜杠，允许留空表示根目录 */
function normalizeDir(dir) {
  return String(dir || '').trim().replace(/^\/+|\/+$/g, '');
}

/** 规范化并校验 WebDAV 配置 */
export function normalizeConfig(input = {}) {
  const url = String(input.url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('WebDAV 地址必须以 http:// 或 https:// 开头');
  }
  const dir = normalizeDir(input.dir);
  const keep = Math.min(50, Math.max(1, parseInt(input.keep, 10) || 10));
  return {
    url,
    username: String(input.username || '').trim(),
    password: String(input.password || ''),
    backupPassword: String(input.backupPassword || ''),
    dir,
    keep,
  };
}

/** 备份文件名只允许安全字符，禁止路径穿越 */
export function safeFileName(name) {
  const base = String(name || '').trim().split('/').pop();
  if (!base || base === '.' || base === '..' || base.includes('..')) {
    throw new Error('备份文件名不合法');
  }
  if (!/^[\w.\-]+$/.test(base)) {
    throw new Error('备份文件名只能包含字母、数字、点、下划线和短横线');
  }
  return base;
}

/** 目录内的文件地址；name 为空时返回目录地址（带尾斜杠） */
export function davUrl(cfg, name = '') {
  const segments = cfg.dir ? cfg.dir.split('/').filter(Boolean) : [];
  if (name) segments.push(safeFileName(name));
  if (!segments.length) return `${cfg.url}/`;
  const path = segments.map((p) => encodeURIComponent(p)).join('/');
  return `${cfg.url}/${path}${name ? '' : '/'}`;
}

/** MKCOL 用的相对地址（相对站点根，不含 cfg.dir） */
function collectionUrl(cfg, relPath) {
  const segments = String(relPath || '').split('/').filter(Boolean);
  if (!segments.length) return `${cfg.url}/`;
  return `${cfg.url}/${segments.map((p) => encodeURIComponent(p)).join('/')}`;
}

function authHeader(cfg) {
  if (!cfg.username && !cfg.password) return {};
  return { Authorization: `Basic ${base64Utf8(`${cfg.username}:${cfg.password}`)}` };
}

async function request(cfg, method, name = '', { body, headers = {}, timeout = DEFAULT_TIMEOUT, collection = '' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(collection ? collectionUrl(cfg, collection) : davUrl(cfg, name), {
      method,
      body,
      headers: { ...authHeader(cfg), ...headers },
      signal: controller.signal,
      redirect: 'follow',
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('WebDAV 请求超时');
    throw new Error(`WebDAV 请求失败：${e && e.message ? e.message : e}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 递归创建目录（逐级 MKCOL，已存在返回 405 视为成功） */
export async function ensureDir(cfg) {
  if (!cfg.dir) return;
  const segments = cfg.dir.split('/').filter(Boolean);
  let current = '';
  for (const seg of segments) {
    current = current ? `${current}/${seg}` : seg;
    const res = await request(cfg, 'MKCOL', '', { collection: current });
    // 201 新建成功；405 已存在；301/302 部分服务端会重定向到带斜杠地址
    if (![201, 204, 301, 302, 405].includes(res.status)) {
      throw new Error(`创建 WebDAV 目录失败（HTTP ${res.status}）`);
    }
  }
}

const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:propfind xmlns:d="DAV:"><d:prop>' +
  '<d:displayname/><d:getcontentlength/><d:getlastmodified/><d:resourcetype/>' +
  '</d:prop></d:propfind>';

/** 从 PROPFIND 响应里提取文件项（只保留 .json 备份） */
export function parsePropfind(xml, cfg) {
  const files = [];
  const blocks = xml.match(/<(?:[\w-]+:)?response\b[\s\S]*?<\/(?:[\w-]+:)?response>/gi) || [];
  const dirNames = cfg.dir ? cfg.dir.split('/').filter(Boolean).length : 0;

  for (const block of blocks) {
    const hrefMatch = block.match(/<(?:[\w-]+:)?href>([^<]+)<\/(?:[\w-]+:)?href>/i);
    if (!hrefMatch) continue;
    let href = hrefMatch[1].trim();
    try {
      href = decodeURIComponent(href);
    } catch {
      // 保留原样
    }
    const isCollection = /<(?:[\w-]+:)?collection\s*\/?>/i.test(block);
    if (isCollection || href.endsWith('/')) continue;

    const segments = href.split('/').filter(Boolean);
    if (segments.length <= dirNames) continue; // 目录自身
    const name = segments[segments.length - 1];
    if (!/\.json$/i.test(name)) continue;

    const sizeMatch = block.match(/<(?:[\w-]+:)?getcontentlength>(\d+)</i);
    const modMatch = block.match(/<(?:[\w-]+:)?getlastmodified>([^<]+)</i);
    files.push({
      name,
      size: sizeMatch ? parseInt(sizeMatch[1], 10) : 0,
      modified: modMatch ? modMatch[1] : '',
    });
  }

  files.sort((a, b) => (a.name < b.name ? 1 : -1));
  return files;
}

/** 列出备份文件；目录不存在时返回空数组 */
export async function listBackups(cfg) {
  const res = await request(cfg, 'PROPFIND', '', {
    headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body: PROPFIND_BODY,
  });
  if (res.status === 404) return [];
  if (res.status === 401) throw new Error('WebDAV 认证失败（用户名或密码错误）');
  if (!res.ok && res.status !== 207) throw new Error(`WebDAV 列目录失败（HTTP ${res.status}）`);
  const xml = await res.text();
  return parsePropfind(xml, cfg);
}

/** 上传备份，返回文件名 */
export async function putBackup(cfg, name, content) {
  const fileName = safeFileName(name);
  await ensureDir(cfg);
  const res = await request(cfg, 'PUT', fileName, {
    body: content,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    timeout: 45000,
  });
  if (![200, 201, 204].includes(res.status)) {
    throw new Error(`上传备份失败（HTTP ${res.status}）`);
  }
  return fileName;
}

/** 下载备份并解析为对象 */
export async function getBackup(cfg, name) {
  const res = await request(cfg, 'GET', safeFileName(name), { timeout: 45000 });
  if (res.status === 404) throw new Error('WebDAV 上找不到该备份文件');
  if (!res.ok) throw new Error(`下载备份失败（HTTP ${res.status}）`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('备份文件不是合法 JSON');
  }
}

/** 删除备份 */
export async function deleteBackup(cfg, name) {
  const res = await request(cfg, 'DELETE', safeFileName(name));
  if (![200, 204, 404].includes(res.status)) {
    throw new Error(`删除备份失败（HTTP ${res.status}）`);
  }
}

/**
 * 连接测试：目录存在则直接通过；不存在则自动创建（备份目录由工具管理，
 * 首次测试时顺手建出来，免得用户还要去网盘里手动新建）。
 */
export async function testConnection(cfg) {
  const res = await request(cfg, 'PROPFIND', '', {
    headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
    body: PROPFIND_BODY,
  });
  if (res.status === 401) throw new Error('认证失败（用户名或密码错误）');
  if (res.status === 404) {
    await ensureDir(cfg);
    return { created: true };
  }
  if (!res.ok && res.status !== 207) {
    throw new Error(`连接失败（HTTP ${res.status}），请检查地址、目录权限与证书`);
  }
  return { created: false };
}
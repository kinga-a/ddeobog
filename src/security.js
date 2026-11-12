/**
 * 应用层安全加固 —— 评论防护、安全响应头、可选后台 IP 白名单
 *
 * 只依赖 db.kv 与标准 Web API，EdgeOne KV 与本地 SQLite 两条部署路径通用。
 * 设计文档：docs/superpowers/specs/2026-11-11-blog-security-hardening-design.md
 *
 * 失败策略：防护组件读取失败一律放行（fail-open），避免 KV 故障时正常访客
 * 无法评论；记录类写入失败静默吞掉，不影响主流程。
 */

const DEFAULTS = Object.freeze({
  rateLimit: 5,
  rateWindow: 600,
  dupWindow: 600,
});

export const SECURITY_DEFAULTS = DEFAULTS;
export const SECURITY_EVENTS_KEY = 'sec:events';
export const SECURITY_EVENTS_LIMIT = 100;

const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "img-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/**
 * 读取配置：优先 context.env（EdgeOne 绑定），回退 process.env（本地）。
 * 不缓存整份配置——EdgeOne 的 env 按请求注入，模块级缓存首个请求会吞掉
 * 后续绑定；解析只是几次字符串比较，开销可忽略。
 */
export function readSecurityConfig(env) {
  return {
    rateLimit: boundedInt(envValue(env, 'COMMENT_RATE_LIMIT'), DEFAULTS.rateLimit, 1, 100),
    rateWindow: boundedInt(envValue(env, 'COMMENT_RATE_WINDOW'), DEFAULTS.rateWindow, 60, 86400),
    dupWindow: boundedInt(envValue(env, 'COMMENT_DUP_WINDOW'), DEFAULTS.dupWindow, 60, 86400),
    allowIps: envValue(env, 'ADMIN_ALLOW_IPS')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    trustProxy: envValue(env, 'ADMIN_TRUST_PROXY') === '1',
  };
}

function envValue(env, key) {
  if (env && env[key] !== undefined && env[key] !== null && env[key] !== '') return String(env[key]);
  const fromProcess = globalThis.process?.env?.[key];
  return fromProcess === undefined ? '' : String(fromProcess);
}

function boundedInt(raw, fallback, min, max) {
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** 非加密短哈希：仅用于事件展示与键脱敏，不参与安全判断 */
export function shortHash(value, size = 8) {
  let h = 5381;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0').slice(0, size);
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function cleanIp(value) {
  return String(value || '')
    .split(',')[0]
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/^::ffff:/i, '');
}

/**
 * 客户端 IP：
 * - 默认只信任 X-Real-IP（本地 server.mjs 会写入真实 socket 地址）；
 * - ADMIN_TRUST_PROXY=1 时才读取 X-Forwarded-For / CF-Connecting-IP，
 *   对应 EdgeOne 线上或反代部署。
 */
export function resolveClientIp(request, config = {}) {
  if (config.trustProxy) {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) return cleanIp(forwarded);
    const cf = request.headers.get('cf-connecting-ip');
    if (cf) return cleanIp(cf);
  }
  return cleanIp(request.headers.get('x-real-ip'));
}

/** 评论表单蜜罐：正常用户看不到也不会填写 */
export function hasHoneypotValue(form) {
  return String(form?.get?.('hp_site') || '').trim().length > 0;
}

/** 评论身份键：cid + IP + 邮箱 + UA 的 SHA-256 前 16 位，不落原始值 */
export async function commentIdentity({ cid, request, mail, config }) {
  const ip = resolveClientIp(request, config);
  const ua = request.headers.get('user-agent') || '';
  return (await sha256Hex(`${cid}\n${ip}\n${String(mail || '').toLowerCase()}\n${ua}`)).slice(0, 16);
}

/** 内容去重：cid + 邮箱 + 正文，窗口内命中则不写库 */
export async function checkCommentDuplicate(db, { cid, mail, text, config }) {
  const digest = await sha256Hex(`${cid}\n${String(mail || '').toLowerCase()}\n${text}`);
  const key = `cmt_dup:${digest.slice(0, 16)}`;
  try {
    const at = Number(await db.kv.get(key)) || 0;
    if (at && Date.now() - at < config.dupWindow * 1000) return { key, duplicate: true };
    return { key, duplicate: false };
  } catch {
    return { key, duplicate: false };
  }
}

export async function markCommentDuplicate(db, key) {
  if (!key) return;
  try {
    await db.kv.put(key, String(Date.now()));
  } catch {
    /* 记录失败不影响评论 */
  }
}

/** 频率限制：固定窗口计数，窗口外自动重置 */
export async function checkCommentRate(db, identity, config) {
  const key = `cmt_rate:${identity}`;
  try {
    const rec = await db.kv.getJSON(key);
    const now = Date.now();
    const windowMs = config.rateWindow * 1000;
    if (!rec || !rec.at || now - Number(rec.at) > windowMs) return { key, limited: false, retryAfter: 0 };
    if ((Number(rec.count) || 0) >= config.rateLimit) {
      return {
        key,
        limited: true,
        retryAfter: Math.max(60, Math.ceil((Number(rec.at) + windowMs - now) / 1000)),
      };
    }
    return { key, limited: false, retryAfter: 0 };
  } catch {
    return { key, limited: false, retryAfter: 0 };
  }
}

export async function bumpCommentRate(db, key, config) {
  if (!key) return;
  try {
    const now = Date.now();
    const windowMs = config.rateWindow * 1000;
    const rec = await db.kv.getJSON(key);
    const fresh = rec && rec.at && now - Number(rec.at) <= windowMs;
    await db.kv.putJSON(key, {
      count: fresh ? (Number(rec.count) || 0) + 1 : 1,
      at: fresh ? Number(rec.at) : now,
    });
  } catch {
    /* 计数失败不影响评论 */
  }
}

/** 拦截事件：最多 100 条，新事件在前，不存原始 IP / 邮箱 / UA */
export async function recordSecurityEvent(db, { type, cid = 0, request, mail = '', config = {} }) {
  try {
    const stored = await db.kv.getJSON(SECURITY_EVENTS_KEY);
    const events = Array.isArray(stored) ? stored : [];
    events.unshift({
      type,
      at: Date.now(),
      cid: Number(cid) || 0,
      ipHash: shortHash(resolveClientIp(request, config)),
      uaHash: shortHash(request.headers.get('user-agent') || ''),
      mailHash: shortHash(String(mail || '').toLowerCase()),
    });
    await db.kv.putJSON(SECURITY_EVENTS_KEY, events.slice(0, SECURITY_EVENTS_LIMIT));
  } catch {
    /* 事件写入失败不阻断评论 */
  }
}

export async function listSecurityEvents(db) {
  try {
    const events = await db.kv.getJSON(SECURITY_EVENTS_KEY);
    return Array.isArray(events) ? events.slice(0, SECURITY_EVENTS_LIMIT) : [];
  } catch {
    return [];
  }
}

export async function clearSecurityEvents(db) {
  try {
    await db.kv.delete(SECURITY_EVENTS_KEY);
  } catch {
    /* 清空失败由后台提示兜底 */
  }
}

function setSecurityHeaders(headers) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  const contentType = headers.get('Content-Type') || '';
  if (/text\/html/i.test(contentType)) {
    headers.set('X-Frame-Options', 'SAMEORIGIN');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    headers.set('Content-Security-Policy-Report-Only', CSP_REPORT_ONLY);
  }
}

/**
 * 给任意 Response 补安全头。
 * Response.redirect / fetch 返回的 Response 头是 immutable，直接 set 会抛错；
 * 此时复制头再新建 Response（保留状态码与 body 流）。
 */
export function applySecurityHeaders(response) {
  try {
    setSecurityHeaders(response.headers);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    setSecurityHeaders(headers);
    const body = response.status === 204 || response.status === 304 ? null : response.body;
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

export function isAdminPath(pathname) {
  return (
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/mcp' ||
    pathname === '/mcp/'
  );
}

/** 白名单匹配：支持精确 IP、1.2.3.* 前缀、* 全放行 */
export function isIpAllowed(ip, allowIps = []) {
  if (!allowIps.length) return true;
  const value = String(ip || '');
  for (const pattern of allowIps) {
    if (pattern === '*') return true;
    if (pattern.endsWith('*')) {
      if (value.startsWith(pattern.slice(0, -1))) return true;
    } else if (pattern === value) {
      return true;
    }
  }
  return false;
}

export function checkAdminAllowList(request, config) {
  if (!config.allowIps.length) return { allowed: true, ip: '' };
  const ip = resolveClientIp(request, config);
  return { allowed: isIpAllowed(ip, config.allowIps), ip };
}
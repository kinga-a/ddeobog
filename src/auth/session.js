/**
 * 会话管理 —— Cookie + KV Session
 */
import { CONFIG } from '../config.js';

export function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

export function sessionCookie(token, maxAge = CONFIG.SESSION_TTL) {
  return `${CONFIG.SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${'; Secure'}`;
}

export function clearSessionCookie() {
  return `${CONFIG.SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** 从请求解析当前登录用户，返回 { user, session } 或 null */
export async function currentUser(db, request) {
  const cookies = parseCookies(request);
  const token = cookies[CONFIG.SESSION_COOKIE];
  const sess = await db.getSession(token);
  if (!sess) return null;
  const user = await db.getUser(sess.uid);
  if (!user) return null;
  return { user, token };
}

/** 简易 CSRF 防护：同源校验 */
export function sameOrigin(request) {
  const host = request.headers.get('Host');

  // 浏览器会带 Sec-Fetch-Site：跨站请求直接拒绝，不依赖可缺失的 Origin
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') return false;

  const origin = request.headers.get('Origin');
  const referer = origin ? null : request.headers.get('Referer');
  const source = origin || referer;
  if (!source) return true; // 非浏览器请求（curl/服务端）或极旧浏览器
  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

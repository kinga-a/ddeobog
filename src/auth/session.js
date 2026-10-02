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
  const origin = request.headers.get('Origin');
  if (!origin) return true; // 非浏览器或同源表单
  const host = request.headers.get('Host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
